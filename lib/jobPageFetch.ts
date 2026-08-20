// Fetches a job posting's own page and extracts plain text from it, so the
// AI reranker can judge REAL fit (seniority, required stack, responsibilities)
// instead of just the one-line snippet Serper returns from the search result.
//
// No HTML-parsing dependency is added on purpose (keeps the project's
// dependency footprint the same) — a regex-based strip is good enough for
// "get readable text out of a job posting page".

const FETCH_TIMEOUT_MS = 8000;
const MAX_CHARS = 1200;
const MIN_USABLE_CHARS = 300;

// Sites like LinkedIn frequently show a login wall instead of the real
// posting to a non-authenticated fetch. When that happens the page is
// short and/or contains one of these markers — treat it as "couldn't read
// this one" rather than feeding the login-wall text to the AI as if it
// were the job description.
const AUTHWALL_MARKERS = [
  'sign in to see',
  'sign in to view',
  'oturum açın',
  'giriş yapın',
  'please enable javascript',
  'you need to enable javascript',
  'join now to see',
  'authwall'
];

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

// Confirmed by fetching REAL postings during debugging (this exact text
// appeared verbatim on a closed kariyer.net posting): "Şirket aradığı
// adayı bulduğu için artık başvuru kabul etmiyor." The previous marker
// list used exact substrings like "artık kabul etmiyor" — this real
// phrase has "başvuru" inserted between "artık" and "kabul", so it never
// matched ANY of the old markers despite being the single most common
// closure message on Turkish job sites. This is likely why closed
// postings kept slipping through almost entirely. Markers are now regexes
// that tolerate a few words in between, not brittle exact phrases.
const CLOSED_POSTING_PATTERNS: RegExp[] = [
  // "artık kabul etmiyor" / "artık başvuru kabul etmiyor" / "artık
  // başvuruları kabul etmiyor" — allow 0-25 chars between "artık" and
  // "kabul etmiyor" to catch all of these in one pattern.
  /artık.{0,25}kabul etmiyor/i,
  /aradığı adayı bulduğu için/i, // kariyer.net's standard closure lead-in
  /yayından kaldırılmıştır/i,
  /ilanın süresi dolmuştur/i,
  /süresi dolmuş/i,
  /pasif ilan/i,
  /ilan pasif/i,
  /ilan yayında değil/i,
  /başvurulara kapanmıştır/i,
  /başvuruya kapanmıştır/i,
  /no longer accepting/i, // covers "applications", "job applications", "applicants" etc in one go
  /this job is no longer available/i,
  /this posting has expired/i,
  /position has been filled/i,
  /job (listing )?has expired/i,
  /closed to new applicants/i,
  /applications? (are |is )?closed/i,
  /vacancy (is|has) closed/i
];

export function isClosedPosting(text: string): boolean {
  return CLOSED_POSTING_PATTERNS.some((re) => re.test(text));
}

// Kariyer.net (and possibly other sites on the same platform) embed a
// plain-text "closingDate:DD.MM.YYYY lastPublishDate:DD.MM.YYYY" marker
// directly in the page body — confirmed by fetching a real posting. This
// is a highly reliable, trivially-parseable signal where it exists: if
// closingDate is in the past, the posting is definitely closed.
function checkClosingDateField(text: string): boolean {
  const m = /closingDate:(\d{2})\.(\d{2})\.(\d{4})/.exec(text);
  if (!m) return false;
  const [, dd, mm, yyyy] = m;
  const ts = new Date(Number(yyyy), Number(mm) - 1, Number(dd)).getTime();
  return !Number.isNaN(ts) && ts < Date.now();
}

