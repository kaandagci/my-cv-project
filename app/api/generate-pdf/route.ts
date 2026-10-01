import { NextRequest, NextResponse } from 'next/server';
import React from 'react';
import { renderToBuffer, Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

export const runtime = 'nodejs';

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 40,
    paddingHorizontal: 48,
    fontSize: 10.5,
    fontFamily: 'Helvetica',
    color: '#1a1a1a',
    lineHeight: 1.4
  },
  name: { fontSize: 18, fontFamily: 'Helvetica-Bold', marginBottom: 10 },
  paragraph: { marginBottom: 6 },
  heading: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    marginTop: 12,
    marginBottom: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: '#999999',
    paddingBottom: 2
  }
});

// Very common ATS/CV section header keywords (TR + EN) used to detect headings
// so the PDF gets simple, clean section styling without needing a full markup
// language from the AI output.
const HEADING_REGEX =
  /^(özet|profil|deneyim|iş deneyimi|eğitim|beceriler|yetenekler|projeler|sertifikalar|diller|referanslar|summary|profile|experience|work experience|education|skills|projects|certifications|languages|references)\s*:?$/i;

function buildDocument(cvText: string, fullName?: string) {
  const lines = cvText.split('\n').map((l) => l.trim());
  const blocks: { type: 'heading' | 'text'; content: string }[] = [];
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length) {
      blocks.push({ type: 'text', content: buffer.join('\n') });
      buffer = [];
    }
  };

  for (const line of lines) {
    if (!line) {
      flush();
      continue;
    }
    if (HEADING_REGEX.test(line.replace(/[*_#]/g, ''))) {
      flush();
      blocks.push({ type: 'heading', content: line.replace(/[*_#:]/g, '').trim() });
    } else {
      buffer.push(line);
    }
  }
  flush();

  return React.createElement(
    Document,
    {},
    React.createElement(
      Page,
      { size: 'A4', style: styles.page },
      fullName ? React.createElement(Text, { style: styles.name }, fullName) : null,
      ...blocks.map((b, i) =>
        b.type === 'heading'
          ? React.createElement(Text, { key: i, style: styles.heading }, b.content)
          : React.createElement(Text, { key: i, style: styles.paragraph }, b.content)
      )
    )
  );
}

export async function POST(req: NextRequest) {
  try {
    const { cvText, fullName } = await req.json();
    if (!cvText || typeof cvText !== 'string') {
      return NextResponse.json({ error: 'cvText gerekli.' }, { status: 400 });
    }

    const doc = buildDocument(cvText, fullName);
    const buffer = await renderToBuffer(doc as any);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="cv-guncellenmis.pdf"'
      }
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message || 'PDF oluşturulamadı.' }, { status: 500 });
  }
}
