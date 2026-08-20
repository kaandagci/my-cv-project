'use client';

import type { JobMatch } from '../lib/types';

const SOURCE_STYLES: Record<string, string> = {
  Jooble: 'bg-slate-100 text-slate-600',
  LinkedIn: 'bg-sky-100 text-sky-700',
  'Kariyer.net': 'bg-orange-100 text-orange-700',
  Indeed: 'bg-indigo-100 text-indigo-700',
  SecretCV: 'bg-purple-100 text-purple-700'
};

export default function JobMatchCard({ job }: { job: JobMatch }) {
  const scoreColor =
    job.matchScore >= 70
      ? 'bg-emerald-100 text-emerald-700'
      : job.matchScore >= 40
      ? 'bg-amber-100 text-amber-700'
      : 'bg-slate-100 text-slate-600';

  const barColor = job.matchScore >= 70 ? 'bg-emerald-500' : job.matchScore >= 40 ? 'bg-amber-500' : 'bg-slate-400';

  return (
    <a
      href={job.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md hover:border-brand-300 transition"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-slate-900">{job.title}</h3>
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                SOURCE_STYLES[job.source] || 'bg-slate-100 text-slate-600'
              }`}
            >
              {job.source}
            </span>
          </div>
          <p className="text-sm text-slate-500">
            {job.company} · {job.location}
          </p>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${scoreColor}`}>%{job.matchScore} uyum</span>
          <div className="h-1 w-16 rounded-full bg-slate-100 overflow-hidden">
            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, Math.max(0, job.matchScore))}%` }} />
          </div>
        </div>
      </div>
      {job.matchedKeywords.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {job.matchedKeywords.map((k) => (
            <span key={k} className="text-[11px] bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full">
              {k}
            </span>
          ))}
        </div>
      )}
      {job.matchReason ? (
        // Set only once the AI reranker has actually opened this posting's
        // page and judged it — a real, content-based reason instead of the
        // generic search-result snippet.
        <p className="mt-2 text-xs text-emerald-700 bg-emerald-50 rounded-lg px-2 py-1.5">
          🤖 {job.matchReason}
        </p>
      ) : (
        <p className="mt-2 text-xs text-slate-500 line-clamp-2">
          {job.description.replace(/\s+/g, ' ').slice(0, 200)}...
        </p>
      )}
    </a>
  );
}
