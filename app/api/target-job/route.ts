import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { callGemini, extractJson } from '../../../lib/gemini';
import type { AnalyzeResult, CVChange, CareerLevel } from '../../../lib/types';

export const runtime = 'nodejs';

const SYSTEM_PROMPT = `Sen deneyimli bir kariyer koçu ve CV editörüsün. Sana bir CV metni ve bir HEDEF POZİSYON açıklaması verilecek.

Görevin, CV'yi bu hedef pozisyona göre yeniden uyarlamak:
- Pozisyonla en alakalı deneyim/beceri/başarıları öne çıkar.
- Pozisyon ilanındaki anahtar kelimeleri (varsa) CV'ye doğal şekilde yedir (ATS uyumluluğu için).
- Alakasız veya zayıf vurgulanmış kısımları güçlendir ya da yeniden çerçevele.
- Uydurma bilgi EKLEME; sadece CV'de zaten var olan bilgileri yeniden ifade et/vurgula.

Her değişiklik için "original" alanı CV metninden BİREBİR kopyalanmış bir alıntı olmalı (parafraz etme), aksi halde metinde eşleştirilemez.

Ayrıca:
- "roleTitle": Hedef pozisyonun kısa, net unvanını belirle (örn: "Frontend Geliştirici"). İş arama sorgusunun temeli olarak kullanılacak.
- "careerLevel": CV sahibinin kariyer aşamasını şu üç değerden BİRİYLE belirle:
  - "öğrenci/stajyer": Hâlâ öğrenci, staj arıyor, tam zamanlı deneyimi yok/çok sınırlı.
  - "yeni mezun": Yakın zamanda mezun, 0-1 yıl tam zamanlı deneyimi var.
  - "deneyimli": 1+ yıl tam zamanlı profesyonel deneyimi var.

ÖNEMLİ - geçerli JSON kuralları: "original" ve "revised" alanlarında CV metninde satır sonu varsa bunu JSON string içinde \n olarak kaçış (escape) karakteriyle yaz, gerçek/ham satır sonu KOYMA. Metin içinde " (çift tırnak) geçiyorsa \" olarak kaçış yap. Her zaman sözdizimsel olarak geçerli, eksiksiz JSON üret.

SADECE aşağıdaki JSON formatında yanıt ver:

{
  "summary": "CV'nin bu pozisyona ne kadar uyduğuna dair 2-3 cümlelik değerlendirme",
  "changes": [
    { "section": "...", "original": "...", "revised": "...", "reason": "..." }
  ],
  "keywords": ["hedef pozisyonla ilgili anahtar kelimeler"],
  "roleTitle": "Hedef pozisyonun kısa unvanı",
  "careerLevel": "öğrenci/stajyer | yeni mezun | deneyimli"
}`;

export async function POST(req: NextRequest) {
  try {
    const { cvText, targetJob } = await req.json();
    if (!cvText || !targetJob) {
      return NextResponse.json({ error: 'cvText ve targetJob gerekli.' }, { status: 400 });
    }

    const userContent = `Hedef pozisyon:\n"""\n${targetJob}\n"""\n\nCV:\n"""\n${cvText}\n"""`;

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

    const rawChanges = Array.isArray(parsed.changes) ? parsed.changes : [];

    // See the identical check in app/api/analyze-cv/route.ts for why both
    // "original" AND "revised" need a typeof/non-empty guard here — a
    // missing "revised" field on any one item used to throw inside
    // `.trim()` and 500 the whole request instead of just skipping that
    // one item.
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
        reason: typeof c.reason === 'string' && c.reason.trim() ? c.reason.trim() : 'Bu değişiklik hedef pozisyona daha uygun.',
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
    return NextResponse.json({ error: err.message || 'Hedef işe göre uyarlama başarısız.' }, { status: 500 });
  }
}
