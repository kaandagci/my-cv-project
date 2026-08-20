// Shared CV text -> structured-document parser used by both the PDF and
// Word (DOCX) export routes, so both formats look consistent and both get
// the same bug fixes in one place.

export type CvBlock =
  | { type: 'heading'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'paragraph'; text: string };

export interface ParsedCv {
  name: string | null;
  contactLine: string | null;
  blocks: CvBlock[];
}

// Section header keywords, Turkish AND English — real CVs mix both,
// especially ones tailored to a target job description that was pasted in
// English (this is exactly why headings like "ACADEMIC & TECHNICAL
// PROJECTS" were previously falling through as plain paragraphs instead of
// being styled as section titles).
const HEADING_KEYWORDS = [
  // Turkish
  'özet', 'profil', 'hakkımda', 'deneyim', 'iş deneyimi', 'çalışma deneyimi',
  'mesleki deneyim', 'eğitim', 'öğrenim', 'beceriler', 'yetenekler',
  'teknik beceriler', 'projeler', 'akademik ve teknik projeler',
  'sertifikalar', 'sertifikalar ve kurslar', 'diller', 'yabancı diller',
  'referanslar', 'gönüllülük', 'gönüllü çalışmalar', 'hobiler', 'ilgi alanları',
  'iletişim', 'kişisel bilgiler', 'ödüller', 'yayınlar', 'staj', 'stajlar',
  'kurslar', 'katıldığım etkinlikler', 'sosyal sorumluluk',
  // English
  'summary', 'profile', 'about', 'about me', 'objective', 'experience',
  'work experience', 'professional experience', 'employment history',
  'education', 'academic background', 'skills', 'technical skills',
  'core skills', 'competencies', 'projects', 'academic projects',
  'academic & technical projects', 'technical projects', 'certifications',
  'certificates', 'courses', 'languages', 'references', 'volunteering',
  'volunteer experience', 'hobbies', 'interests', 'contact', 'contact info',
  'personal information', 'awards', 'honors', 'publications', 'internships',
  'activities', 'extracurricular activities', 'leadership'
];

const HEADING_KEYWORD_SET = new Set(HEADING_KEYWORDS.map((k) => k.toLowerCase()));

const BULLET_PREFIX_REGEX = /^([•\-–*▪●○]|\d+[.)])\s+/;
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_REGEX = /(\+?\d[\d\s()./-]{6,}\d)/;

function stripDecoration(line: string): string {
  return line.replace(/[*_#>]/g, '').trim();
}

function looksLikeHeading(rawLine: string): boolean {
  const line = stripDecoration(rawLine).replace(/:\s*$/, '');
  if (!line || line.length > 60) return false;

  const lower = line.toLowerCase();
  if (HEADING_KEYWORD_SET.has(lower)) return true;

  // Heuristic for headings not in our keyword list: short, ALL CAPS (or
  // Title Case with &/and), no ending period, no bullet prefix, no email —
  // e.g. "ACADEMIC & TECHNICAL PROJECTS", "PROFESSIONAL SUMMARY".
  if (BULLET_PREFIX_REGEX.test(rawLine.trim())) return false;
  if (EMAIL_REGEX.test(line)) return false;
  if (/[.]{1}$/.test(line)) return false;

  const letters = line.replace(/[^a-zA-ZÇĞİıÖŞÜçğıöşü]/g, '');
  if (letters.length < 3) return false;

  const isAllCaps = letters === letters.toUpperCase() && /[A-ZÇĞİÖŞÜ]/.test(letters);
  const wordCount = line.split(/\s+/).filter(Boolean).length;

  return isAllCaps && wordCount <= 6;
}

/**
 * Parses raw CV text (as extracted from PDF/DOCX or edited by the user)
 * into a structured document: a detected name, an optional contact line
 * (email/phone/location, usually right under the name), and a sequence of
 * heading / bullet / paragraph blocks.
 */
export function parseCvText(cvText: string, explicitName?: string): ParsedCv {
  const rawLines = cvText.split('\n').map((l) => l.trim());

  let name: string | null = explicitName?.trim() || null;
  let contactLine: string | null = null;
  let startIndex = 0;

  // Auto-detect the name as the first non-empty line, IF it wasn't passed
  // explicitly and it doesn't itself look like a section heading or bullet.
  // Previously the caller had to pass fullName separately while the same
  // line also stayed in the body text, so the name was rendered TWICE at
  // the top of the exported file.
  const firstNonEmpty = rawLines.findIndex((l) => l.length > 0);
  if (firstNonEmpty !== -1) {
    const candidate = stripDecoration(rawLines[firstNonEmpty]);
    if (!name && candidate && candidate.length <= 60 && !looksLikeHeading(candidate) && !BULLET_PREFIX_REGEX.test(candidate)) {
      name = candidate;
      startIndex = firstNonEmpty + 1;
    } else if (name) {
      // Explicit name given but it also happens to be the first line of the
      // body text — skip that duplicate line too.
      if (candidate.toLowerCase() === name.toLowerCase()) {
        startIndex = firstNonEmpty + 1;
      }
    }
  }

  // The line right after the name is very often contact info
  // (email / phone / location) — detect and style it separately.
  const nextNonEmpty = rawLines.findIndex((l, i) => i >= startIndex && l.length > 0);
  if (nextNonEmpty !== -1) {
    const candidate = stripDecoration(rawLines[nextNonEmpty]);
    if (candidate && (EMAIL_REGEX.test(candidate) || PHONE_REGEX.test(candidate)) && !looksLikeHeading(candidate)) {
      contactLine = candidate;
      startIndex = nextNonEmpty + 1;
    }
  }

  const blocks: CvBlock[] = [];
  for (let i = startIndex; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (!line) continue;

    if (looksLikeHeading(line)) {
      blocks.push({ type: 'heading', text: stripDecoration(line).replace(/:\s*$/, '') });
      continue;
    }

    const bulletMatch = line.match(BULLET_PREFIX_REGEX);
    if (bulletMatch) {
      blocks.push({ type: 'bullet', text: line.slice(bulletMatch[0].length).trim() });
      continue;
    }

    blocks.push({ type: 'paragraph', text: line });
  }

  return { name, contactLine, blocks };
}
