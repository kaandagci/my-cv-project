import { NextRequest, NextResponse } from 'next/server';
import { searchJoobleJobs } from '../../../lib/jooble';
import { searchWebJobSites } from '../../../lib/webJobSearch';
import { rerankJobsWithAI } from '../../../lib/jobRerank';
import type { CareerLevel, JobMatch } from '../../../lib/types';

export const runtime = 'nodejs';
// Fetching each candidate posting's own page + one Gemini call to judge fit
// takes longer than the platform's 10s default — request the extended
// duration. On Vercel Hobby this still caps out around 10-60s depending on
// your plan/Fluid Compute setting; if this route starts timing out in
// production, lower MAX_CANDIDATES_TO_INSPECT in lib/jobRerank.ts.
export const maxDuration = 60;

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch {
    return (url || '').toLowerCase();
  }
}

// The exact same vacancy is frequently cross-posted by the employer on more
// than one site (e.g. LinkedIn AND Kariyer.net) — different URLs, so
// normalizeUrl() alone can't catch it. Left unfiltered, both copies burn
// separate slots in the (capped) AI-inspection pool and just clutter the
// list with the same job twice. This is a coarse, deliberately
// conservative signature (exact title + company after normalizing
// whitespace/case/Turkish characters) — good enough to catch true
// cross-posts without risking merging two genuinely different postings
// that just happen to share a common title at the same company.
function dedupeSignature(title: string, company: string): string {
  const norm = (s: string) =>
    (s || '')
      .toLowerCase()
      .replace(/İ/g, 'i').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  return `${norm(title)}::${norm(company)}`;
}

