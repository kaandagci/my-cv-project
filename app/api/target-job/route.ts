import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { callClaude, extractJson } from '@/lib/anthropic';
import type { AnalyzeResult, CVChange } from '@/lib/types';

export const runtime = 'nodejs';

const SYSTEM_PROMPT = `Sen deneyimli bir kariyer koçu ve CV editörüsün. Sana bir CV metni ve bir HEDEF POZİSYON açıklaması verilecek.

Görevin, CV'yi bu hedef pozisyona göre yeniden uyarlamak:
- Pozisyonla en alakalı deneyim/beceri/başarıları öne çıkar.
- Pozisyon ilanındaki anahtar kelimeleri (varsa) CV'ye doğal şekilde yedir (ATS uyumluluğu için).
- Alakasız veya zayıf vurgulanmış kısımları güçlendir ya da yeniden çerçevele.
- Uydurma bilgi EKLEME; sadece CV'de zaten var olan bilgileri yeniden ifade et/vurgula.

Her değişiklik için "original" alanı CV metninden BİREBİR kopyalanmış bir alıntı olmalı (parafraz etme), aksi halde metinde eşleştirilemez.

SADECE aşağıdaki JSON formatında yanıt ver:

{
  "summary": "CV'nin bu pozisyona ne kadar uyduğuna dair 2-3 cümlelik değerlendirme",
  "changes": [
    { "section": "...", "original": "...", "revised": "...", "reason": "..." }
  ],
  "keywords": ["hedef pozisyonla ilgili anahtar kelimeler"]
}`;

export async function POST(req: NextRequest) {
  try {
    const { cvText, targetJob } = await req.json();
    if (!cvText || !targetJob) {
      return NextResponse.json({ error: 'cvText ve targetJob gerekli.' }, { status: 400 });
    }

    const userContent = `Hedef pozisyon:\n"""\n${targetJob}\n"""\n\nCV:\n"""\n${cvText}\n"""`;

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
    return NextResponse.json({ error: err.message || 'Hedef işe göre uyarlama başarısız.' }, { status: 500 });
  }
}
