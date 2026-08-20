import type { CareerLevel, JobMatch } from './types';
import { scoreJobMatch, isTalentProgramText } from './jobScoring';
import { isLikelyAggregatePage } from './jobPostingFilter';
import { isConfidentlyStale } from './postingAge';
import { isClosedPosting } from './jobPageFetch';

// This module fills the gap Jooble leaves in Turkey by running targeted
// searches (site:linkedin.com/jobs, site:kariyer.net, site:indeed.com,
// site:secretcv.com) — the same sites a person would manually check.
//
// Uses Serper.dev (https://serper.dev) rather than Google's own Custom
// Search JSON API. Google closed that API to new customers in 2025 — new
// Google Cloud projects get a permanent "This project does not have the
// access to Custom Search JSON API" 403 no matter how correctly they're
// configured (API enabled, key unrestricted, billing on — none of that
// matters for a new project). Serper is a normal, single-API-key SERP
// service with no CSE/project-eligibility layer to get blocked by, and a
// 2,500-query free trial credit.
const JOB_SITES: { domain: string; label: string }[] = [
  { domain: 'linkedin.com/jobs', label: 'LinkedIn' },
  { domain: 'kariyer.net', label: 'Kariyer.net' },
  { domain: 'indeed.com', label: 'Indeed' },
  { domain: 'secretcv.com', label: 'SecretCV' }
];

interface SerperOrganicItem {
  title: string;
  link: string;
  snippet?: string;
  date?: string; // Serper sometimes includes a relative freshness string, e.g. "3 days ago" / "2 weeks ago"
}

async function searchSerperSite(
  apiKey: string,
  domain: string,
  query: string,
  num = 10,
  page?: number
): Promise<SerperOrganicItem[]> {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      q: `site:${domain} ${query}`.trim(),
      gl: 'tr', // bias results toward Turkey
      hl: 'tr', // Turkish-language interface/results preference
      num,
      ...(page && page > 1 ? { page } : {})
    })
  });

  const rawBody = await res.text();
  let body: any = {};
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    // Serper returned non-JSON (e.g. an HTML error page from a proxy/CDN
    // in front of the API) — keep the raw text so it still shows up in the
    // error message instead of failing silently as "Bilinmeyen hata".
    body = { message: rawBody.slice(0, 200) };
  }

  if (!res.ok) {
    const message = body?.message || body?.error || rawBody.slice(0, 200) || `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `SERPER_API_KEY geçersiz, kota tükenmiş veya yanlış kopyalanmış olabilir (Serper yanıtı: "${message}", HTTP ${res.status}). Vercel proje ayarlarında değeri tırnak işareti veya boşluk OLMADAN girdiğinizden ve değişikliği yaptıktan sonra projeyi yeniden deploy ettiğinizden emin olun. Anahtarı https://serper.dev/dashboard adresinden kontrol edebilirsiniz.`
      );
    }
    throw new Error(`Serper HTTP ${res.status}: ${message}`);
  }

  return (body.organic || []) as SerperOrganicItem[];
}

// A single narrow query (site: + full role title + several keywords + a
// city) was consistently returning almost nothing — Google's index of
// these sites for any one specific phrasing is just thin, especially for
// LinkedIn (postings expire/deindex within weeks) and for generic
// company-wide programs ("Genç Yetenek Programı" style postings, which
// have no department/skill keywords in them AT ALL, so a keyword-heavy
// query can never match them no matter how it's phrased).
//
// Rather than one query with a resilience fallback chain, this runs
// SEVERAL genuinely different query angles in parallel per site and merges
// them — each one is more likely to independently miss than a single
// perfect query is to hit, but together they cover much more of what's
// actually indexed:
//   1. Full: role title + level + location
//   2. Keyword-focused: top 2 keywords + level + location (catches
//      postings phrased around specific skills rather than a job title)
//   3. Broad: just level + location (e.g. "stajyer İstanbul") — this is
//      the one that surfaces general talent/graduate programs, since they
//      don't mention any specific role or skill at all
function buildQueryVariants(
  roleTitle: string | undefined,
  keywords: string[],
  levelTerm: string,
  location: string
): string[] {
  const loc = location || '';
  const variants = new Set<string>();

  if (roleTitle) variants.add(`${roleTitle}${levelTerm} ${loc}`.trim());

  const topKeywords = keywords.slice(0, 2).join(' ');
  if (topKeywords) variants.add(`${topKeywords}${levelTerm} ${loc}`.trim());

  if (!roleTitle && !topKeywords && keywords[0]) {
    variants.add(`${keywords[0]}${levelTerm} ${loc}`.trim());
  }

  // Broadest angle — deliberately no role/skill keyword, only level +
  // location, so generic company-wide programs (no department named) can
  // still turn up. Only meaningful when there IS a level term to narrow
  // it with; without one this would just be "İstanbul" and return noise.
  if (levelTerm.trim()) variants.add(`${levelTerm.trim()} ${loc}`.trim());

  // Explicitly search for the "talent/graduate program" category by name
  // — the example the person gave ("Genç Yetenek Programı") is a company
  // running an intake program with no department in the title at all, so
  // even the broad level+location query above is relying on luck to
  // surface it among everything else matching "stajyer İstanbul". Naming
  // the category directly gives it a real chance of being found instead.
  //
  // IMPORTANT: this used to be a single query combining all 4 phrases with
  // OR inside parentheses — e.g. `("yetenek programı" OR "graduate
  // program" OR ...)`. Serper's free tier rejects that compound boolean
  // pattern outright with "Query pattern not allowed for free accounts"
  // (a plain 400, not a credits/auth issue), which — since every site
  // shares this exact same variant — was breaking the search for
  // LinkedIn/Kariyer.net/Indeed/SecretCV simultaneously. A single quoted
  // phrase with no OR/parentheses is a normal, allowed query, so this is
  // now several independent simple queries covering the same phrases
  // instead of one compound one.
  if (levelTerm.trim()) {
    variants.add(`"yetenek programı" ${loc}`.trim());
    variants.add(`"graduate program" ${loc}`.trim());
  }

  return Array.from(variants).filter(Boolean);
}