export async function POST(req: NextRequest) {
  try {
    const { keywords, location, roleTitle, careerLevel, cvText, page, excludeUrls } = await req.json();
    if (!Array.isArray(keywords) || keywords.length === 0) {
      return NextResponse.json({ error: 'keywords (dizi) gerekli.' }, { status: 400 });
    }

    const cleanLocation = typeof location === 'string' && location.trim() ? location.trim() : undefined;
    const cleanRoleTitle = typeof roleTitle === 'string' && roleTitle.trim() ? roleTitle.trim() : undefined;
    const cleanCareerLevel = typeof careerLevel === 'string' ? (careerLevel as CareerLevel) : undefined;
    const cleanCvText = typeof cvText === 'string' ? cvText.slice(0, 6000) : undefined;
    // "Daha fazla tara": page 2+ asks Serper for the next page of results
    // instead of repeating page 1, and excludeUrls (every URL already shown
    // to the user across all pages so far) keeps already-seen postings from
    // reappearing after being re-ranked.
    const cleanPage = Number.isInteger(page) && page > 0 ? page : 1;
    const excludeUrlSet = new Set(
      Array.isArray(excludeUrls) ? excludeUrls.filter((u: unknown) => typeof u === 'string').map(normalizeUrl) : []
    );

    // Jooble has repeatedly returned postings from entirely wrong countries
    // for this app (US cities under a Turkey-only search) even after
    // several rounds of tightening the location filter — the underlying
    // cause is outside this codebase's control (which country's dataset
    // the API key/account is actually scoped to). Rather than keep
    // patching around an unreliable source, Jooble is OFF by default; set
    // JOOBLE_ENABLED=true in Vercel if you want to re-enable it (e.g. once
    // you've confirmed your key is registered for Turkey specifically at
    // https://tr.jooble.org/api/about). Serper (LinkedIn/Kariyer.net/
    // Indeed/SecretCV) is the primary, trustworthy source.
    const joobleEnabled = process.env.JOOBLE_ENABLED === 'true';

    // Run Jooble (if enabled) and the Serper-backed Turkish job sites
    // (LinkedIn, Kariyer.net, Indeed, SecretCV) in parallel and merge them.
    const [joobleResult, webResult] = await Promise.all([
      !joobleEnabled
        ? Promise.resolve({
            jobs: [] as JobMatch[],
            usedLocation: cleanLocation || '',
            fallbackApplied: false,
            careerLevelBoostApplied: false,
            configured: false
          })
        : searchJoobleJobs(keywords, cleanLocation, { roleTitle: cleanRoleTitle, careerLevel: cleanCareerLevel }).catch(
            (e) => {
              console.error('Jooble search error:', e);
              return {
                jobs: [] as JobMatch[],
                usedLocation: cleanLocation || '',
                fallbackApplied: false,
                careerLevelBoostApplied: false,
                configured: true, // it WAS configured, just errored — don't claim it's unconfigured
                error: e?.message || 'Jooble API isteği başarısız oldu.'
              };
            }
          ),
      searchWebJobSites(keywords, cleanRoleTitle, cleanLocation || 'Türkiye', cleanCareerLevel, cleanPage).catch((e) => {
        console.error('Web job search error:', e);
        return { jobs: [] as JobMatch[], sourcesUsed: [] as string[], sourceErrors: [], configured: true };
      })
    ]);

    if (!joobleResult.configured && !webResult.configured) {
      return NextResponse.json(
        {
          error: joobleEnabled
            ? 'Hiçbir iş arama kaynağı yapılandırılmamış. Vercel proje ayarlarına JOOBLE_API_KEY veya SERPER_API_KEY ekleyin.'
            : 'SERPER_API_KEY yapılandırılmamış. Vercel proje ayarlarına ekleyin (Jooble şu an devre dışı — JOOBLE_ENABLED=true ile açabilirsiniz).'
        },
        { status: 500 }
      );
    }

    // Merge + dedupe by normalized URL (a posting occasionally gets indexed
    // by more than one source under the exact same link), by title+company
    // signature (the same vacancy cross-posted on two different sites
    // under two different URLs — see dedupeSignature above), and drop
    // anything already shown to the user in an earlier page ("Daha fazla
    // tara"). When a true cross-post is found, keep whichever copy has the
    // higher heuristic score (usually the one whose title matched the
    // query better) rather than just whichever happened to be seen first.
    const merged: JobMatch[] = [];
    const seenUrls = new Set<string>(excludeUrlSet);
    const bestBySignature = new Map<string, JobMatch>();
    for (const job of [...webResult.jobs, ...joobleResult.jobs]) {
      const urlKey = normalizeUrl(job.url);
      if (!urlKey || seenUrls.has(urlKey)) continue;
      seenUrls.add(urlKey);

      const sig = dedupeSignature(job.title, job.company);
      const existing = bestBySignature.get(sig);
      if (existing) {
        if (job.matchScore > existing.matchScore) bestBySignature.set(sig, job);
        continue;
      }
      bestBySignature.set(sig, job);
      merged.push(job);
    }
    // merged holds insertion order with placeholder entries — replace each
    // with whichever version bestBySignature ended up keeping (in case a
    // later, higher-scoring cross-post replaced the first one seen).
    const deduped = merged.map((j) => bestBySignature.get(dedupeSignature(j.title, j.company)) || j);
    deduped.sort((a, b) => b.matchScore - a.matchScore);

    const sourcesUsed = Array.from(
      new Set([...(joobleResult.jobs.length > 0 ? ['Jooble'] : []), ...webResult.sourcesUsed])
    );

    // Instead of dumping every raw hit (title + one-line snippet) back to
    // the user, actually open each of the top candidates' own posting
    // page and have Gemini judge real fit (seniority, required stack,
    // whether it's still open, etc.) against the candidate's ACTUAL CV
    // content, returning a curated, reasoned shortlist. Falls back to the
    // plain heuristic-sorted list if this step isn't available/fails.
    const rerank = await rerankJobsWithAI(deduped, {
      roleTitle: cleanRoleTitle,
      careerLevel: cleanCareerLevel,
      keywords,
      cvText: cleanCvText
    });

    return NextResponse.json({
      jobs: rerank.jobs,
      totalFound: deduped.length,
      aiRerankApplied: rerank.aiRerankApplied,
      aiInspectedCount: rerank.inspectedCount,
      droppedClosedCount: rerank.droppedClosedCount,
      usedLocation: joobleResult.usedLocation,
      fallbackApplied: joobleResult.fallbackApplied,
      careerLevelBoostApplied: joobleResult.careerLevelBoostApplied,
      sourcesUsed,
      webSearchConfigured: webResult.configured,
      webSourceErrors: webResult.sourceErrors,
      joobleError: (joobleResult as any).error || null,
      joobleEnabled,
      page: cleanPage
    });
  } catch (err: any) {
    console.error('Job search error:', err);
    return NextResponse.json({ error: err.message || 'İş araması başarısız.' }, { status: 500 });
  }
}
