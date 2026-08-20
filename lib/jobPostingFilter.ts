// Both job sources (Jooble's aggregated index AND our own Serper site:
// searches) can hand back a "collection"/SEO landing page instead of an
// actual single job posting — e.g. LinkedIn's auto-generated
// "https://tr.linkedin.com/jobs/data-science-intern-jobs" page, whose own
// title is literally "41 Data Science Intern Jobs in Türkiye". These pages
// are Google-indexed just like real postings, so a site: search alone
// can't tell them apart — we have to recognize the *shape* of the title
// and URL.
//
// Previously this kind of check only existed inside lib/webJobSearch.ts
// (as looksLikeJobPosting) and only covered URL shape, and Jooble's
// results — which aggregate from LinkedIn, Indeed, and hundreds of other
// boards, including their own SEO collection pages — went through no such
// check at all. This is shared so both sources use the same rule.

// "41 Data Science Intern Jobs in Türkiye", "100+ Software Engineer Jobs
// in Istanbul", "Marketing Jobs in Turkey (500+ New)" — LinkedIn/Indeed's
// standard auto-generated collection-page title shape.
const AGGREGATE_TITLE_PATTERNS: RegExp[] = [
  /^\d[\d.,]*\+?\s+.{2,60}\bjobs?\b.{0,20}\bin\b/i,
  /\bjobs?\s+in\s+.{2,40}\(\d[\d.,]*\+?\s*(new|yeni)?\)?$/i,
  // Turkish equivalents: "1.234 iş ilanı", "500+ Yazılım Mühendisi ilanı"
  /^\d[\d.,]*\+?\s+.{2,60}\b(iş ilan[ıi]?|is ilan[ıi]?)\b/i
];

function looksLikeAggregateTitle(title: string): boolean {
  const t = (title || '').trim();
  if (!t) return false;
  return AGGREGATE_TITLE_PATTERNS.some((re) => re.test(t));
}

// URL-shape check per known domain — a single posting almost always has an
// ID or a very specific path segment; category/search pages don't.
function looksLikeAggregateUrl(url: string): boolean {
  const l = (url || '').toLowerCase();
  if (!l) return true;

  if (l.includes('linkedin.com')) {
    // A real posting is always ".../jobs/view/<id>-...". Anything under
    // /jobs/ without /view/ is a search/category/collection page (e.g.
    // "/jobs/data-science-intern-jobs", "/jobs/search").
    if (l.includes('/jobs/')) return !l.includes('/jobs/view/');
    return false;
  }
  if (l.includes('kariyer.net')) {
    if (l.includes('is-ilanlari') || l.includes('ilan-ara')) return true;
    return false;
  }
  if (l.includes('indeed.com')) {
    if (l.includes('/jobs?') || (l.includes('/cmp/') && l.includes('/jobs'))) return true;
    return false;
  }
  if (l.includes('secretcv.com')) {
    if (l.includes('is-ilanlari') || l.includes('ilan-ara')) return true;
    return false;
  }
  return false;
}

/**
 * True if this looks like a listing/collection/search page rather than a
 * single job posting — by title shape, URL shape, or both. Used to filter
 * candidates from every job source before they're shown to the user or
 * sent to the AI reranker.
 */
export function isLikelyAggregatePage(title: string, url: string): boolean {
  return looksLikeAggregateTitle(title) || looksLikeAggregateUrl(url);
}
