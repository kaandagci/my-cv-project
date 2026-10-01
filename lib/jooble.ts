import type { JobMatch } from './types';

// Jooble aggregates listings from 60+ countries, including Turkey. Location is
// a free-text field (city or country name); default to Turkey but let it be
// overridden per-request or via env for a fixed deployment.
const DEFAULT_LOCATION = process.env.JOOBLE_LOCATION || 'Türkiye';

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

export async function searchJoobleJobs(
  keywords: string[],
  location: string = DEFAULT_LOCATION
): Promise<JobMatch[]> {
  const apiKey = process.env.JOOBLE_API_KEY;
  if (!apiKey) {
    throw new Error(
      'JOOBLE_API_KEY tanımlı değil. Vercel proje ayarlarından Environment Variables kısmına ekleyin.'
    );
  }

  const query = keywords.slice(0, 6).join(' ');
  const res = await fetch(`https://jooble.org/api/${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords: query, location, page: '1' })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Jooble API hatası (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const results: JoobleResult[] = data.jobs || [];

  return results
    .map((job, i) => {
      const { score, matched } = scoreJob(job, keywords);
      return {
        id: job.link || `jooble-${i}`,
        title: job.title,
        company: job.company || job.source || 'Bilinmiyor',
        location: job.location || location,
        description: job.snippet || '',
        url: job.link,
        matchScore: score,
        matchedKeywords: matched
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore);
}

function scoreJob(job: JoobleResult, keywords: string[]): { score: number; matched: string[] } {
  const haystack = `${job.title} ${job.snippet}`.toLowerCase();
  const matched: string[] = [];
  for (const kw of keywords) {
    const k = kw.toLowerCase().trim();
    if (k.length > 1 && haystack.includes(k)) matched.push(kw);
  }
  const score = keywords.length === 0 ? 0 : Math.round((matched.length / keywords.length) * 100);
  return { score, matched };
}
