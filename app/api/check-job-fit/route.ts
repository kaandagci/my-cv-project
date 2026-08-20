import { NextRequest, NextResponse } from 'next/server';
import { fetchJobPostingText } from '../../../lib/jobPageFetch';
import { callGemini, extractJson } from '../../../lib/gemini';

export const runtime = 'nodejs';
export const maxDuration = 30;

const SYSTEM_PROMPT = `Sen deneyimli bir kariyer danışmanısın. Sana bir adayın CV'si ve TEK bir iş ilanının kendi sayfasından alınmış ham içeriği verilecek.

Görevin:
1. İlan içeriğinden başlık, şirket adı ve konum bilgisini çıkar (bulamazsan "Belirtilmemiş" yaz).
2. İçeriği dikkatlice oku: ilanın hâlâ başvuruya açık olup olmadığına dair HERHANGİ bir ifade var mı (Türkçe/İngilizce, hangi kelimelerle yazılmış olursa olsun — sabit kalıp arama, anlamına bak)? Örn: "artık başvuru kabul etmiyor", "şirket aradığı adayı buldu", "süresi dolmuş", "no longer accepting applications", "position filled". Varsa openForApplications: false yap. Yoksa ve ilan normal aktif bir ilan gibi görünüyorsa openForApplications: true yap.
3. Bu ilanın adaya GERÇEKTEN uygun olup olmadığını değerlendir: seviye (junior/orta/senior) uyumu, istenen beceri/teknoloji örtüşmesi, sektör/alan uyumu. "Genç Yetenek Programı" / "Graduate Program" / "Management Trainee" gibi departmanı belirtilmemiş genel yetenek programları, öğrenci/yeni mezun adaylar için normal şartlarda uygun sayılır — sırf spesifik teknik kelime geçmiyor diye düşük puan verme. Bu tür programlar genelde uzun süre açık kalır; Google'da eski görünmesi kapalı olduğu anlamına gelmez, yalnızca içerikteki gerçek ifadeye bak.
4. İçerik bir "İlan bulunamadı", oturum açma sayfası, hata sayfası veya birden fazla ilanı listeleyen bir kategori/arama sonucu sayfasıysa, openForApplications: false yap ve reason alanında belirt.

Yalnızca şu JSON formatında, başka HİÇBİR açıklama/markdown olmadan yanıt ver:
{"title": "...", "company": "...", "location": "...", "score": <0-100 arası tam sayı>, "openForApplications": <true veya false>, "reason": "<adaya neden uygun olup olmadığına ve başvurulabilir olup olmadığına dair 1-2 kısa Türkçe cümle, ilan içeriğine dayanarak>"}`;

export async function POST(req: NextRequest) {
  try {
    const { url, cvText } = await req.json();
    if (typeof url !== 'string' || !url.trim()) {
      return NextResponse.json({ error: 'url gerekli.' }, { status: 400 });
    }
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      return NextResponse.json({ error: 'Geçersiz URL.' }, { status: 400 });
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return NextResponse.json({ error: 'Geçersiz URL.' }, { status: 400 });
    }

    const cleanCvText = typeof cvText === 'string' ? cvText.slice(0, 6000) : '';

    const fetched = await fetchJobPostingText(parsed.toString());

    if (fetched.status === 'closed') {
      return NextResponse.json({
        status: 'closed',
        message: 'Bu ilan artık başvuruları kabul etmiyor (kapanmış/süresi dolmuş).'
      });
    }
    if (fetched.status === 'unavailable') {
      return NextResponse.json({
        status: 'unavailable',
        message:
          'Sayfa okunamadı — site bot erişimini engelliyor olabilir (özellikle LinkedIn, giriş yapmamış isteklere sınırlı içerik gösterebilir). Linki tarayıcınızda açıp manuel kontrol etmeniz gerekebilir.'
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: 'GEMINI_API_KEY yapılandırılmamış, uygunluk değerlendirmesi yapılamıyor.' }, { status: 500 });
    }

    const prompt = `Adayın CV'si:\n${cleanCvText || '(CV verilmedi, yalnızca ilan içeriğine göre genel bir değerlendirme yap)'}\n\nİlan URL: ${parsed.toString()}\nİlan içeriği:\n${fetched.text}`;

    const raw = await callGemini({ system: SYSTEM_PROMPT, prompt, maxTokens: 600, temperature: 0.2, json: true });
    const result = extractJson<{
      title?: string;
      company?: string;
      location?: string;
      score?: number;
      openForApplications?: boolean;
      reason?: string;
    }>(raw);

    if (result.openForApplications === false) {
      return NextResponse.json({
        status: 'closed',
        message: result.reason
          ? `Bu ilan artık başvuruya açık görünmüyor: ${result.reason}`
          : 'Bu ilan artık başvuruları kabul etmiyor (kapanmış/süresi dolmuş).'
      });
    }

    return NextResponse.json({
      status: 'ok',
      title: result.title || 'Başlıksız ilan',
      company: result.company || 'Belirtilmemiş',
      location: result.location || 'Belirtilmemiş',
      score: Math.max(0, Math.min(100, Math.round(Number(result.score) || 0))),
      reason: result.reason || '',
      url: parsed.toString()
    });
  } catch (err: any) {
    console.error('Job fit check error:', err);
    return NextResponse.json({ error: err.message || 'İlan kontrolü başarısız.' }, { status: 500 });
  }
}
