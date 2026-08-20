import { NextRequest, NextResponse } from 'next/server';
import { callGemini } from '../../../lib/gemini';

export const runtime = 'nodejs';

const SYSTEM_PROMPT = `Sen bir CV editörüsün. Sana bir CV'nin küçük bir bölümünün orijinal hali, önerilen (revize) hali ve kullanıcının bu revizyon hakkındaki talimatı verilecek.

Kullanıcının talimatını dikkate alarak metni yeniden yaz. Sadece yeni metni düz metin olarak döndür — açıklama, tırnak işareti, markdown veya JSON EKLEME. Sadece nihai revize edilmiş metni yaz.`;

export async function POST(req: NextRequest) {
  try {
    const { original, revised, instruction, section } = await req.json();
    if (!original || !instruction) {
      return NextResponse.json({ error: 'original ve instruction gerekli.' }, { status: 400 });
    }

    const userContent = `Bölüm: ${section || 'Belirtilmemiş'}
Orijinal metin:
"""
${original}
"""

Önceki öneri:
"""
${revised || '(yok)'}
"""

Kullanıcının talimatı: "${instruction}"

Bu talimata göre nihai metni yaz.`;

    const raw = await callGemini({
      system: SYSTEM_PROMPT,
      prompt: userContent,
      maxTokens: 2048,
      temperature: 0.5
    });

    const newText = raw.trim().replace(/^"""?|"""?$/g, '').trim();

    return NextResponse.json({ revised: newText });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message || 'Yeniden düzenleme başarısız.' }, { status: 500 });
  }
}
