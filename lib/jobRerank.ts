import { callGemini, extractJson } from './gemini';
import { fetchJobPostingText, type JobPageFetchResult } from './jobPageFetch';
import type { CareerLevel, JobMatch } from './types';

// Bounds what the reranker actually does, to keep this inside a single
// Vercel function invocation:
//  - only the top N candidates (by the existing keyword-based heuristic
//    score) get their full page fetched and sent to Gemini — fetching and
//    judging all 40+ raw hits from 4 sites would be slow and expensive for
//    little extra benefit, since the heuristic pre-filter already discards
//    the clearly-irrelevant ones.
//  - fetches run in small concurrent batches rather than 1-by-1 (too slow)
//    or all-at-once (some sites rate-limit/block bursts).
const MAX_CANDIDATES_TO_INSPECT = 30;
// Higher than before (was 6) since MAX_CANDIDATES_TO_INSPECT went up to 30
// — at concurrency 6 that's 5 sequential batches × up to 6s timeout each
// (30s) before Gemini even runs, uncomfortably close to the route's 60s
// budget in a worst case. At 10, it's 3 batches (~18s worst case).
const FETCH_CONCURRENCY = 10;
const MAX_AI_RESULTS = 12;
// A posting that scores 15% or 0% isn't "a match, just not the best one" —
// it's not a match. Showing it alongside genuinely suitable postings (as
// three "results" with terrible scores was doing) undermines the entire
// point of curating. Anything below this is dropped from the final list
// entirely rather than displayed as if it were a real recommendation.
const MIN_DISPLAY_SCORE = 40;

interface RerankSelection {
  id: string;
  score: number;
  reason: string;
  openForApplications: boolean;
}

const SYSTEM_PROMPT = `Sen deneyimli, titiz bir kariyer danışmanısın. Sana bir adayın CV'si (veya en azından hedef pozisyonu/becerileri) ve bir dizi GERÇEK iş ilanı (başlık, şirket, konum, ilanın kendi sayfasından alınmış TAM içerik) verilecek.

Görevin: ilanların içeriğini dikkatlice okuyup adaya GERÇEKTEN uygun olanları seçmek. Sadece anahtar kelime eşleşmesine bakma; şunları değerlendir:
- Pozisyonun seviyesi (junior/orta/senior) adayın seviyesiyle uyuşuyor mu?
- İlanda istenen teknoloji/beceriler adayınkilerle örtüşüyor mu?
- Sektör/alan adayın hedefiyle mantıklı mı?
- İlan içeriği okunabilir ve gerçek, TEK bir pozisyona ait bir iş tanımı mı?

ÇOK ÖNEMLİ - Başvurulabilirlik kontrolü: Her ilan için "openForApplications" alanını doldurman ZORUNLU. İlan içeriğini dikkatlice oku ve şunlara benzer HERHANGİ bir ifade var mı diye kontrol et (Türkçe/İngilizce, hangi kelimelerle yazılmış olursa olsun — sabit bir kalıp arama, ANLAMINA bak): "artık başvuru kabul etmiyor", "şirket aradığı adayı buldu", "ilanın süresi dolmuş", "yayından kaldırılmış", "no longer accepting applications", "position filled", "this job has expired", vb. Böyle bir ifade VARSA openForApplications: false yap ve bu ilanı SEÇME (score'dan bağımsız olarak). İçerikte böyle bir ifade YOKSA ve ilan normal bir aktif ilan gibi görünüyorsa openForApplications: true yap.
İstisna: içerik "(içerik alınamadı...)" notuyla geldiyse (yani gerçek sayfa içeriği okunamadı, sadece eski arama sonucu özeti var) openForApplications'ı true kabul et ama bunu emin olamadığını belirterek gerekçende söyle — bu durumda kesin bilgi yok, kapalı olduğunu VARSAYMA ama açık olduğunu da garanti etme.

ÖNEMLİ - Genel yetenek/kariyer programları: "Genç Yetenek Programı", "Management Trainee", "Graduate Program", "Rotasyon Programı" gibi ilanlarda genelde SABİT BİR DEPARTMAN belirtilmez — aday önce programa başvurur, departman/ekip ataması sonradan (mülakat/rotasyon sürecinde) yapılır. Bu yüzden ilan metninde adayın spesifik anahtar kelimeleriyle (örn. "Python", "SQL") doğrudan bir eşleşme bulamayabilirsin. BU NORMALDİR — böyle programları sırf spesifik teknik kelime geçmiyor diye ELEME. Öğrenci/stajyer veya yeni mezun bir aday için bu tür genel programlar genellikle ÇOK UYGUN bir seçenektir; sadece adayın eğitim seviyesi/tecrübesi programın hedef kitlesiyle uyuşuyorsa seç ve gerekçede bunun genel bir yetenek/kariyer programı olduğunu belirt. Bu tür programlar genelde SÜREKLİ/UZUN SÜRELİ açık kalır (yıl boyu başvuru alabilir) — ilanın "birkaç ay önce" Google'da görülmüş olması bu tür programlar için normaldir, kapalı olduğu anlamına GELMEZ; kapalı olup olmadığına yalnızca içerikteki gerçek başvuru durumu ifadesine bakarak karar ver, tarihe göre değil.

ÖNEMLİ: Bazı "ilan" aslında tek bir pozisyon değil, "41 Data Science Intern ilanı" gibi ONLARCA farklı ilanı listeleyen bir kategori/arama sonucu sayfası olabilir (tek bir şirket, tek bir pozisyon tanımı, tek bir başvuru linki yoktur). Böyle bir sayfayı KESİNLİKLE seçme/ele — bu bir iş ilanı değil, bir ilan listesidir. (Genel yetenek programları bunun İSTİSNASIDIR: tek şirketin tek programına ait TEK bir ilan sayfasıdır, sadece departmanı henüz belirtilmemiştir — kategori sayfasıyla karıştırma.)

Adaya uygun olmayan, seviyesi tutmayan, alakasız, kategori/liste sayfası olan, kapalı/süresi dolmuş (openForApplications: false) veya içeriği okunamayan ilanları ELE. Yalnızca şu JSON formatında, başka HİÇBİR açıklama/markdown olmadan yanıt ver:
[{"id": "<verilen id>", "score": <0-100 arası uyum puanı, tam sayı>, "openForApplications": <true veya false>, "reason": "<adaya neden uygun olduğuna dair TEK kısa Türkçe cümle, ilan içeriğine dayanarak>"}]

En fazla ${MAX_AI_RESULTS} ilan seç, en uygun olanı listenin başına koy. Hiçbiri gerçekten uygun VE açık değilse boş dizi [] döndür — sayıyı doldurmak için zorlama.`;

