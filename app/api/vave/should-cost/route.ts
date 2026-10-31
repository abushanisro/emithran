import { NextRequest, NextResponse } from 'next/server';
import type { VaveBomItem } from '@/lib/api/vave';
import { requireUserForAi } from '@/lib/server/auth';
import { parseAiJson, requestAiText } from '@/lib/server/anthropic';
import { AiResultError, shouldCostFromAi } from '@/lib/vave/ai-results';

/**
 * Should-cost for one part, estimated by the AI from the part's description,
 * material, process and drawing analysis. There is no computed fallback: a
 * should-cost derived from the current price would only restate that price,
 * so when the AI cannot answer the request fails with an explicit status.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUserForAi('vave-should-cost');
  if (!auth.ok) return auth.response;

  try {
    const { part }: { part: VaveBomItem } = await request.json();

    if (!part) {
      return NextResponse.json({ error: 'part is required' }, { status: 400 });
    }

    const drawing = part.drawingAnalysis
      ? `\nDrawing analysis: ${JSON.stringify(part.drawingAnalysis)}`
      : '';
    const prompt = `You are a manufacturing cost engineer. Estimate the should-cost (what one piece ought to cost to make and sell at a fair margin) of this part, independently of what it is bought for today:
Part: ${part.partNumber} — ${part.description ?? ''}
Material: ${part.material ?? part.drawingAnalysis?.material ?? 'Unknown'}
Process: ${part.process ?? part.drawingAnalysis?.process ?? 'Unknown'}
Annual volume: ${part.annualVolume}${drawing}

Give every amount per piece in USD. If you cannot estimate a component, use null for it.
Return ONLY JSON: { "shouldCost": 0, "materialCost": 0, "processCost": 0, "overhead": 0, "margin": 0, "notes": "" }`;

    const ai = await requestAiText(prompt);
    if (!ai.ok) {
      return NextResponse.json({ error: ai.error, details: ai.details }, { status: ai.status });
    }

    try {
      return NextResponse.json(shouldCostFromAi(part, parseAiJson(ai.text)));
    } catch (error) {
      const message = error instanceof AiResultError ? error.message : 'AI should-cost answer is not valid JSON.';
      return NextResponse.json({ error: message }, { status: 502 });
    }
  } catch (error) {
    console.error('Should cost error:', error);
    return NextResponse.json({ error: 'Should cost calculation failed' }, { status: 500 });
  }
}
