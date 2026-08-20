import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { callGemini, extractJson } from '../../../lib/gemini';
import type { AnalyzeResult, CVChange, CareerLevel } from '../../../lib/types';

export const runtime = 'nodejs';

const SYSTEM_PROMPT = `Sen deneyimli bir kariyer koçu ve CV editörüsün. Sana ham metin olarak bir CV verilecek (bazen bir hedef pozisyon açıklaması da verilebilir).

Görevin:
1. CV'yi dikkatlice oku.
2. CV'yi güçlendirecek somut değişiklikler öner (daha güçlü fiiller, ölçülebilir sonuçlar, netlik, ATS uyumluluğu, gereksiz ifadelerin kaldırılması, hedef pozisyona uyarlama vb).
3. Her değişiklik için "original" alanı CV metninden BİREBİR (harfi harfine, kısaltmadan, parafraz yapmadan) kopyalanmış bir alıntı OLMALI ki metinde bulunup değiştirilebilsin. original 1-3 cümle veya bir madde uzunluğunda, çok uzun olmasın.
4. Aynı original snippet'i birden fazla değişiklikte kullanma.
5. Sadece gerçekten iyileştirme sağlayan değişiklikler öner (5-12 arası değişiklik idealdir). Zaten mükemmel olan kısımlara dokunma.
6. Ayrıca CV'den öne çıkan 8-15 arası anahtar kelime/beceri/rol adı çıkar (iş arama için kullanılacak).
7. "roleTitle": CV'nin hedeflediği EN OLASI iş unvanını tek bir kısa ifadeyle belirle (örn: "Frontend Geliştirici", "Makine Mühendisi", "Pazarlama Uzmanı"). İş arama sorgusunun temeli olarak kullanılacak, bu yüzden spesifik ve gerçekçi bir unvan seç.
8. "careerLevel": CV sahibinin kariyer aşamasını şu üç değerden BİRİYLE belirle:
   - "öğrenci/stajyer": Hâlâ üniversite/lise öğrencisi, staj arıyor, tam zamanlı iş deneyimi yok veya çok sınırlı (proje/staj düzeyinde).
   - "yeni mezun": Yakın zamanda mezun olmuş, 0-1 yıl tam zamanlı deneyimi var.
   - "deneyimli": 1+ yıl tam zamanlı profesyonel iş deneyimi var.
   Bu tespiti eğitim durumu, iş deneyimi bölümü uzunluğu/varlığı ve CV'deki ifadelere (örn: "öğrenciyim", "staj arıyorum", mezuniyet tarihi gelecekte mi) göre yap.
9. ÖNEMLİ - geçerli JSON kuralları: "original" ve "revised" alanlarında CV metninde satır sonu varsa bunu JSON string içinde \n olarak kaçış (escape) karakteriyle yaz, gerçek/ham satır sonu KOYMA. Metin içinde " (çift tırnak) geçiyorsa \" olarak kaçış yap. Her zaman sözdizimsel olarak geçerli, eksiksiz JSON üret.

SADECE aşağıdaki JSON formatında yanıt ver, başka hiçbir metin ekleme:

{
  "summary": "CV'nin genel değerlendirmesi, 2-3 cümle",
  "changes": [
    {
      "section": "Bölüm adı (örn: Özet, Deneyim - Şirket X, Beceriler)",
      "original": "CV metninden birebir alıntı",
      "revised": "İyileştirilmiş versiyon",
      "reason": "Bu değişikliğin neden yapıldığına dair kısa, şeffaf açıklama"
    }
  ],
  "keywords": ["anahtar kelime 1", "anahtar kelime 2", "..."],
  "roleTitle": "En olası iş unvanı",
  "careerLevel": "öğrenci/stajyer | yeni mezun | deneyimli"
}`;

export async function POST(req: NextRequest) {
  try {
    const { cvText, targetJob } = await req.json();
    if (!cvText || typeof cvText !== 'string') {
      return NextResponse.json({ error: 'cvText gerekli.' }, { status: 400 });
    }

    const userContent = targetJob
      ? `Hedef pozisyon:\n"""\n${targetJob}\n"""\n\nBu CV'yi bu pozisyona göre değerlendirip uyarla:\n\nCV:\n"""\n${cvText}\n"""`
      : `Bu CV'yi analiz et ve iyileştir:\n\nCV:\n"""\n${cvText}\n"""`;

    const raw = await callGemini({
      system: SYSTEM_PROMPT,
      prompt: userContent,
      maxTokens: 10000,
      temperature: 0.4,
      json: true
    });

    const parsed = extractJson<{
      summary?: string;
      changes?: { section: string; original: string; revised: string; reason: string }[];
      keywords?: string[];
      roleTitle?: string;
      careerLevel?: string;
    }>(raw);

    // Defensive: Gemini occasionally omits a field or returns an empty
    // object under load. Without these fallbacks, changes.filter() below
    // would throw on undefined and the whole request would 500 out with a
    // generic error, which from the UI just looks like "nothing happens".
    const rawChanges = Array.isArray(parsed.changes) ? parsed.changes : [];

    // Only keep changes whose "original" text can actually be located in the
    // CV (so the frontend diff view can highlight them reliably) AND whose
    // "revised" field actually came back as a string. Gemini occasionally
    // omits "revised" on one item in the array (especially under load, or
    // when a change reduces to "no textual change, just a formatting note")
    // — without this second check, `c.revised.trim()` below throws on
    // undefined and the ENTIRE analysis request 500s, which from the UI
    // just looks like "CV'yi Analiz Et" silently does nothing.
    const changes: CVChange[] = rawChanges
      .filter(
        (c) =>
          c &&
          typeof c.original === 'string' &&
          typeof c.revised === 'string' &&
          c.revised.trim().length > 0 &&
          cvText.includes(c.original.trim())
      )
      .map((c) => ({
        id: uuidv4(),
        section: typeof c.section === 'string' && c.section.trim() ? c.section.trim() : 'Genel',
        original: c.original.trim(),
        revised: c.revised.trim(),
        reason: typeof c.reason === 'string' && c.reason.trim() ? c.reason.trim() : 'Bu değişiklik CV\'yi güçlendirir.',
        status: 'pending',
        currentText: c.revised.trim()
      }));

    const validCareerLevels: CareerLevel[] = ['öğrenci/stajyer', 'yeni mezun', 'deneyimli'];
    const careerLevel: CareerLevel = validCareerLevels.includes(parsed.careerLevel as CareerLevel)
      ? (parsed.careerLevel as CareerLevel)
      : 'deneyimli';

    const result: AnalyzeResult = {
      summary: parsed.summary || 'Analiz tamamlandı.',
      changes,
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      roleTitle: parsed.roleTitle || '',
      careerLevel
    };

    return NextResponse.json(result);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message || 'CV analiz edilemedi.' }, { status: 500 });
  }
}