async function fetchInBatches(urls: string[]): Promise<Map<string, JobPageFetchResult>> {
  const results = new Map<string, JobPageFetchResult>();
  for (let i = 0; i < urls.length; i += FETCH_CONCURRENCY) {
    const batch = urls.slice(i, i + FETCH_CONCURRENCY);
    const texts = await Promise.all(batch.map((u) => fetchJobPostingText(u)));
    batch.forEach((u, idx) => results.set(u, texts[idx]));
  }
  return results;
}

export interface RerankOutcome {
  jobs: JobMatch[];
  aiRerankApplied: boolean;
  inspectedCount: number;
  droppedClosedCount: number;
}

/**
 * Takes the merged, heuristically-scored job list and asks Gemini to
 * actually judge fit using each posting's own page content, returning a
 * curated, reasoned subset instead of the raw list. Falls back to the
 * heuristic ranking (unchanged) if Gemini isn't configured or the call
 * fails for any reason — this step is a quality improvement, never a hard
 * dependency for job search to work at all.
 */
export async function rerankJobsWithAI(
  jobs: JobMatch[],
  cvContext: { roleTitle?: string; careerLevel?: CareerLevel; keywords: string[]; cvText?: string }
): Promise<RerankOutcome> {
  if (jobs.length === 0) {
    return { jobs, aiRerankApplied: false, inspectedCount: 0, droppedClosedCount: 0 };
  }
  if (!process.env.GEMINI_API_KEY) {
    return { jobs, aiRerankApplied: false, inspectedCount: 0, droppedClosedCount: 0 };
  }

  const sorted = [...jobs].sort((a, b) => b.matchScore - a.matchScore);
  const inspectPool = sorted.slice(0, MAX_CANDIDATES_TO_INSPECT);

  let contentByUrl: Map<string, JobPageFetchResult>;
  try {
    contentByUrl = await fetchInBatches(inspectPool.map((j) => j.url));
  } catch (e) {
    console.error('İlan sayfaları çekilirken hata:', e);
    contentByUrl = new Map();
  }

  // Postings confirmed closed/expired by their OWN page text are dropped
  // outright here — never handed to the model at all, and never allowed to
  // fall back to the (stale) search-snippet description, which is exactly
  // how a year-old closed posting was slipping through before. Postings
  // whose page we simply couldn't fetch (blocked, timed out, thin content)
  // still go to the model with their snippet as a fallback — "couldn't
  // verify" is not the same as "confirmed closed".
  const closedUrls = new Set(
    inspectPool.filter((j) => contentByUrl.get(j.url)?.status === 'closed').map((j) => j.url)
  );
  const candidates = inspectPool.filter((j) => !closedUrls.has(j.url));
  const droppedClosedCount = closedUrls.size;
  // Used as the fallback list whenever the AI step can't run/returns
  // nothing usable — still has confirmed-closed postings stripped out.
  const sortedMinusClosed = sorted.filter((j) => !closedUrls.has(j.url));

  if (candidates.length === 0) {
    // Every single inspected candidate turned out to be closed — nothing
    // left to send the model. Fall back to the (closed-filtered,
    // score-filtered) heuristic list rather than erroring out.
    return {
      jobs: sortedMinusClosed.filter((j) => j.matchScore >= MIN_DISPLAY_SCORE),
      aiRerankApplied: false,
      inspectedCount: inspectPool.length,
      droppedClosedCount
    };
  }

  const listingBlocks = candidates.map((j, i) => {
    const fetched = contentByUrl.get(j.url);
    const hasFullContent = fetched?.status === 'ok';
    const body = (
      (hasFullContent ? fetched.text : '') ||
      (j.description ? `(içerik alınamadı, yalnızca eski arama sonucu özeti var — güncel/başvurulabilir olduğundan emin olunamaz) ${j.description}` : '(içerik alınamadı, yalnızca başlık/şirket bilgisine göre değerlendir)')
    )
      .replace(/\s+/g, ' ')
      .trim();
    return `id: job_${i}\nBaşlık: ${j.title}\nŞirket: ${j.company}\nKonum: ${j.location}\nKaynak: ${j.source}\nİlan içeriği: ${body.slice(0, 1200)}`;
  });

  const cvContextLine = cvContext.cvText
    ? // Real CV content lets the model judge actual fit (specific
      // skills/experience vs what the posting asks for) instead of just
      // comparing extracted keyword lists — this is what "0% match"
      // postings getting through were missing.
      `Adayın CV'si:\n${cvContext.cvText.slice(0, 4000)}`
    : `Hedef pozisyon: ${cvContext.roleTitle || 'belirtilmemiş'}\nAday seviyesi: ${
        cvContext.careerLevel || 'belirtilmemiş'
      }\nAdayın anahtar becerileri: ${cvContext.keywords.join(', ') || 'belirtilmemiş'}`;

  const prompt = `${cvContextLine}\n\nDeğerlendirilecek ilanlar:\n\n${listingBlocks.join('\n\n---\n\n')}`;

  try {
    const raw = await callGemini({
      system: SYSTEM_PROMPT,
      prompt,
      maxTokens: 4096,
      temperature: 0.2,
      json: true
    });
    const selections = extractJson<RerankSelection[]>(raw);

    const curated: JobMatch[] = [];
    for (const sel of selections) {
      const m = /^job_(\d+)$/.exec(sel?.id || '');
      if (!m) continue;
      const idx = Number(m[1]);
      const job = candidates[idx];
      if (!job) continue;
      // Defense in depth: even though the prompt instructs the model to
      // simply not include closed postings, also enforce it here in case
      // it includes one anyway with a note in the reason instead of
      // actually excluding it.
      if (sel.openForApplications === false) continue;
      const score = Math.max(0, Math.min(100, Math.round(Number(sel.score) || 0)));
      // Never show a "match" the model itself scored as barely/not fitting
      // — a low score means the model included it for completeness or
      // borderline reasoning, not that it's actually worth the person's
      // time. This is the direct fix for postings at 15%/0% showing up as
      // if they were curated recommendations.
      if (score < MIN_DISPLAY_SCORE) continue;
      curated.push({
        ...job,
        matchScore: score,
        matchReason: (sel.reason || '').trim() || undefined
      });
    }
    curated.sort((a, b) => b.matchScore - a.matchScore);

    // If the model returned nothing usable (or everything it returned
    // scored too low to actually show), report zero matches honestly
    // rather than falling back to the heuristic list — that would just
    // reintroduce the exact low-quality/irrelevant results this whole step
    // exists to filter out.
    if (curated.length === 0) {
      return { jobs: [], aiRerankApplied: true, inspectedCount: inspectPool.length, droppedClosedCount };
    }

    return { jobs: curated, aiRerankApplied: true, inspectedCount: inspectPool.length, droppedClosedCount };
  } catch (e) {
    console.error('AI ile ilan yeniden sıralama hatası:', e);
    return {
      jobs: sortedMinusClosed.filter((j) => j.matchScore >= MIN_DISPLAY_SCORE),
      aiRerankApplied: false,
      inspectedCount: inspectPool.length,
      droppedClosedCount
    };
  }
}
