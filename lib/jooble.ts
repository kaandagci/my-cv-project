import type { CareerLevel, JobMatch } from './types';
import { scoreJobMatch } from './jobScoring';
import { isLikelyAggregatePage } from './jobPostingFilter';

// IMPORTANT: passing NO location hint at all to Jooble apparently lets it
// fall back to whatever market the API key/account itself defaults to
// (evidence: with an empty location, results came back centered on US
// cities — Dallas, Chicago, New York — even though every posting request
// this app makes is for Turkey). So unlike the previous assumption, the
// "Turkey" text hint genuinely matters here and must always be sent, even
// for a nationwide ("Tüm Türkiye") search.
const DEFAULT_LOCATION = process.env.JOOBLE_LOCATION || 'Turkey';

// Jooble issues API keys per country subdomain in principle (you register
// separately at e.g. https://tr.jooble.org/api/about vs the generic
// https://jooble.org/api/about). We still try the Turkish subdomain first
// and fall back to the generic host on an auth rejection, since it can
// only help — but we no longer TRUST either host to actually restrict
// results to Turkey on its own (see the location allowlist below, which is
// now the real safety net regardless of which host answers).
const EXPLICIT_JOOBLE_HOST = process.env.JOOBLE_API_HOST?.trim();
const JOOBLE_HOST_CANDIDATES = EXPLICIT_JOOBLE_HOST ? [EXPLICIT_JOOBLE_HOST] : ['tr.jooble.org', 'jooble.org'];
// Cached across calls within the same warm serverless instance so we don't
// re-probe both hosts on every one of the (up to 3) Jooble calls a single
// search makes — once we know which host the key actually works on, stick
// with it.
let cachedWorkingHost: string | null = null;

const REMOTE_TERMS = ['remote', 'uzaktan', 'evden çalışma', 'home office', 'work from home'];

// All 81 Turkish provinces, normalized (see normalizeTr below) — used as an
// ALLOWLIST for the "no specific city requested" case. This replaces an
// earlier denylist approach (reject only if the location field explicitly
// names a foreign COUNTRY like "united states") which completely missed
// foreign CITY names with no country word attached — exactly what Jooble
// actually returns for US postings ("Dallas, TX", "Chicago, IL", "New
// York, NY" contain neither "usa" nor "united states"). An allowlist of
// what a Turkish location actually looks like is the only approach that
// can't be defeated by an unanticipated foreign city name.
const TURKISH_PROVINCES = [
  'adana', 'adiyaman', 'afyonkarahisar', 'agri', 'amasya', 'ankara', 'antalya', 'artvin', 'aydin',
  'balikesir', 'bilecik', 'bingol', 'bitlis', 'bolu', 'burdur', 'bursa', 'canakkale', 'cankiri',
  'corum', 'denizli', 'diyarbakir', 'edirne', 'elazig', 'erzincan', 'erzurum', 'eskisehir',
  'gaziantep', 'giresun', 'gumushane', 'hakkari', 'hatay', 'isparta', 'mersin', 'istanbul', 'izmir',
  'kars', 'kastamonu', 'kayseri', 'kirklareli', 'kirsehir', 'kocaeli', 'konya', 'kutahya', 'malatya',
  'manisa', 'kahramanmaras', 'mardin', 'mugla', 'mus', 'nevsehir', 'nigde', 'ordu', 'rize', 'sakarya',
  'samsun', 'siirt', 'sinop', 'sivas', 'tekirdag', 'tokat', 'trabzon', 'tunceli', 'sanliurfa', 'usak',
  'van', 'yozgat', 'zonguldak', 'aksaray', 'bayburt', 'karaman', 'kirikkale', 'batman', 'sirnak',
  'bartin', 'ardahan', 'igdir', 'yalova', 'karabuk', 'kilis', 'osmaniye', 'duzce'
];
const TURKEY_COUNTRY_WORDS = ['turkiye', 'türkiye', 'turkey'];

function looksTurkish(normalizedLoc: string): boolean {
  return (
    TURKEY_COUNTRY_WORDS.some((w) => normalizedLoc.includes(w)) ||
    TURKISH_PROVINCES.some((p) => normalizedLoc.includes(p))
  );
}

// Normalizes Turkish-specific characters to their closest ASCII form so
// "İstanbul" / "Istanbul" / "istanbul" all compare equal — plain
// .toLowerCase() mishandles the Turkish dotted/dotless I pair.
function normalizeTr(s: string): string {
  return (s || '')
    .replace(/İ/g, 'I')
    .replace(/ı/g, 'i')
    .replace(/Ş/g, 'S').replace(/ş/g, 's')
    .replace(/Ç/g, 'C').replace(/ç/g, 'c')
    .replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
    .replace(/Ö/g, 'O').replace(/ö/g, 'o')
    .replace(/Ü/g, 'U').replace(/ü/g, 'u')
    .toLowerCase();
}

