import { NextRequest, NextResponse } from 'next/server';
import { requireUserForAi } from '@/lib/server/auth';
import { requestAiText } from '@/lib/server/anthropic';

export async function POST(request: NextRequest) {
  const auth = await requireUserForAi('vave-analysis');
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    if (typeof body?.prompt !== 'string' || !body.prompt.trim()) {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
    }

    const ai = await requestAiText(body.prompt);
    if (!ai.ok) {
      return NextResponse.json({ error: ai.error, details: ai.details }, { status: ai.status });
    }
    return NextResponse.json({ text: ai.text });
  } catch (error) {
    console.error('VAVE analysis error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze BOM data' },
      { status: 500 }
    );
  }
}