async function searchSiteBroad(
  apiKey: string,
  domain: string,
  queries: string[],
  num = 10,
  page = 1
): Promise<SerperOrganicItem[]> {
  // Promise.all rejects (and throws away every already-successful result)
  // the moment ANY one query variant fails — which is exactly how a single
  // rejected/malformed query variant was taking down results from ALL
  // query angles for a site, not just itself. Promise.allSettled lets the
  // other variants' results through regardless of whether one of them
  // errors (rate limit, a query pattern Serper doesn't like, a transient
  // timeout, etc.) — a single bad angle should degrade this site's
  // results, not zero them out entirely.
  const settled = await Promise.allSettled(
    queries.map((q) => searchSerperSite(apiKey, domain, q, num, page > 1 ? page : undefined))
  );
  const results: SerperOrganicItem[][] = [];
  const failures: string[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      results.push(r.value);
    } else {
      failures.push(`"${queries[i]}": ${r.reason?.message || r.reason}`);
    }
  });
  // Only surface an error (and let the caller record it) if EVERY variant
  // failed — a partial failure just means fewer results, which isn't
  // worth alarming the user about.
  if (results.length === 0 && failures.length > 0) {
    throw new Error(failures[0]);
  }
  const merged = results.flat();
  const seen = new Set<string>();
  const deduped: SerperOrganicItem[] = [];
  for (const item of merged) {
    if (!item.link || seen.has(item.link)) continue;
    seen.add(item.link);
    deduped.push(item);
  }
  return deduped;
}

// Heuristics to keep only pages that actually look like a single job
// posting, not a company homepage, category/collection page (e.g.
// LinkedIn's ".../jobs/data-science-intern-jobs" SEO landing page listing
// 40+ postings at once), or unrelated article that happens to mention the
// site. Combines the domain-specific URL-shape check below with the
// shared title/URL aggregate-page detector (isLikelyAggregatePage) as a
// second, independent layer — a collection page occasionally has a URL
// shape we haven't special-cased yet, but its auto-generated title
// ("41 Data Science Intern Jobs in Türkiye") almost always gives it away.
function looksLikeJobPosting(domain: string, title: string, link: string): boolean {
  const l = link.toLowerCase();

  if (isLikelyAggregatePage(title, link)) return false;

  if (domain.includes('linkedin.com')) {
    // A single posting is always ".../jobs/view/<id>-<slug>". Category /
    // search-landing pages also contain "/jobs/" but never "/view/" — the
    // previous check only required "/jobs/" and let those through.
    return l.includes('/jobs/view/');
  }
  if (domain.includes('kariyer.net')) {
    // "is-ilanlari" (plural) is kariyer.net's category/listing path;
    // "is-ilani" (singular) or "/ilan" is an individual posting. These are
    // easy to conflate since one is a substring-adjacent variant of the
    // other in spirit (not literally, but worth guarding explicitly).
    if (l.includes('is-ilanlari') || l.includes('ilan-ara')) return false;
    return l.includes('is-ilani') || l.includes('/ilan');
  }
  if (domain.includes('indeed.com')) {
    // ".../cmp/<company>/jobs" lists every posting from that company, not
    // one specific job.
    if (l.includes('/cmp/') && l.includes('/jobs')) return false;
    return l.includes('/viewjob') || l.includes('clk?');
  }
  if (domain.includes('secretcv.com')) {
    if (l.includes('is-ilanlari') || l.includes('ilan-ara')) return false;
    return l.includes('/ilan');
  }
  return true;
}

