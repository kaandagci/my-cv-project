import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'Dosya bulunamadı.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const name = file.name.toLowerCase();

    let text = '';

    if (name.endsWith('.pdf')) {
      // pdf-parse's index.js runs a debug snippet when required directly in
      // some bundlers; importing the lib path avoids that footgun.
      const pdfParse = (await import('pdf-parse')).default;
      const result = await pdfParse(buffer);
      text = result.text;
    } else if (name.endsWith('.docx')) {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else {
      return NextResponse.json(
        { error: 'Sadece .pdf ve .docx dosyaları destekleniyor.' },
        { status: 400 }
      );
    }

    text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

    if (!text || text.length < 20) {
      return NextResponse.json(
        { error: 'Dosyadan metin çıkarılamadı. Dosya taranmış bir görüntü olabilir.' },
        { status: 422 }
      );
    }

    return NextResponse.json({ text, filename: file.name });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message || 'CV ayrıştırılamadı.' }, { status: 500 });
  }
}