// Most job sites (LinkedIn, Indeed, Kariyer.net included) embed schema.org
// JobPosting structured data in a <script type="application/ld+json"> tag
// specifically so Google Jobs can index them — it's the same data source
// Google itself trusts for "is this posting still open" and "when does it
// expire". This is far more reliable than scanning visible page text for a
// closure phrase, for two reasons: (1) it's present in the raw HTML/head
// before any client-side rendering or login-wall gating kicks in, so it
// often survives even when LinkedIn blocks/limits what an unauthenticated
// fetch can see of the rendered page; (2) it's structured — a `validThrough`
// date in the past is unambiguous, whereas closure phrasing varies a lot
// and can never be fully enumerated.
function checkJobPostingSchema(html: string): { closed: boolean } | null {
  const scriptMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (!scriptMatches) return null;

  for (const block of scriptMatches) {
    const jsonText = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      continue;
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const c of candidates) {
      const type = c?.['@type'];
      const isJobPosting = type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
      if (!isJobPosting) continue;

      if (c.validThrough) {
        const ts = Date.parse(c.validThrough);
        if (!Number.isNaN(ts) && ts < Date.now()) return { closed: true };
      }
      // Some sites set this boolean explicitly instead of/alongside validThrough.
      if (c.jobPostingStatus && /expired|closed|filled/i.test(String(c.jobPostingStatus))) {
        return { closed: true };
      }
      // Found valid, non-expired JobPosting structured data — confidently
      // not closed by this signal (doesn't rule out a text-based check
      // still catching something the schema doesn't reflect).
      return { closed: false };
    }
  }
  return null; // no JobPosting schema found on this page at all
}

export type JobPageFetchResult =
  | { status: 'ok'; text: string }
  | { status: 'closed' } // fetched fine, but the posting itself says it's closed/expired
  | { status: 'unavailable' }; // couldn't fetch/parse for any other reason (timeout, blocked, authwall, too short)

/**
 * Best-effort fetch of a job posting's page text. Distinguishes "closed
 * posting" (status: 'closed') from "couldn't get real content at all"
 * (status: 'unavailable') so callers can reject closed postings outright
 * instead of quietly falling back to a snippet that doesn't mention the
 * posting is dead.
 */
export async function fetchJobPostingText(url: string): Promise<JobPageFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // A realistic desktop UA — several job sites serve a bare-bones
        // (or blocked) page to requests with no/obvious-bot UA string.
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'tr,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        // Looking like a click-through from a Google search result (which
        // is literally how the user would have found this URL themselves)
        // is treated more leniently by some sites' bot-detection than a
        // referrer-less request.
        Referer: 'https://www.google.com/'
      }
    });
    if (!res.ok) return { status: 'unavailable' };
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return { status: 'unavailable' };

    const html = await res.text();

    // Check structured JobPosting data FIRST — it's in the raw HTML, often
    // present even when the rendered/visible content is thin, blocked, or
    // behind a partial authwall (see checkJobPostingSchema for why this is
    // more reliable than scanning visible text alone).
    const schemaResult = checkJobPostingSchema(html);
    if (schemaResult?.closed) return { status: 'closed' };

    const text = stripHtml(html);

    // Check closure signals BEFORE the length gate below — a closure
    // banner page can be short (e.g. "Şirket aradığı adayı bulduğu için
    // artık başvuru kabul etmiyor" plus a "benzer ilanlar" list) and would
    // otherwise get reported as merely "unavailable" instead of the more
    // useful "closed".
    if (isClosedPosting(text)) return { status: 'closed' };
    if (checkClosingDateField(text)) return { status: 'closed' };

    if (text.length < MIN_USABLE_CHARS) {
      // Thin/blocked visible content — but if the schema explicitly said
      // this posting is NOT closed, that's still useful signal even
      // without enough readable text to send to the AI reranker. Report it
      // as unavailable either way since there's no real content to judge
      // fit from, just not falsely as "closed".
      return { status: 'unavailable' };
    }

    const lower = text.toLowerCase();
    const looksLikeAuthwall = AUTHWALL_MARKERS.some((m) => lower.includes(m)) && text.length < 800;
    if (looksLikeAuthwall) return { status: 'unavailable' };

    return { status: 'ok', text: text.slice(0, MAX_CHARS) };
  } catch {
    return { status: 'unavailable' }; // timeout, network error, blocked, etc. — non-fatal
  } finally {
    clearTimeout(timer);
  }
}
