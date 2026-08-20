// Serper's organic search results include a `date` field for many results
// — a relative freshness string straight from Google's own SERP display,
// e.g. "3 days ago", "2 weeks ago", "9 months ago", "1 year ago" (or the
// Turkish equivalents "3 gün önce", "9 ay önce" when Google's UI language
// is Turkish, as ours is set to via hl:'tr').
//
// IMPORTANT NUANCE (found the hard way): a strict "reject anything over 45
// days" cutoff here was silently killing exactly the kind of posting users
// most wanted surfaced — general talent/graduate programs ("Genç Yetenek
// Programı" etc). These are perpetual/rolling-intake postings that stay up
// and keep accepting applications for a long time, so Google very often
// shows them as posted "months ago" even though they're still fully open.
// A single one-off role posting shown as "9 months ago", by contrast, is
// indeed almost always closed by then.
//
// So this is now a soft signal fed into the AI reranker's context (which
// can reason "this is a rolling program, the date doesn't mean much here"
// vs "this is a specific one-off role from months ago, that's suspicious")
// rather than a blind pre-filter, EXCEPT for genuinely extreme staleness
// (see MAX_POSTING_AGE_DAYS_HARD_CUTOFF) which is used as a last-resort
// backstop even for talent programs — no program stays listed unedited for
// literally years.
export const MAX_POSTING_AGE_DAYS_HARD_CUTOFF = 400;

/**
 * Parses a relative freshness string (English or Turkish) into an
 * approximate age in days. Returns null if the string doesn't match a
 * recognizable pattern — callers should NOT penalize a posting for a
 * missing/unparseable date, only for a confidently-parsed old one.
 */
export function parseRelativeAgeDays(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const s = dateStr.toLowerCase().trim();

  if (/\b(bugün|today|az önce|just now)\b/.test(s)) return 0;
  if (/\b(dün|yesterday)\b/.test(s)) return 1;

  const match = s.match(/(\d+)\s*(dakika|saat|gün|hafta|ay|yıl|minute|hour|day|week|month|year)/);
  if (!match) return null;

  const n = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 'dakika':
    case 'minute':
    case 'saat':
    case 'hour':
      return 0;
    case 'gün':
    case 'day':
      return n;
    case 'hafta':
    case 'week':
      return n * 7;
    case 'ay':
    case 'month':
      return n * 30;
    case 'yıl':
    case 'year':
      return n * 365;
    default:
      return null;
  }
}

/**
 * True ONLY for extreme staleness (well over a year) — a last-resort
 * backstop applied even to talent-program-style postings, which otherwise
 * skip age-based filtering entirely (see the module comment above for why
 * a tighter cutoff was actively harmful). Regular one-off postings get a
 * second, tighter check at the call site for non-program listings.
 */
export function isExtremelyStale(dateStr: string | null | undefined): boolean {
  const age = parseRelativeAgeDays(dateStr);
  return age !== null && age > MAX_POSTING_AGE_DAYS_HARD_CUTOFF;
}

// Tighter cutoff used only for postings that do NOT look like a talent/
// graduate program — a specific one-off role realistically shouldn't still
// be the freshest thing Google has on it after 4+ months.
export const MAX_POSTING_AGE_DAYS_REGULAR = 120;

export function isConfidentlyStale(dateStr: string | null | undefined, isTalentProgram: boolean): boolean {
  const age = parseRelativeAgeDays(dateStr);
  if (age === null) return false;
  const cutoff = isTalentProgram ? MAX_POSTING_AGE_DAYS_HARD_CUTOFF : MAX_POSTING_AGE_DAYS_REGULAR;
  return age > cutoff;
}