function isLikelyRelevantLocation(returnedLocation: string | undefined, requestedLocation: string): boolean {
  const loc = normalizeTr(returnedLocation || '');
  if (!loc) return true; // Jooble sometimes omits location entirely — don't punish missing data
  if (REMOTE_TERMS.some((t) => loc.includes(t))) return true;

  if (requestedLocation) {
    // A specific city (or custom-typed location, including a foreign one
    // the user deliberately typed) was requested — require it to actually
    // appear in the posting's own location field.
    return loc.includes(normalizeTr(requestedLocation));
  }

  // No specific city requested ("Tüm Türkiye") — require the location to
  // actually look Turkish (a known province or "Türkiye"/"Turkey" itself),
  // rather than only rejecting a finite list of known-foreign phrasings.
  return looksTurkish(loc);
}

function filterByLocation(list: JoobleResult[], requestedLocation: string): JoobleResult[] {
  // Both checks are applied together everywhere this is called, so fold
  // the aggregate-page filter in here directly rather than repeating it at
  // every call site. Freshness is intentionally NOT included here — see
  // applyFreshnessSoft below for why it needs to be a separate, non-fatal
  // step instead of a hard filter combined with these.
  return list
    .filter((r) => isLikelyRelevantLocation(r.location, requestedLocation))
    .filter((r) => !isLikelyAggregatePage(r.title, r.link));
}

// Jooble's `updated` field is the posting's own last-updated date (when
// present) — prefer recent postings so "current openings" doesn't quietly
// include ones from a year ago that are probably filled or expired.
//
// This is deliberately a SOFT filter: if applying it would wipe out every
// result (e.g. Jooble simply doesn't populate `updated` reliably for a lot
// of Turkish postings, or genuinely everything matching is a bit older),
// fall back to the unfiltered list rather than reporting "no jobs found"
// over a freshness heuristic. A same-topic hard filter on the Serper side
// caused exactly this kind of all-results-disappear regression earlier, so
// this one is built to degrade gracefully instead.
const MAX_POSTING_AGE_DAYS = 60;
function isRecentEnough(updated: string | undefined): boolean {
  if (!updated) return true;
  const ts = Date.parse(updated);
  if (Number.isNaN(ts)) return true;
  const ageDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  return ageDays <= MAX_POSTING_AGE_DAYS;
}
function applyFreshnessSoft(list: JoobleResult[]): JoobleResult[] {
  const fresh = list.filter((r) => isRecentEnough(r.updated));
  return fresh.length > 0 ? fresh : list;
}

// (Jooble aggregates from hundreds of boards, including LinkedIn/Indeed
// themselves, and its own index occasionally contains the exact same kind
// of SEO collection page our Serper site-search has to filter out — e.g. a
// "41 Data Science Intern Jobs in Türkiye" listing page indexed as if it
// were a single vacancy. filterByLocation above now also screens for this
// via isLikelyAggregatePage, since Jooble had no defense against it before.)

interface JoobleResult {
  title: string;
  location: string;
  snippet: string;
  salary?: string;
  source?: string;
  type?: string;
  link: string;
  company?: string;
  updated?: string;
}

export interface JoobleSearchOutcome {
  jobs: JobMatch[];
  usedLocation: string;
  fallbackApplied: boolean;
  careerLevelBoostApplied: boolean;
  configured: boolean;
  error?: string; // set (non-throwing) when Jooble was configured but the call itself failed, so the caller can surface *why* instead of silently showing 0 Jooble results
}

