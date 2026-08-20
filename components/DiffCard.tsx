'use client';

import { useState } from 'react';
import type { CVChange } from '../lib/types';

export default function DiffCard({
  change,
  onAccept,
  onReject,
  onRevise
}: {
  change: CVChange;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onRevise: (id: string, instruction: string) => Promise<void>;
}) {
  const [showRevisePanel, setShowRevisePanel] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);

  const statusStyles: Record<string, string> = {
    pending: 'border-slate-200',
    accepted: 'border-emerald-400 ring-1 ring-emerald-100',
    rejected: 'border-red-300 ring-1 ring-red-100 opacity-70',
    revised: 'border-brand-400 ring-1 ring-brand-100'
  };

  const statusLabel: Record<string, string> = {
    pending: 'Beklemede',
    accepted: 'Kabul edildi',
    rejected: 'Reddedildi',
    revised: 'Yeniden düzenlendi'
  };

  const statusBadge: Record<string, string> = {
    pending: 'bg-slate-100 text-slate-600',
    accepted: 'bg-emerald-100 text-emerald-700',
    rejected: 'bg-red-100 text-red-700',
    revised: 'bg-brand-100 text-brand-700'
  };

  async function submitRevise() {
    if (!instruction.trim()) return;
    setLoading(true);
    try {
      await onRevise(change.id, instruction.trim());
      setShowRevisePanel(false);
      setInstruction('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm transition ${statusStyles[change.status]}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {change.section}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge[change.status]}`}>
          {statusLabel[change.status]}
        </span>
      </div>

      <div className="space-y-2 text-sm">
        <p>
          <span className={change.status === 'rejected' ? 'diff-kept' : 'diff-strike'}>{change.original}</span>
        </p>
        {change.status === 'rejected' ? (
          <p className="text-xs text-slate-400 italic">
            Bu değişiklik reddedildi — CV'de orijinal metin korunacak. Öneri: "{change.currentText}"
          </p>
        ) : (
          <p>
            <span className="diff-new">{change.currentText}</span>
          </p>
        )}
      </div>

      <p className="mt-3 text-xs text-slate-500 italic">💡 {change.reason}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => onAccept(change.id)}
          className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition"
        >
          ✓ Kabul et
        </button>
        <button
          onClick={() => onReject(change.id)}
          className="text-xs px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition"
        >
          ✕ Reddet
        </button>
        <button
          onClick={() => setShowRevisePanel((s) => !s)}
          className="text-xs px-3 py-1.5 rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300 transition"
        >
          ✎ Böyle revize et...
        </button>
      </div>

      {showRevisePanel && (
        <div className="mt-3 flex gap-2">
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Örn: Daha kısa yaz, sayısal sonuç ekle..."
            className="flex-1 text-sm rounded-lg border border-slate-300 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
            onKeyDown={(e) => e.key === 'Enter' && submitRevise()}
          />
          <button
            onClick={submitRevise}
            disabled={loading || !instruction.trim()}
            className="text-xs px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 transition"
          >
            {loading ? '...' : 'Gönder'}
          </button>
        </div>
      )}
    </div>
  );
}
