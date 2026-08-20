import { NextRequest, NextResponse } from 'next/server';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  BorderStyle,
  AlignmentType,
  convertInchesToTwip
} from 'docx';
import { parseCvText } from '../../../lib/cvParser';

export const runtime = 'nodejs';

const ACCENT = '1D4ED8';
const MUTED = '5B6472';

function buildDocxParagraphs(cvText: string, fullName?: string): Paragraph[] {
  const { name, contactLine, blocks } = parseCvText(cvText, fullName);
  const paragraphs: Paragraph[] = [];

  if (name) {
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: name, bold: true, size: 44, color: '1A1A1A' })],
        spacing: { after: 60 }
      })
    );
  }

  if (contactLine) {
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: contactLine, size: 19, color: MUTED })],
        spacing: { after: 160 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 8 }
        }
      })
    );
  } else {
    paragraphs.push(
      new Paragraph({
        children: [],
        spacing: { after: 160 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 8 }
        }
      })
    );
  }

  for (const block of blocks) {
    if (block.type === 'heading') {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: block.text.toUpperCase(),
              bold: true,
              size: 22,
              color: ACCENT,
              allCaps: true
            })
          ],
          spacing: { before: 260, after: 100 },
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C7D2FE', space: 4 }
          }
        })
      );
    } else if (block.type === 'bullet') {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: block.text, size: 20, color: '1A1A1A' })],
          bullet: { level: 0 },
          spacing: { after: 60 }
        })
      );
    } else {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: block.text, size: 20, color: '1A1A1A' })],
          spacing: { after: 90 }
        })
      );
    }
  }

  return paragraphs;
}

export async function POST(req: NextRequest) {
  try {
    const { cvText, fullName } = await req.json();
    if (!cvText || typeof cvText !== 'string') {
      return NextResponse.json({ error: 'cvText gerekli.' }, { status: 400 });
    }

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: convertInchesToTwip(0.7),
                bottom: convertInchesToTwip(0.7),
                left: convertInchesToTwip(0.8),
                right: convertInchesToTwip(0.8)
              }
            }
          },
          children: buildDocxParagraphs(cvText, fullName)
        }
      ],
      styles: {
        default: {
          document: {
            run: { font: 'Calibri' }
          }
        }
      }
    });

    const buffer = await Packer.toBuffer(doc);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': 'attachment; filename="cv-guncellenmis.docx"',
        'Content-Length': String(buffer.length)
      }
    });
  } catch (err: any) {
    console.error('DOCX oluşturma hatası:', err);
    return NextResponse.json({ error: err.message || 'Word dosyası oluşturulamadı.' }, { status: 500 });
  }
}
