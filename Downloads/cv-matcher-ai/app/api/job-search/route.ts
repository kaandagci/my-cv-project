import { NextRequest, NextResponse } from 'next/server';
import { searchJoobleJobs } from '../../../lib/jooble';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { keywords, location } = await req.json();
    if (!Array.isArray(keywords) || keywords.length === 0) {
      return NextResponse.json({ error: 'keywords (dizi) gerekli.' }, { status: 400 });
    }
    const jobs = await searchJoobleJobs(
      keywords,
      typeof location === 'string' && location.trim() ? location.trim() : undefined
    );
    return NextResponse.json({ jobs });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message || 'İş araması başarısız.' }, { status: 500 });
  }
}
