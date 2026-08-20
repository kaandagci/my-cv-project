import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import React from 'react';
import { renderToBuffer, Document, Page, Text, View, Font, StyleSheet } from '@react-pdf/renderer';
import { parseCvText } from '../../../lib/cvParser';

export const runtime = 'nodejs';

// The built-in PDF standard fonts (Helvetica etc.) only support WinAnsi
// encoding, which does NOT include Turkish-specific characters (ı, İ, ş, Ş,
// ğ, Ğ, ç, Ç, ö, Ö, ü, Ü partly). Without a real embedded font those get
// silently replaced with garbage glyphs (e.g. "Yılmaz" -> "Y1lmaz"). Noto
// Sans covers the full Turkish (Latin Extended) character set, so we embed
// it directly from the filesystem — no runtime network call needed.
const FONT_DIR = path.join(process.cwd(), 'fonts');
let fontsRegistered = false;

function registerFonts() {
  if (fontsRegistered) return;
  const regularPath = path.join(FONT_DIR, 'NotoSans-Regular.ttf');
  const boldPath = path.join(FONT_DIR, 'NotoSans-Bold.ttf');

  if (!fs.existsSync(regularPath) || !fs.existsSync(boldPath)) {
    throw new Error(
      'Font dosyaları bulunamadı (fonts/NotoSans-Regular.ttf, fonts/NotoSans-Bold.ttf). Proje kökünde "fonts" klasörünün mevcut olduğundan emin olun.'
    );
  }

  Font.register({
    family: 'NotoSans',
    fonts: [
      { src: regularPath, fontWeight: 'normal' },
      { src: boldPath, fontWeight: 'bold' }
    ]
  });
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

const ACCENT = '#1d4ed8';
const TEXT = '#1a1a1a';
const MUTED = '#5b6472';

const styles = StyleSheet.create({
  page: {
    paddingTop: 42,
    paddingBottom: 42,
    paddingHorizontal: 50,
    fontSize: 10.3,
    fontFamily: 'NotoSans',
    color: TEXT,
    lineHeight: 1.45
  },
  name: {
    fontSize: 21,
    fontFamily: 'NotoSans',
    fontWeight: 'bold',
    color: TEXT,
    marginBottom: 3
  },
  contact: {
    fontSize: 9.5,
    color: MUTED,
    marginBottom: 14
  },
  headerRule: {
    borderBottomWidth: 1.5,
    borderBottomColor: ACCENT,
    marginBottom: 14
  },
  heading: {
    fontSize: 11,
    fontFamily: 'NotoSans',
    fontWeight: 'bold',
    color: ACCENT,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 14,
    marginBottom: 6,
    borderBottomWidth: 0.75,
    borderBottomColor: '#c7d2fe',
    paddingBottom: 3
  },
  paragraph: {
    marginBottom: 5,
    textAlign: 'left'
  },
  bulletRow: {
    flexDirection: 'row',
    marginBottom: 4,
    paddingLeft: 2
  },
  bulletDot: {
    width: 12,
    color: ACCENT,
    fontFamily: 'NotoSans',
    fontWeight: 'bold'
  },
  bulletText: {
    flex: 1
  }
});

function buildDocument(cvText: string, fullName?: string) {
  const { name, contactLine, blocks } = parseCvText(cvText, fullName);

  const children: React.ReactElement[] = [];

  if (name) {
    children.push(React.createElement(Text, { key: 'name', style: styles.name }, name));
  }
  if (contactLine) {
    children.push(React.createElement(Text, { key: 'contact', style: styles.contact }, contactLine));
  }
  children.push(React.createElement(View, { key: 'rule', style: styles.headerRule } as any));

  blocks.forEach((b, i) => {
    if (b.type === 'heading') {
      children.push(React.createElement(Text, { key: i, style: styles.heading }, b.text));
    } else if (b.type === 'bullet') {
      children.push(
        React.createElement(
          View,
          { key: i, style: styles.bulletRow },
          React.createElement(Text, { style: styles.bulletDot }, '•'),
          React.createElement(Text, { style: styles.bulletText }, b.text)
        )
      );
    } else {
      children.push(React.createElement(Text, { key: i, style: styles.paragraph }, b.text));
    }
  });

  return React.createElement(
    Document,
    {},
    React.createElement(Page, { size: 'A4', style: styles.page }, ...children)
  );
}

export async function POST(req: NextRequest) {
  try {
    const { cvText, fullName } = await req.json();
    if (!cvText || typeof cvText !== 'string') {
      return NextResponse.json({ error: 'cvText gerekli.' }, { status: 400 });
    }

    registerFonts();

    const doc = buildDocument(cvText, fullName);
    const buffer = await renderToBuffer(doc as any);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="cv-guncellenmis.pdf"',
        'Content-Length': String(buffer.length)
      }
    });
  } catch (err: any) {
    console.error('PDF oluşturma hatası:', err);
    return NextResponse.json({ error: err.message || 'PDF oluşturulamadı.' }, { status: 500 });
  }
}
