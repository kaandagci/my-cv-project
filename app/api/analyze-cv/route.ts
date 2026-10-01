import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { callClaude, extractJson } from '@/lib/anthropic';
import type { AnalyzeResult, CVChange } from '@/lib/types';

export const runtime = 'nodejs';

const SYSTEM_PROMPT = `Sen deneyimli bir kariyer koçu ve CV editörüsün. Sana ham metin olarak bir CV verilecek (bazen bir hedef pozisyon açıklaması da verilebilir).

Görevin:
1. CV'yi dikkatlice oku.
2. CV'yi güçlendirecek somut değişiklikler öner (daha güçlü fiiller, ölçülebilir sonuçlar, netlik, ATS uyumluluğu, gereksiz ifadelerin kaldırılması, hedef pozisyona uyarlama vb).
3. Her değişiklik için "original" alanı CV metninden BİREBİR (harfi harfine, kısaltmadan, parafraz yapmadan) kopyalanmış bir alıntı OLMALI ki metinde bulunup değiştirilebilsin. original 1-3 cümle veya bir madde uzunluğunda, çok uzun olmasın.
4. Aynı original snippet'i birden fazla değişiklikte kullanma.
5. Sadece gerçekten iyileştirme sağlayan değişiklikler öner (5-12 arası değişiklik idealdir). Zaten mükemmel olan kısımlara dokunma.
6. Ayrıca CV'den öne çıkan 8-15 arası anahtar kelime/beceri/rol adı çıkar (iş arama için kullanılacak).

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
  "keywords": ["anahtar kelime 1", "anahtar kelime 2", "..."]
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

    const raw = await callClaude({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 4096,
      temperature: 0.4
    });

    const parsed = extractJson<{
      summary: string;
      changes: { section: string; original: string; revised: string; reason: string }[];
      keywords: string[];
    }>(raw);

    // Only keep changes whose "original" text can actually be located in the
    // CV, so the frontend diff view can highlight them reliably.
    const changes: CVChange[] = parsed.changes
      .filter((c) => cvText.includes(c.original.trim()))
      .map((c) => ({
        id: uuidv4(),
        section: c.section,
        original: c.original.trim(),
        revised: c.revised.trim(),
        reason: c.reason,
        status: 'pending',
        currentText: c.revised.trim()
      }));

    const result: AnalyzeResult = {
      summary: parsed.summary,
      changes,
      keywords: parsed.keywords || []
    };

    return NextResponse.json(result);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message || 'CV analiz edilemedi.' }, { status: 500 });
  }
}
