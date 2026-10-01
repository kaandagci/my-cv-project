'use client';

import { useMemo, useState } from 'react';
import DiffCard from '../components/DiffCard';
import JobMatchCard from '../components/JobMatchCard';
import type { CVChange, JobMatch } from '../lib/types';

type Phase = 'upload' | 'ready' | 'analyzing' | 'review';

export default function Home() {
  const [phase, setPhase] = useState<Phase>('upload');
  const [error, setError] = useState<string | null>(null);

  const [filename, setFilename] = useState('');
  const [cvText, setCvText] = useState('');
  const [targetJob, setTargetJob] = useState('');

  const [summary, setSummary] = useState('');
  const [changes, setChanges] = useState<CVChange[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);

  const [jobs, setJobs] = useState<JobMatch[] | null>(null);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobLocation, setJobLocation] = useState('Türkiye');

  const [pdfLoading, setPdfLoading] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);

  // ---- derived: final CV text after applying accepted/revised changes ----
  const finalCvText = useMemo(() => {
    let text = cvText;
    for (const c of changes) {
      if (c.status === 'accepted' || c.status === 'revised') {
        if (text.includes(c.original)) {
          text = text.replace(c.original, c.currentText);
        }
      }
    }
    return text;
  }, [cvText, changes]);

  const pendingCount = changes.filter((c) => c.status === 'pending').length;

  // ---------------- handlers ----------------

  async function handleUpload(file: File) {
    setError(null);
    setUploadLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/parse-cv', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCvText(data.text);
      setFilename(data.filename);
      setPhase('ready');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploadLoading(false);
    }
  }

  async function handleAnalyze() {
    setError(null);
    setPhase('analyzing');
    try {
      const endpoint = targetJob.trim() ? '/api/target-job' : '/api/analyze-cv';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cvText, targetJob: targetJob.trim() || undefined })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSummary(data.summary);
      setChanges(data.changes);
      setKeywords(data.keywords);
      setPhase('review');
    } catch (e: any) {
      setError(e.message);
      setPhase('ready');
    }
  }

  function updateChange(id: string, patch: Partial<CVChange>) {
    setChanges((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function handleAccept(id: string) {
    const c = changes.find((x) => x.id === id);
    if (!c) return;
    updateChange(id, { status: 'accepted', currentText: c.revised });
  }

  function handleReject(id: string) {
    const c = changes.find((x) => x.id === id);
    if (!c) return;
    updateChange(id, { status: 'rejected', currentText: c.original });
  }

  async function handleRevise(id: string, instruction: string) {
    const c = changes.find((x) => x.id === id);
    if (!c) return;
    const res = await fetch('/api/revise-change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ original: c.original, revised: c.revised, instruction, section: c.section })
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      return;
    }
    updateChange(id, { status: 'revised', currentText: data.revised });
  }

  async function handleJobSearch() {
    setError(null);
    setJobsLoading(true);
    try {
      const res = await fetch('/api/job-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords, location: jobLocation })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setJobs(data.jobs);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setJobsLoading(false);
    }
  }

  async function handleDownloadPdf() {
    setError(null);
    setPdfLoading(true);
    try {
      const res = await fetch('/api/generate-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cvText: finalCvText })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cv-guncellenmis.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPdfLoading(false);
    }
  }

  function removeKeyword(k: string) {
    setKeywords((prev) => prev.filter((x) => x !== k));
  }

  function resetAll() {
    setPhase('upload');
    setCvText('');
    setFilename('');
    setTargetJob('');
    setChanges([]);
    setSummary('');
    setKeywords([]);
    setJobs(null);
    setError(null);
  }

  // ---------------- render ----------------

  return (
    <main className="max-w-4xl mx-auto px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">CV Geliştir & İş Eşleştir</h1>
        <p className="text-slate-500 mt-1 text-sm">
          CV'nizi yükleyin, AI destekli önerileri tek tek inceleyin, hedef bir işe göre uyarlayın ve size
          en uygun ilanları bulun. Hiçbir veri sunucuda kalıcı olarak saklanmaz — her şey bu oturumda tutulur.
        </p>
      </header>

      {error && (
        <div className="mb-6 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
          {error}
        </div>
      )}

      {/* STEP 1: Upload */}
      {phase === 'upload' && (
        <section className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-slate-600 mb-4">CV'nizi PDF veya DOCX formatında yükleyin</p>
          <label className="inline-block cursor-pointer rounded-lg bg-brand-600 text-white px-5 py-2.5 text-sm font-medium hover:bg-brand-700 transition">
            {uploadLoading ? 'Yükleniyor...' : 'Dosya Seç'}
            <input
              type="file"
              accept=".pdf,.docx"
              className="hidden"
              disabled={uploadLoading}
              onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
            />
          </label>
        </section>
      )}

      {/* STEP 2: Ready - show parsed text + optional target job + analyze */}
      {(phase === 'ready' || phase === 'analyzing') && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">
              📄 Yüklendi: <span className="font-medium text-slate-700">{filename}</span>
            </p>
            <button onClick={resetAll} className="text-xs text-slate-400 hover:text-slate-600">
              Yeniden yükle
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-700 mb-2">Çıkarılan CV Metni</h2>
            <textarea
              value={cvText}
              onChange={(e) => setCvText(e.target.value)}
              rows={10}
              className="w-full text-sm rounded-lg border border-slate-200 p-3 font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-700 mb-2">
              Hedef Pozisyon <span className="text-slate-400 font-normal">(opsiyonel)</span>
            </h2>
            <textarea
              value={targetJob}
              onChange={(e) => setTargetJob(e.target.value)}
              rows={3}
              placeholder="Örn: 'Kıdemli Frontend Geliştirici' veya bir iş ilanı metnini yapıştırın..."
              className="w-full text-sm rounded-lg border border-slate-200 p-3 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <p className="text-xs text-slate-400 mt-1">
              Girerseniz CV, bu pozisyona göre uyarlanacak şekilde analiz edilir.
            </p>
          </div>

          <button
            onClick={handleAnalyze}
            disabled={phase === 'analyzing'}
            className="w-full rounded-lg bg-brand-600 text-white py-2.5 text-sm font-medium hover:bg-brand-700 disabled:opacity-60 transition"
          >
            {phase === 'analyzing' ? 'Analiz ediliyor... (birkaç saniye sürebilir)' : 'CV\'yi Analiz Et'}
          </button>
        </section>
      )}

      {/* STEP 3: Review */}
      {phase === 'review' && (
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">📄 {filename}</p>
            <button onClick={resetAll} className="text-xs text-slate-400 hover:text-slate-600">
              Baştan başla
            </button>
          </div>

          <div className="rounded-xl bg-brand-50 border border-brand-100 p-4 text-sm text-brand-900">
            <strong>Genel değerlendirme:</strong> {summary}
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-slate-800">
                Önerilen Değişiklikler ({changes.length})
              </h2>
              {pendingCount > 0 && (
                <span className="text-xs text-amber-600">{pendingCount} değişiklik beklemede</span>
              )}
            </div>
            <div className="space-y-3">
              {changes.map((c) => (
                <DiffCard key={c.id} change={c} onAccept={handleAccept} onReject={handleReject} onRevise={handleRevise} />
              ))}
              {changes.length === 0 && (
                <p className="text-sm text-slate-500">Bu CV için önemli bir değişiklik önerilmedi. 🎉</p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-700 mb-2">Güncel CV Önizlemesi</h2>
            <pre className="whitespace-pre-wrap text-xs text-slate-600 max-h-72 overflow-y-auto font-mono">
              {finalCvText}
            </pre>
          </div>

          <button
            onClick={handleDownloadPdf}
            disabled={pdfLoading}
            className="w-full rounded-lg bg-emerald-600 text-white py-2.5 text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 transition"
          >
            {pdfLoading ? 'PDF oluşturuluyor...' : '⬇ Nihai CV\'yi PDF olarak indir'}
          </button>

          {/* STEP 4: Job search */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-700 mb-2">Anahtar Kelimeler</h2>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {keywords.map((k) => (
                <span
                  key={k}
                  onClick={() => removeKeyword(k)}
                  title="Kaldırmak için tıklayın"
                  className="cursor-pointer text-xs bg-slate-100 hover:bg-red-100 hover:text-red-600 text-slate-600 px-2.5 py-1 rounded-full transition"
                >
                  {k} ✕
                </span>
              ))}
            </div>
            <label className="block text-xs text-slate-500 mb-1">Konum (şehir veya ülke)</label>
            <input
              value={jobLocation}
              onChange={(e) => setJobLocation(e.target.value)}
              placeholder="Örn: İstanbul, Ankara, Türkiye"
              className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button
              onClick={handleJobSearch}
              disabled={jobsLoading || keywords.length === 0}
              className="w-full rounded-lg bg-slate-800 text-white py-2.5 text-sm font-medium hover:bg-slate-900 disabled:opacity-60 transition"
            >
              {jobsLoading ? 'İlanlar aranıyor...' : '🔍 Bu CV\'ye Uygun İşleri Bul'}
            </button>
          </div>

          {jobs && (
            <div className="space-y-3">
              <h2 className="text-base font-semibold text-slate-800">
                Eşleşen İlanlar ({jobs.length})
              </h2>
              {jobs.length === 0 && (
                <p className="text-sm text-slate-500">Uygun ilan bulunamadı, farklı anahtar kelimeler deneyin.</p>
              )}
              {jobs.map((j) => (
                <JobMatchCard key={j.id} job={j} />
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
