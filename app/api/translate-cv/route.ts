import { NextRequest, NextResponse } from 'next/server';
import { callGemini } from '../../../lib/gemini';

export const runtime = 'nodejs';

const SYSTEM_PROMPT = `Sen profesyonel bir CV çevirmenisin. Sana bir CV metni ve hedef dil verilecek.

ÖNCE CV metninin ZATEN hangi dilde olduğunu kendi kendine belirle.

Durum 1 — CV zaten hedef dildeyse: metni ÇEVİRME. Sadece ver; en fazla bariz yazım/dilbilgisi hatalarını düzelt. Anlamı, kelime seçimlerini, bölüm başlıklarını ve yapıyı olduğu gibi koru — gereksiz yeniden yazım/parafraz YAPMA.

Durum 2 — CV başka bir dildeyse: CV'nin TÜM içeriğini hedef dile doğal, profesyonel ve ATS-uyumlu bir şekilde çevir:
- Bölüm başlıklarını da hedef dile çevir (örn: "Deneyim" -> "Experience", "Beceriler" -> "Skills").
- Anlamı ve tüm bilgileri (tarihler, şirket/okul adları, sayısal sonuçlar) birebir koru; hiçbir bilgi ekleme veya çıkarma.
- Şirket/kurum/okul özel adlarını (örn: "Google", "İstanbul Teknik Üniversitesi") olduğu gibi bırak, çevirme.
- Madde işaretli (bullet) satırların yapısını koru (her satır kendi satırında kalsın).

Her iki durumda da: yalnızca sonuç CV metnini düz metin olarak döndür. Açıklama, yorum, "zaten bu dildeydi" gibi bir not, markdown code fence veya tırnak EKLEME — sadece nihai CV metni.`;

export async function POST(req: NextRequest) {
  try {
    const { cvText, targetLanguage } = await req.json();
    if (!cvText || typeof cvText !== 'string') {
      return NextResponse.json({ error: 'cvText gerekli.' }, { status: 400 });
    }
    if (targetLanguage !== 'en' && targetLanguage !== 'tr') {
      return NextResponse.json({ error: 'targetLanguage "en" veya "tr" olmalı.' }, { status: 400 });
    }

    const languageLabel = targetLanguage === 'en' ? 'İngilizce (English)' : 'Türkçe';
    const userContent = `Hedef dil: ${languageLabel}\n\nCV:\n"""\n${cvText}\n"""`;

    const raw = await callGemini({
      system: SYSTEM_PROMPT,
      prompt: userContent,
      maxTokens: 8192,
      temperature: 0.3
    });

    const translated = raw.trim().replace(/^```[a-z]*|```$/gi, '').trim();

    return NextResponse.json({ translatedText: translated });
  } catch (err: any) {
    console.error('CV çeviri hatası:', err);
    return NextResponse.json({ error: err.message || 'CV çevrilemedi.' }, { status: 500 });
  }
}
