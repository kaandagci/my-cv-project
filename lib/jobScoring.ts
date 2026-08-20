import type { CareerLevel } from './types';

const INTERN_TERMS = ['stajyer', 'staj', 'intern', 'internship'];
const JUNIOR_TERMS = ['junior', 'yeni mezun', 'entry level', 'entry-level'];

// Words too generic to count as a meaningful role-title overlap signal on
// their own (Turkish + English function words, plus a couple of job-title
// filler words that appear in almost every title regardless of role).
const TITLE_STOPWORDS = new Set([
  've', 'ile', 'için', 'bir', 'de', 'da', 'the', 'and', 'of', 'a', 'an', 'for', 'to', 'in',
  'uzmanı', 'uzman', 'sorumlusu', 'elemanı', 'personeli', 'specialist', 'staff'
]);

/**
 * Fraction (0-1) of the meaningful words in roleTitle that also appear in
 * the job posting's title — used as a softer, more forgiving signal than
 * requiring the ENTIRE role title to appear as one exact substring. A CV
 * targeting "Kıdemli Yazılım Geliştirici" should still get partial credit
 * against a posting titled "Senior Software Developer" or "Yazılım
 * Geliştirici (Backend)" even though neither contains the full phrase.
 */
function titleWordOverlap(roleTitle: string, titleLower: string): number {
  const words = roleTitle
    .toLowerCase()
    .split(/[\s/,()-]+/)
    .filter((w) => w.length > 2 && !TITLE_STOPWORDS.has(w));
  if (words.length === 0) return 0;
  const matches = words.filter((w) => titleLower.includes(w)).length;
  return matches / words.length;
}

// "Genç Yetenek Programı" / graduate-trainee style postings: broad
// company-wide intake programs with no fixed department in the title —
// you apply first and the department gets decided afterward (rotation,
// interview process, etc). These score poorly on keyword-overlap alone
// (there's no "Python" or "Muhasebe" in the title to match against), but
// are often an excellent, even ideal, fit for exactly the öğrenci/stajyer
// and yeni mezun candidates who'd otherwise get penalized out of seeing
// them. Recognize the pattern and boost it instead of letting a thin
// keyword match bury it.
export const TALENT_PROGRAM_TERMS = [
  'yetenek programı',
  'yetenek programi',
  'kariyer programı',
  'kariyer programi',
  'rotasyon programı',
  'rotasyon programi',
  'yeni mezun programı',
  'yeni mezun programi',
  'management trainee',
  'graduate program',
  'graduate programme',
  'trainee program',
  'traineeship',
  'genç yetenek',
  'genc yetenek',
  'talent program',
  'summer intern program',
  'yaz stajı programı'
];

/** True if the title/snippet text looks like a general talent/graduate program posting (see TALENT_PROGRAM_TERMS above for why these need special handling). */
export function isTalentProgramText(text: string): boolean {
  const lower = (text || '').toLowerCase();
  return TALENT_PROGRAM_TERMS.some((t) => lower.includes(t));
}

/**
 * Shared relevance scorer used by every job source (Jooble, and each Google
 * Custom Search site). Keeping this in one place guarantees results from
 * different sources are scored on the same scale, so a combined/merged list
 * can be sorted fairly instead of e.g. all Jooble results clustering at the
 * top just because they were scored differently.
 */
export function scoreJobMatch(
  title: string,
  snippet: string,
  keywords: string[],
  roleTitle: string | undefined,
  careerLevel: CareerLevel | undefined
): { score: number; matched: string[] } {
  const titleLower = (title || '').toLowerCase();
  const haystack = `${title || ''} ${snippet || ''}`.toLowerCase();

  const matched: string[] = [];
  for (const kw of keywords) {
    const k = kw.toLowerCase().trim();
    if (k.length > 1 && haystack.includes(k)) matched.push(kw);
  }

  // Score against a small, fixed denominator instead of the full (often
  // 8-15 item) keyword list — a single job posting rarely contains every
  // extracted keyword, so dividing by the full list artificially caps
  // realistic scores around 20-40%. Capping the denominator at 6 keeps
  // scores meaningful without being misleading.
  let score = Math.round((matched.length / Math.min(Math.max(keywords.length, 1), 6)) * 100);

  // Role title match is a strong relevance signal. Prefer an exact
  // substring match (strongest signal), but fall back to partial word
  // overlap so postings phrased differently from the CV's exact wording
  // (different language, word order, or a qualifier like "(Backend)"
  // tacked on) don't lose the entire boost and get heuristically buried
  // before the AI reranker — which actually reads the full posting — ever
  // gets a chance to judge them properly.
  if (roleTitle) {
    if (titleLower.includes(roleTitle.toLowerCase())) {
      score += 20;
    } else {
      const overlap = titleWordOverlap(roleTitle, titleLower);
      if (overlap >= 0.5) score += 12;
    }
  }

  const isTalentProgram = TALENT_PROGRAM_TERMS.some((t) => haystack.includes(t));

  // Boost internship/entry-level listings for students & recent grads so
  // they visibly rise to the top.
  const isInternTitle = INTERN_TERMS.some((t) => titleLower.includes(t));
  const isJuniorTitle = JUNIOR_TERMS.some((t) => titleLower.includes(t));
  if (careerLevel === 'öğrenci/stajyer' && (isInternTitle || isTalentProgram)) score += 25;
  if (careerLevel === 'yeni mezun' && (isJuniorTitle || isInternTitle || isTalentProgram)) score += 15;
  // These programs have thin keyword overlap by design (no department
  // named yet) — give them a floor so they don't get buried under
  // narrowly-worded postings that happen to share more vocabulary.
  if (isTalentProgram && (careerLevel === 'öğrenci/stajyer' || careerLevel === 'yeni mezun')) {
    score = Math.max(score, 55);
  }

  // Conversely, a senior/management title is a bad fit for a student or
  // recent-grad CV — HARD CAP the score rather than just subtracting a
  // fixed amount. A simple subtraction let a senior-level posting with
  // strong keyword overlap (e.g. shared domain vocabulary like "İş
  // Analitiği") still end up ranked near the top despite being completely
  // wrong for the candidate's level — capping means keyword overlap can
  // never rescue an obvious seniority mismatch. Talent/graduate programs
  // are exempt: their titles sometimes contain "yönetici adayı" ("manager
  // candidate" trainee track) which would otherwise false-positive here.
  const isSeniorTitle = /senior|kıdemli|\blead\b|müdür|direktör|director|head of|\bchief\b|genel müdür|yönetici/i.test(
    titleLower
  );
  if ((careerLevel === 'öğrenci/stajyer' || careerLevel === 'yeni mezun') && isSeniorTitle && !isTalentProgram) {
    score = Math.min(score, 15);
  }

  score = Math.max(0, Math.min(100, score));
  return { score, matched };
}
