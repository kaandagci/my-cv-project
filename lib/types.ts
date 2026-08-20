export type ChangeStatus = 'pending' | 'accepted' | 'rejected' | 'revised';

export interface CVChange {
  id: string;
  section: string;      // e.g. "Deneyim - Şirket A", "Özet", "Beceriler"
  original: string;     // exact snippet found in the CV text
  revised: string;      // AI-suggested replacement
  reason: string;       // why this change improves the CV
  status: ChangeStatus;
  currentText: string;  // the text currently "active" for this change (revised, original, or a user re-edit)
}

export type CareerLevel = 'öğrenci/stajyer' | 'yeni mezun' | 'deneyimli';

export interface AnalyzeResult {
  summary: string;      // short overall assessment
  changes: CVChange[];
  keywords: string[];   // extracted key skills/role keywords, used for job search
  roleTitle: string;    // most likely job title/role this CV targets, e.g. "Frontend Geliştirici"
  careerLevel: CareerLevel; // inferred from CV content (still enrolled in school, no work history, years of experience, etc.)
}

export interface JobMatch {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  matchScore: number; // 0-100
  matchedKeywords: string[];
  source: string; // e.g. "Jooble", "LinkedIn", "Kariyer.net", "Indeed", "SecretCV"
  matchReason?: string; // 1-sentence Turkish reason from the AI reranker, why this posting fits the candidate (only set once AI reranking has actually inspected the posting's full content)
}
