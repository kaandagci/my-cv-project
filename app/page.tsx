'use client';

import { useMemo, useState } from 'react';
import DiffCard from '../components/DiffCard';
import JobMatchCard from '../components/JobMatchCard';
import type { CareerLevel, CVChange, JobMatch } from '../lib/types';

type Phase = 'upload' | 'ready' | 'analyzing' | 'review';
type ExportFormat = 'pdf' | 'docx';
type ExportLanguage = 'tr' | 'en';

// Mirrors MIN_DISPLAY_SCORE in lib/jobRerank.ts — used here only for the
// manual URL-check result badge coloring, not for any filtering decision.
const MIN_DISPLAY_SCORE_UI = 40;

const CAREER_LEVEL_LABELS: Record<CareerLevel, string> = {
  'öğrenci/stajyer': 'Öğrenci / Stajyer adayı',
  'yeni mezun': 'Yeni mezun',
  deneyimli: 'Deneyimli profesyonel'
};

const STEP_LABELS = ['CV Yükle', 'Analiz İçin Hazır', 'İnceleme & İndirme'] as const;

function phaseToStepIndex(phase: Phase): number {
  if (phase === 'upload') return 0;
  if (phase === 'ready' || phase === 'analyzing') return 1;
  return 2;
}

function StepIndicator({ phase }: { phase: Phase }) {
  const current = phaseToStepIndex(phase);
  return (
    <ol className="mb-8 flex items-center gap-2 sm:gap-3">
      {STEP_LABELS.map((label, i) => {
        const isDone = i < current;
        const isCurrent = i === current;
        return (
          <li key={label} className="flex flex-1 items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition ${
                  isDone
                    ? 'bg-brand-600 text-white'
                    : isCurrent
                    ? 'bg-brand-100 text-brand-700 ring-2 ring-brand-500'
                    : 'bg-slate-100 text-slate-400'
                }`}
              >
                {isDone ? '✓' : i + 1}
              </span>
              <span
                className={`hidden sm:inline text-xs font-medium truncate ${
                  isCurrent ? 'text-slate-800' : isDone ? 'text-slate-500' : 'text-slate-400'
                }`}
              >
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className={`h-0.5 flex-1 rounded-full transition ${isDone ? 'bg-brand-600' : 'bg-slate-200'}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

const TURKISH_CITIES = [
  'Tüm Türkiye',
  'İstanbul',
  'Ankara',
  'İzmir',
  'Bursa',
  'Antalya',
  'Adana',
  'Konya',
  'Gaziantep',
  'Kayseri',
  'Mersin',
  'Eskişehir',
  'Samsun',
  'Denizli',
  'Kocaeli (İzmit)',
  'Şanlıurfa',
  'Trabzon',
  'Diğer (yazın)'
];

export default function Home() {
  const [phase, setPhase] = useState<Phase>('upload');
  const [error, setError] = useState<string | null>(null);

  const [filename, setFilename] = useState('');
  const [cvText, setCvText] = useState('');
  const [targetJob, setTargetJob] = useState('');

  const [summary, setSummary] = useState('');
  const [changes, setChanges] = useState<CVChange[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [roleTitle, setRoleTitle] = useState('');
  const [careerLevel, setCareerLevel] = useState<CareerLevel>('deneyimli');

  const [jobs, setJobs] = useState<JobMatch[] | null>(null);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsLoadingMore, setJobsLoadingMore] = useState(false);
  const [jobPage, setJobPage] = useState(1);
  const [jobNoMoreResults, setJobNoMoreResults] = useState(false);
  const [jobCity, setJobCity] = useState('Tüm Türkiye');
  const [jobCityCustom, setJobCityCustom] = useState('');
  const [jobFallbackNotice, setJobFallbackNotice] = useState<string | null>(null);
  const [jobLevelBoostNotice, setJobLevelBoostNotice] = useState<string | null>(null);
  const [jobSourcesNotice, setJobSourcesNotice] = useState<string | null>(null);
  const [jobSourceWarning, setJobSourceWarning] = useState<string | null>(null);
  const [jobAiRerankNotice, setJobAiRerankNotice] = useState<string | null>(null);

  // Manual "check this specific posting" tool — paste a URL, get an
  // immediate fetch + fit check against the CV, independent of the
  // automatic search above.
  const [checkJobUrl, setCheckJobUrl] = useState('');
  const [checkJobLoading, setCheckJobLoading] = useState(false);
  const [checkJobResult, setCheckJobResult] = useState<{
    status: 'ok' | 'closed' | 'unavailable';
    message?: string;
    title?: string;
    company?: string;
    location?: string;
    score?: number;
    reason?: string;
    url?: string;
  } | null>(null);
  const [checkJobError, setCheckJobError] = useState<string | null>(null);

  // "Tüm Türkiye" is sent as no location filter at all (broadest search);
  // any specific city (including a custom-typed one) is sent as-is.
  const effectiveJobLocation = jobCity === 'Diğer (yazın)' ? jobCityCustom.trim() : jobCity === 'Tüm Türkiye' ? '' : jobCity;

  const [exportFormat, setExportFormat] = useState<ExportFormat>('pdf');
  const [exportLanguage, setExportLanguage] = useState<ExportLanguage>('tr');
  const [downloadLoading, setDownloadLoading] = useState(false);

  // ---- derived: final CV text after applying accepted/revised changes ----
  // Built as a single pass over the ORIGINAL cvText using each change's
  // position within it, rather than sequential string.replace() calls.
  // Sequential replace on a mutating string breaks whenever one accepted
  // change's "original" snippet overlaps or is a substring of another
  // change's "original" snippet — the second replace silently fails to find
  // its target once the first replace has already altered that text, so the
  // accepted suggestion never made it into the exported file. Locating
  // every match against the untouched original text and merging by
  // position fixes that.
  const finalCvText = useMemo(() => {
    type Span = { start: number; end: number; text: string };
    const spans: Span[] = [];

    for (const c of changes) {
      if (c.status !== 'accepted' && c.status !== 'revised') continue;
      const start = cvText.indexOf(c.original);
      if (start === -1) continue; // original snippet no longer present, skip safely
      spans.push({ start, end: start + c.original.length, text: c.currentText });
    }

    spans.sort((a, b) => a.start - b.start);

    let result = '';
    let cursor = 0;
    for (const span of spans) {
      if (span.start < cursor) continue; // overlapping with an already-applied change, skip
      result += cvText.slice(cursor, span.start) + span.text;
      cursor = span.end;
    }
    result += cvText.slice(cursor);

    return result;
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

  const [uploadLoading, setUploadLoading] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);

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
      setRoleTitle(data.roleTitle || '');
      setCareerLevel(data.careerLevel || 'deneyimli');
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
    // Accept means "approve whatever text is currently shown" — it must
    // NOT overwrite currentText with c.revised (the AI's very first
    // suggestion), because if the user already ran a custom "revise" pass,
    // currentText holds their approved custom wording and c.revised is
    // stale. Overwriting it here was silently discarding every custom
    // revision the moment the user clicked Accept afterwards.
    updateChange(id, { status: 'accepted' });
  }

  function handleReject(id: string) {
    // IMPORTANT: do NOT overwrite currentText here. finalCvText already
    // skips any change whose status isn't 'accepted'/'revised', so a
    // rejected change has zero effect on the exported CV regardless of
    // what currentText holds — overwriting it used to permanently replace
    // currentText with the original snippet, which meant clicking "Kabul
    // et" again afterwards had nothing left to restore (currentText was
    // already the original, so "accepting" silently produced no change).
    // Leaving currentText untouched means the AI suggestion — or the
    // user's own custom revision — is still sitting there ready to go the
    // moment they change their mind and accept it again.
    updateChange(id, { status: 'rejected' });
  }

  async function handleRevise(id: string, instruction: string) {
    const c = changes.find((x) => x.id === id);
    if (!c) return;
    // Send currentText (not c.revised) as the "previous suggestion" context
    // — c.revised is frozen at the AI's very first suggestion. If the user
    // already revised this change once, c.currentText holds that result;
    // using c.revised here would silently discard their first instruction
    // every time they revise again (e.g. "kısalt" then "daha resmi yap"
    // would ignore the shortening and only apply to the original text).
    const res = await fetch('/api/revise-change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ original: c.original, revised: c.currentText, instruction, section: c.section })
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
    setJobFallbackNotice(null);
    setJobLevelBoostNotice(null);
    setJobSourcesNotice(null);
    setJobSourceWarning(null);
    setJobAiRerankNotice(null);
    setJobNoMoreResults(false);
    setJobPage(1);
    setJobsLoading(true);
    try {
      const data = await runJobSearchRequest(1, []);
      setJobs(data.jobs);
      applyJobSearchNotices(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setJobsLoading(false);
    }
  }

  // "Daha fazla tara": asks the same search for the NEXT page of results,
  // excluding every posting already shown so far, and appends whatever
  // comes back to the existing list rather than replacing it.
  async function handleLoadMoreJobs() {
    if (!jobs) return;
    setError(null);
    setJobsLoadingMore(true);
    try {
      const nextPage = jobPage + 1;
      const data = await runJobSearchRequest(
        nextPage,
        jobs.map((j) => j.url)
      );
      if (data.jobs.length === 0) {
        setJobNoMoreResults(true);
      } else {
        setJobs([...(jobs || []), ...data.jobs]);
        setJobPage(nextPage);
      }
      applyJobSearchNotices(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setJobsLoadingMore(false);
    }
  }

  async function runJobSearchRequest(page: number, excludeUrls: string[]) {
    const res = await fetch('/api/job-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keywords,
        location: effectiveJobLocation,
        roleTitle,
        careerLevel,
        // Real CV content, not just a handful of extracted keywords, so
        // the AI compatibility check can judge actual fit (seniority,
        // specific tools/skills, domain) instead of guessing from a thin
        // keyword list — this is what "%0 uyum" postings were slipping
        // through: the reranker never actually saw what the candidate's
        // background was.
        cvText: finalCvText.slice(0, 6000),
        page,
        excludeUrls
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  }

  function applyJobSearchNotices(data: any) {
    if (data.aiRerankApplied) {
      const closedNote =
        data.droppedClosedCount > 0 ? ` (${data.droppedClosedCount} tanesi kapanmış/süresi dolmuş olduğu için elendi)` : '';
      setJobAiRerankNotice(
        `${data.totalFound} ilan arasından ${data.aiInspectedCount} tanesinin içeriği incelendi${closedNote}, CV'nize en uygun ${data.jobs.length} ilan bulundu.`
      );
    } else if (typeof data.totalFound === 'number' && data.totalFound > data.jobs.length) {
      setJobAiRerankNotice(
        `${data.totalFound} ham sonuç bulundu. Detaylı AI değerlendirmesi bu sefer uygulanamadı (GEMINI_API_KEY kontrol edin) — sonuçlar anahtar kelime eşleşmesine göre sıralandı.`
      );
    }
    if (data.fallbackApplied) {
      setJobFallbackNotice(
        `"${effectiveJobLocation}" konumunda ilan bulunamadı, sonuçlar tüm konumlar için gösteriliyor.`
      );
    }
    if (data.careerLevelBoostApplied && (careerLevel === 'öğrenci/stajyer' || careerLevel === 'yeni mezun')) {
      setJobLevelBoostNotice(
        `Profiliniz "${CAREER_LEVEL_LABELS[careerLevel]}" olarak tespit edildi — bu seviyeye uygun ilanlar önceliklendirildi.`
      );
    }
    if (Array.isArray(data.sourcesUsed) && data.sourcesUsed.length > 0) {
      setJobSourcesNotice(`Kaynaklar: ${data.sourcesUsed.join(', ')}`);
    } else if (data.webSearchConfigured && (!Array.isArray(data.webSourceErrors) || data.webSourceErrors.length === 0)) {
      // SERPER_API_KEY is set and every call technically succeeded (no
      // errors), but LinkedIn/Kariyer.net/Indeed/SecretCV still
      // contributed zero postings — worth calling out explicitly so this
      // doesn't look identical to "not configured" or "API error", since
      // the fix (if any) is different: try different/broader keywords.
      setJobSourcesNotice(
        'LinkedIn/Kariyer.net/Indeed/SecretCV taramasında bu anahtar kelimelerle eşleşen ilan bulunamadı (Jooble sonuçları varsa aşağıda listelidir).'
      );
    }
    if (!data.webSearchConfigured) {
      setJobSourceWarning(
        'LinkedIn/Kariyer.net/Indeed/SecretCV taraması etkin değil — SERPER_API_KEY ortam değişkenini kontrol edin.'
      );
    } else if (Array.isArray(data.webSourceErrors) && data.webSourceErrors.length > 0) {
      // All 4 sites usually fail with the exact same underlying error
      // (e.g. invalid/exhausted Serper key) — showing it 4 times over is
      // noisy, so collapse identical messages into one line.
      const byMessage = new Map<string, string[]>();
      for (const e of data.webSourceErrors as { label: string; message: string }[]) {
        const list = byMessage.get(e.message) || [];
        list.push(e.label);
        byMessage.set(e.message, list);
      }
      const lines = Array.from(byMessage.entries()).map(([message, labels]) => `${labels.join(', ')}: ${message}`);
      setJobSourceWarning(lines.join('\n\n'));
    }
    // Previously a Jooble-side failure (e.g. wrong API host for the key)
    // was only logged server-side and silently showed up as "0 Jooble
    // results" with no visible explanation — surface it the same way
    // Serper source errors already are.
    if (data.joobleError) {
      setJobSourceWarning((prev) => (prev ? `${prev}\n\nJooble: ${data.joobleError}` : `Jooble: ${data.joobleError}`));
    }
  }

  async function handleCheckJobUrl() {
    if (!checkJobUrl.trim()) return;
    setCheckJobError(null);
    setCheckJobResult(null);
    setCheckJobLoading(true);
    try {
      const res = await fetch('/api/check-job-fit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: checkJobUrl.trim(), cvText: finalCvText.slice(0, 6000) })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCheckJobResult(data);
    } catch (e: any) {
      setCheckJobError(e.message);
    } finally {
      setCheckJobLoading(false);
    }
  }

  async function handleDownload() {
    setError(null);
    setDownloadLoading(true);
    try {
      // Always route through /api/translate-cv for the SELECTED export
      // language, rather than guessing client-side whether the CV is
      // "already" in that language and skipping the call. A client-side
      // guess (checking for Turkish characters/words) has real edge cases
      // — e.g. a CV that's mostly English but has one Turkish city/word in
      // it — and any misfire there means the wrong-language file gets
      // downloaded with no visible error. Gemini determines the CV's
      // actual current language itself and, per the system prompt, leaves
      // it untouched (no rewrite) if it's already the target language — so
      // this is reliable rather than just "safe but slow".
      const tRes = await fetch('/api/translate-cv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cvText: finalCvText, targetLanguage: exportLanguage })
      });
      const tData = await tRes.json();
      if (!tRes.ok) throw new Error(tData.error);
      const textToExport = tData.translatedText;

      const endpoint = exportFormat === 'docx' ? '/api/generate-docx' : '/api/generate-pdf';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cvText: textToExport })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      const blob = await res.blob();
      if (!blob || blob.size === 0) {
        throw new Error('Dosya boş döndü, lütfen tekrar deneyin.');
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const langSuffix = exportLanguage === 'en' ? '-en' : '-tr';
      a.download = `cv-guncellenmis${langSuffix}.${exportFormat}`;
      // The anchor must be attached to the DOM before .click() for the
      // download to actually trigger in Safari/iOS (and some webviews) —
      // calling .click() on a detached element silently does nothing there,
      // which is why the button appeared to not work at all.
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke slightly later so the browser has time to start the download
      // before the blob URL is invalidated.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDownloadLoading(false);
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
    setRoleTitle('');
    setCareerLevel('deneyimli');
    setJobs(null);
    setJobFallbackNotice(null);
    setJobLevelBoostNotice(null);
    setJobSourcesNotice(null);
    setJobSourceWarning(null);
    setError(null);
  }

  // ---------------- render ----------------

  return (
    <main className="max-w-4xl mx-auto px-4 py-10">
      <header className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white text-base font-bold shadow-sm">
            CV
          </div>
          <h1 className="text-2xl font-bold text-slate-900">CV Geliştir & İş Eşleştir</h1>
        </div>
        <p className="text-slate-500 text-sm max-w-2xl">
          CV'nizi yükleyin, AI destekli önerileri tek tek inceleyin, hedef bir işe göre uyarlayın ve size
          en uygun ilanları bulun. Hiçbir veri sunucuda kalıcı olarak saklanmaz — her şey bu oturumda tutulur.
        </p>
      </header>

      <StepIndicator phase={phase} />

      {error && (
        <div className="mb-6 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
          <span className="mt-0.5">⚠️</span>
          <p className="flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 leading-none">
            ✕
          </button>
        </div>
      )}

      {/* STEP 1: Upload */}
      {phase === 'upload' && (
        <section
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragActive(true);
          }}
          onDragLeave={() => setIsDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragActive(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleUpload(file);
          }}
          className={`rounded-2xl border-2 border-dashed bg-white p-10 text-center transition ${
            isDragActive ? 'border-brand-500 bg-brand-50' : 'border-slate-300'
          }`}
        >
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-2xl">
            📄
          </div>
          <p className="text-slate-700 font-medium mb-1">CV'nizi buraya sürükleyin veya seçin</p>
          <p className="text-slate-400 text-xs mb-4">PDF veya DOCX formatında, en fazla birkaç MB</p>
          <label className="inline-block cursor-pointer rounded-lg bg-brand-600 text-white px-5 py-2.5 text-sm font-medium hover:bg-brand-700 shadow-sm shadow-brand-600/20 transition">
            {uploadLoading ? (
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                Yükleniyor...
              </span>
            ) : (
              'Dosya Seç'
            )}
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
            className="w-full rounded-lg bg-brand-600 text-white py-2.5 text-sm font-medium hover:bg-brand-700 disabled:opacity-60 transition shadow-sm shadow-brand-600/20 flex items-center justify-center gap-2"
          >
            {phase === 'analyzing' ? (
              <>
                <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                Analiz ediliyor... (birkaç saniye sürebilir)
              </>
            ) : (
              "✨ CV'yi Analiz Et"
            )}
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

          <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
            <span className="flex items-center gap-2">
              <span className="text-slate-400">Hedef rol:</span>
              <input
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
                placeholder="örn. Frontend Geliştirici"
                className="text-sm font-medium text-slate-800 rounded-lg border border-slate-200 px-2 py-1 w-56 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </span>
            <span className="flex items-center gap-2">
              <span className="text-slate-400">Kariyer seviyesi:</span>
              <select
                value={careerLevel}
                onChange={(e) => setCareerLevel(e.target.value as CareerLevel)}
                className="text-sm rounded-lg border border-slate-200 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="öğrenci/stajyer">Öğrenci / Stajyer adayı</option>
                <option value="yeni mezun">Yeni mezun</option>
                <option value="deneyimli">Deneyimli profesyonel</option>
              </select>
            </span>
            <span className="text-xs text-slate-400">
              (İş aramadan önce her ikisini de düzeltebilirsiniz — arama sonuçlarının kalitesini doğrudan etkiler)
            </span>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-base font-semibold text-slate-800">
                Önerilen Değişiklikler ({changes.length})
              </h2>
              {pendingCount > 0 && (
                <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-100 rounded-full px-2.5 py-0.5">
                  {pendingCount} beklemede
                </span>
              )}
            </div>
            {changes.length > 0 && (
              <div className="mb-3 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-brand-500 transition-all"
                  style={{ width: `${Math.round(((changes.length - pendingCount) / changes.length) * 100)}%` }}
                />
              </div>
            )}
            <div className="space-y-3">
              {changes.map((c) => (
                <DiffCard key={c.id} change={c} onAccept={handleAccept} onReject={handleReject} onRevise={handleRevise} />
              ))}
              {changes.length === 0 && (
                <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-xl p-4">
                  Bu CV için önemli bir değişiklik önerilmedi. 🎉
                </p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-700 mb-2">Güncel CV Önizlemesi</h2>
            <pre className="whitespace-pre-wrap text-xs text-slate-600 max-h-72 overflow-y-auto font-mono">
              {finalCvText}
            </pre>
          </div>

          {/* Download: format + language */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-700">Nihai CV'yi İndir</h2>
            <div className="flex flex-wrap gap-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Dosya formatı</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setExportFormat('pdf')}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition ${
                      exportFormat === 'pdf'
                        ? 'bg-brand-600 border-brand-600 text-white'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    PDF
                  </button>
                  <button
                    onClick={() => setExportFormat('docx')}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition ${
                      exportFormat === 'docx'
                        ? 'bg-brand-600 border-brand-600 text-white'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Word (.docx)
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Dil</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setExportLanguage('tr')}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition ${
                      exportLanguage === 'tr'
                        ? 'bg-brand-600 border-brand-600 text-white'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Türkçe
                  </button>
                  <button
                    onClick={() => setExportLanguage('en')}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition ${
                      exportLanguage === 'en'
                        ? 'bg-brand-600 border-brand-600 text-white'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    English
                  </button>
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-400">
              İndirmeden önce CV, seçtiğiniz dille ({exportLanguage === 'en' ? 'İngilizce' : 'Türkçe'}) eşleşecek şekilde Gemini
              tarafından kontrol edilir/gerekirse çevrilir (birkaç saniye sürebilir).
            </p>
            <button
              onClick={handleDownload}
              disabled={downloadLoading}
              className="w-full rounded-lg bg-emerald-600 text-white py-2.5 text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 transition shadow-sm shadow-emerald-600/20 flex items-center justify-center gap-2"
            >
              {downloadLoading ? (
                <>
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                  Kontrol ediliyor ve oluşturuluyor...
                </>
              ) : (
                `⬇ ${exportFormat === 'docx' ? 'Word' : 'PDF'} olarak indir (${exportLanguage === 'en' ? 'English' : 'Türkçe'})`
              )}
            </button>
          </div>

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
              {keywords.length === 0 && (
                <p className="text-xs text-slate-400 italic">
                  Anahtar kelime yok — iş araması için en az bir tane gerekli.
                </p>
              )}
            </div>
            <label className="block text-xs text-slate-500 mb-1">Şehir</label>
            <select
              value={jobCity}
              onChange={(e) => setJobCity(e.target.value)}
              className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 mb-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {TURKISH_CITIES.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
            {jobCity === 'Diğer (yazın)' && (
              <input
                value={jobCityCustom}
                onChange={(e) => setJobCityCustom(e.target.value)}
                placeholder="Şehir veya ülke adı yazın (örn: Berlin)"
                className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            )}
            <button
              onClick={handleJobSearch}
              disabled={jobsLoading || keywords.length === 0}
              className="w-full rounded-lg bg-slate-800 text-white py-2.5 text-sm font-medium hover:bg-slate-900 disabled:opacity-60 transition mt-1 flex items-center justify-center gap-2"
            >
              {jobsLoading ? (
                <>
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                  İlanlar aranıyor ve CV'nizle karşılaştırılıyor... (birkaç on saniye sürebilir)
                </>
              ) : (
                "🔍 Bu CV'ye Uygun İşleri Bul"
              )}
            </button>
          </div>

          <div className="border border-slate-200 rounded-xl p-4 space-y-2">
            <h2 className="text-sm font-semibold text-slate-800">Belirli Bir İlanı Kontrol Et</h2>
            <p className="text-xs text-slate-500">
              Bir LinkedIn/Kariyer.net/Indeed ilan linkini yapıştırın — sayfasına girip içeriğini okuyup CV'nizle
              uyumunu değerlendireyim.
            </p>
            <div className="flex gap-2">
              <input
                value={checkJobUrl}
                onChange={(e) => setCheckJobUrl(e.target.value)}
                placeholder="https://www.linkedin.com/jobs/view/..."
                className="flex-1 text-sm rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <button
                onClick={handleCheckJobUrl}
                disabled={checkJobLoading || !checkJobUrl.trim()}
                className="rounded-lg bg-slate-800 text-white px-4 py-2 text-sm font-medium hover:bg-slate-900 disabled:opacity-60 transition whitespace-nowrap"
              >
                {checkJobLoading ? 'Kontrol ediliyor...' : 'Kontrol Et'}
              </button>
            </div>
            {checkJobError && <p className="text-xs text-red-600">⚠️ {checkJobError}</p>}
            {checkJobResult && checkJobResult.status === 'closed' && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                🔒 {checkJobResult.message}
              </p>
            )}
            {checkJobResult && checkJobResult.status === 'unavailable' && (
              <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                ⚠️ {checkJobResult.message}
              </p>
            )}
            {checkJobResult && checkJobResult.status === 'ok' && (
              <div className="rounded-lg border border-slate-200 p-3 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{checkJobResult.title}</p>
                    <p className="text-xs text-slate-500">
                      {checkJobResult.company} · {checkJobResult.location}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-semibold rounded-full px-2 py-0.5 whitespace-nowrap ${
                      (checkJobResult.score || 0) >= 60
                        ? 'bg-emerald-100 text-emerald-700'
                        : (checkJobResult.score || 0) >= MIN_DISPLAY_SCORE_UI
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-red-100 text-red-700'
                    }`}
                  >
                    %{checkJobResult.score} uyum
                  </span>
                </div>
                {checkJobResult.reason && <p className="text-xs text-slate-600">{checkJobResult.reason}</p>}
                <a
                  href={checkJobResult.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-brand-700 hover:underline inline-block mt-1"
                >
                  İlana git ↗
                </a>
              </div>
            )}
          </div>

          {jobs && (
            <div className="space-y-3">
              <h2 className="text-base font-semibold text-slate-800">
                Eşleşen İlanlar ({jobs.length})
              </h2>
              {jobAiRerankNotice && (
                <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                  🤖 {jobAiRerankNotice}
                </p>
              )}
              {jobSourcesNotice && (
                <p className="text-xs text-slate-500">{jobSourcesNotice}</p>
              )}
              {jobSourceWarning && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  ⚠️ {jobSourceWarning}
                </p>
              )}
              {jobLevelBoostNotice && (
                <p className="text-xs text-brand-700 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2">
                  🎓 {jobLevelBoostNotice}
                </p>
              )}
              {jobFallbackNotice && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  ℹ️ {jobFallbackNotice}
                </p>
              )}
              {jobs.length === 0 && (
                <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-xl p-4">
                  Uygun ilan bulunamadı, farklı anahtar kelimeler deneyin.
                </p>
              )}
              {jobs.map((j) => (
                <JobMatchCard key={j.id} job={j} />
              ))}
              {jobs.length > 0 && !jobNoMoreResults && (
                <button
                  onClick={handleLoadMoreJobs}
                  disabled={jobsLoadingMore}
                  className="w-full rounded-lg border border-slate-200 text-slate-700 py-2.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60 transition flex items-center justify-center gap-2"
                >
                  {jobsLoadingMore ? (
                    <>
                      <span className="h-3.5 w-3.5 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
                      Daha fazla ilan taranıyor...
                    </>
                  ) : (
                    '🔄 Daha Fazla Tara'
                  )}
                </button>
              )}
              {jobNoMoreResults && (
                <p className="text-xs text-slate-400 text-center">Bulunan {jobs.length} ilanın hepsi bu kadar — başka uygun ilan kalmadı.</p>
              )}
            </div>
          )}

          {!jobs && jobsLoading && (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 animate-pulse">
                  <div className="h-3.5 w-2/3 rounded bg-slate-200 mb-2" />
                  <div className="h-3 w-1/3 rounded bg-slate-100 mb-3" />
                  <div className="h-3 w-full rounded bg-slate-100" />
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
