'use client';

import type { JobMatch } from '../lib/types';

export default function JobMatchCard({ job }: { job: JobMatch }) {
  const scoreColor =
    job.matchScore >= 70
      ? 'bg-emerald-100 text-emerald-700'
      : job.matchScore >= 40
      ? 'bg-amber-100 text-amber-700'
      : 'bg-slate-100 text-slate-600';

  return (
    <a
      href={job.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md hover:border-brand-300 transition"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">{job.title}</h3>
          <p className="text-sm text-slate-500">
            {job.company} · {job.location}
          </p>
        </div>
        <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${scoreColor}`}>
          %{job.matchScore} uyum
        </span>
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
      <p className="mt-2 text-xs text-slate-500 line-clamp-2">
        {job.description.replace(/\s+/g, ' ').slice(0, 200)}...
      </p>
    </a>
  );
}