async function callJoobleApiOnHost(host: string, apiKey: string, keywords: string, location: string): Promise<JoobleResult[]> {
  const res = await fetch(`https://${host}/api/${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(location ? { keywords, location } : { keywords })
  });

  const rawBody = await res.text();

  if (!res.ok) {
    const err: any = new Error(`Jooble API hatası (${host}, ${res.status}): ${rawBody.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }

  let data: any;
  try {
    data = JSON.parse(rawBody);
  } catch {
    throw new Error(`Jooble API (${host}) beklenmeyen bir yanıt döndürdü (geçersiz JSON). API anahtarınızı kontrol edin.`);
  }

  return data.jobs || [];
}

async function callJoobleApi(apiKey: string, keywords: string, location: string): Promise<JoobleResult[]> {
  if (cachedWorkingHost) {
    return callJoobleApiOnHost(cachedWorkingHost, apiKey, keywords, location);
  }

  let lastError: any;
  for (const host of JOOBLE_HOST_CANDIDATES) {
    try {
      const jobs = await callJoobleApiOnHost(host, apiKey, keywords, location);
      cachedWorkingHost = host;
      return jobs;
    } catch (e: any) {
      lastError = e;
      // Only worth trying the next host on an auth-style rejection (the
      // key just isn't valid on this particular subdomain) — a non-auth
      // error (rate limit, malformed request, etc.) would fail identically
      // on the other host too, so don't waste the extra round-trip.
      if (e?.status !== 401 && e?.status !== 403) break;
    }
  }
  throw lastError;
}

function buildQuery(roleTitle: string | undefined, keywords: string[], suffix?: string): string {
  const core = roleTitle ? `${roleTitle} ${keywords.slice(0, 3).join(' ')}` : keywords.slice(0, 6).join(' ');
  return suffix ? `${core} ${suffix}`.trim() : core.trim();
}

/**
 * Searches Jooble for jobs matching the CV. Jooble's own Turkey coverage is
 * thin, so this is meant to be combined with searchGoogleJobs() (LinkedIn /
 * Kariyer.net / Indeed / SecretCV) in the calling route rather than relied
 * on alone for Turkish results.
 */
export async function searchJoobleJobs(
  keywords: string[],
  location: string = DEFAULT_LOCATION,
  options: { roleTitle?: string; careerLevel?: CareerLevel } = {}
): Promise<JoobleSearchOutcome> {
  // Jooble has repeatedly proven unreliable for this app specifically (wrong
  // country's postings leaking through regardless of host/location fixes
  // attempted) and is explicitly opt-in now rather than on-by-default — set
  // JOOBLE_ENABLED=true to try it again. LinkedIn/Kariyer.net/Indeed/SecretCV
  // via Serper are the primary, actively-maintained source.
  if (process.env.JOOBLE_ENABLED !== 'true') {
    return { jobs: [], usedLocation: location || '', fallbackApplied: false, careerLevelBoostApplied: false, configured: false };
  }

  const apiKey = process.env.JOOBLE_API_KEY;
  if (!apiKey) {
    // Jooble is treated as one of possibly several sources now — if it's
    // simply not configured, degrade gracefully instead of failing the
    // whole combined search (Google-sourced results can still come back).
    return { jobs: [], usedLocation: location || '', fallbackApplied: false, careerLevelBoostApplied: false, configured: false };
  }
  if (!keywords || keywords.length === 0) {
    return { jobs: [], usedLocation: location || '', fallbackApplied: false, careerLevelBoostApplied: false, configured: true };
  }

  const { roleTitle, careerLevel } = options;
  const trimmedLocation = (location || '').trim();

  const baseQuery = buildQuery(roleTitle, keywords);
  let rawResults = await callJoobleApi(apiKey, baseQuery, trimmedLocation);
  let usedLocation = trimmedLocation;
  let fallbackApplied = false;

  // NOTE: this actually applies the location filter now — filterByLocation
  // existed above but was never called anywhere in this function, so every
  // raw Jooble result (including postings from entirely different
  // countries, since Jooble's own `location` param is only a ranking hint,
  // not a hard filter — see the comment on filterByLocation) was passed
  // straight through untouched.
  let results = filterByLocation(rawResults, usedLocation);

  if (results.length === 0 && trimmedLocation) {
    // Requested location genuinely had nothing — broaden the Jooble query
    // itself, but still keep results restricted to Turkey (filterByLocation
    // with an empty requestedLocation rejects postings that clearly name a
    // different country).
    rawResults = await callJoobleApi(apiKey, baseQuery, '');
    usedLocation = '';
    fallbackApplied = true;
    results = filterByLocation(rawResults, usedLocation);
  }

  let careerLevelBoostApplied = false;
  const levelSuffix =
    careerLevel === 'öğrenci/stajyer' ? 'stajyer intern' : careerLevel === 'yeni mezun' ? 'junior yeni mezun' : null;

  if (levelSuffix) {
    const levelQuery = buildQuery(roleTitle, keywords, levelSuffix);
    const rawLevelResults = await callJoobleApi(apiKey, levelQuery, usedLocation);
    const levelResults = filterByLocation(rawLevelResults, usedLocation);
    if (levelResults.length > 0) {
      careerLevelBoostApplied = true;
      const seen = new Set(results.map((r) => r.link));
      for (const r of levelResults) {
        if (!seen.has(r.link)) {
          results.push(r);
          seen.add(r.link);
        }
      }
    }
  }

  const jobs: JobMatch[] = applyFreshnessSoft(results).map((job, i) => {
    const { score, matched } = scoreJobMatch(job.title, job.snippet, keywords, roleTitle, careerLevel);
    return {
      id: job.link || `jooble-${i}`,
      title: job.title || 'Başlıksız ilan',
      company: job.company || job.source || 'Bilinmiyor',
      location: job.location || usedLocation || 'Belirtilmemiş',
      description: job.snippet || '',
      url: job.link,
      matchScore: score,
      matchedKeywords: matched,
      source: 'Jooble'
    };
  });

  return { jobs, usedLocation, fallbackApplied, careerLevelBoostApplied, configured: true };
}