// Best-effort split of a search result title into "Job Title - Company"
// (common pattern across LinkedIn/Kariyer.net/Indeed titles). Falls back to
// the source label when the title doesn't follow that pattern.
function splitTitleAndCompany(rawTitle: string, sourceLabel: string): { title: string; company: string } {
  const separators = [' - ', ' | ', ' – ', ' :: '];
  for (const sep of separators) {
    if (rawTitle.includes(sep)) {
      const [first, ...rest] = rawTitle.split(sep);
      const remainder = rest.join(sep).trim();
      if (first.trim() && remainder) {
        return { title: first.trim(), company: remainder.replace(new RegExp(sourceLabel, 'i'), '').trim() || sourceLabel };
      }
    }
  }
  return { title: rawTitle.trim(), company: sourceLabel };
}

export interface WebJobSearchOutcome {
  jobs: JobMatch[];
  sourcesUsed: string[];
  sourceErrors: { label: string; message: string }[];
  configured: boolean;
}

/**
 * Runs one Serper.dev query per target Turkish job site and returns them as
 * scored JobMatch objects, ready to merge with results from other sources
 * (e.g. Jooble). If SERPER_API_KEY isn't set, returns an empty (non-error)
 * result so the combined search still works with whatever other sources
 * ARE configured.
 */
export async function searchWebJobSites(
  keywords: string[],
  roleTitle: string | undefined,
  location: string,
  careerLevel: CareerLevel | undefined,
  page = 1
): Promise<WebJobSearchOutcome> {
  // Strip accidental wrapping quotes and whitespace — a very common copy
  // mistake is pasting `SERPER_API_KEY="abc123"` (quotes included) into
  // Vercel's env var value field, which makes the key invalid without any
  // obvious sign why (Serper just returns a generic 401/403).
  const apiKey = process.env.SERPER_API_KEY?.trim().replace(/^['"]|['"]$/g, '').trim();

  if (!apiKey) {
    return { jobs: [], sourcesUsed: [], sourceErrors: [], configured: false };
  }

  const levelTerm =
    careerLevel === 'öğrenci/stajyer' ? ' stajyer' : careerLevel === 'yeni mezun' ? ' yeni mezun junior' : '';
  const queryVariants = buildQueryVariants(roleTitle, keywords, levelTerm, location);

  const sourcesUsed: string[] = [];
  const sourceErrors: { label: string; message: string }[] = [];

  const perSiteResults = await Promise.all(
    JOB_SITES.map(async ({ domain, label }) => {
      try {
        const items = await searchSiteBroad(apiKey, domain, queryVariants, 15, page);
        const filtered = items.filter(
          (it) =>
            it.link &&
            looksLikeJobPosting(domain, it.title || '', it.link) &&
            // Drop postings Google itself reports as many months/a year
            // old right here, at the cheapest possible point — before
            // spending a full-page fetch or an AI judgement on something
            // that's essentially guaranteed to be closed already. See
            // postingAge.ts for why age is trusted over live-page closure
            // detection.
            !isConfidentlyStale(it.date, isTalentProgramText(`${it.title || ''} ${it.snippet || ''}`)) &&
            // Some closed postings reveal it directly in the SEARCH
            // SNIPPET itself (confirmed: Google's own cached snippet for a
            // closed kariyer.net posting literally read "...artık başvuru
            // kabul etmiyor"). Catching that here means these never even
            // become candidates — no full-page fetch needed, and no
            // dependency on our own server successfully fetching the live
            // page (which isn't guaranteed for every site/host).
            !isClosedPosting(`${it.title || ''} ${it.snippet || ''}`)
        );
        if (filtered.length > 0) sourcesUsed.push(label);
        // Diagnostic only: if Google/Serper actually had raw candidates
        // for this site but every single one got filtered out (category
        // page, stale, or already-closed), that's a genuinely different
        // situation from "Serper found nothing at all" and worth being
        // able to tell apart when debugging low result counts.
        if (items.length > 0 && filtered.length === 0) {
          sourceErrors.push({
            label,
            message: `${items.length} ham sonuç bulundu ama hepsi filtrelendi (kategori sayfası, eski ilan veya zaten kapanmış).`
          });
        }
        return filtered.map((item) => ({ item, label }));
      } catch (e: any) {
        sourceErrors.push({ label, message: e.message || 'Bilinmeyen hata' });
        return [];
      }
    })
  );

  const jobs: JobMatch[] = perSiteResults.flat().map(({ item, label }, i) => {
    const { title, company } = splitTitleAndCompany(item.title || 'Başlıksız ilan', label);
    const { score, matched } = scoreJobMatch(title, item.snippet || '', keywords, roleTitle, careerLevel);
    return {
      id: item.link || `serper-${label}-${i}`,
      title,
      company,
      location: location || 'Belirtilmemiş',
      description: item.snippet || '',
      url: item.link,
      matchScore: score,
      matchedKeywords: matched,
      source: label
    };
  });

  return { jobs, sourcesUsed, sourceErrors, configured: true };
}
