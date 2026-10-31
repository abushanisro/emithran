import { NextRequest, NextResponse } from 'next/server';
import type { VaveBomItem, VaveShouldCost } from '@/lib/api/vave';
import { requireUserForAi } from '@/lib/server/auth';
import { parseAiJson, requestAiText } from '@/lib/server/anthropic';
import { AiResultError, ideasFromAi } from '@/lib/vave/ai-results';

interface IdeationRequest {
  bomItems: VaveBomItem[];
  focusAreas: string[];
  shouldCostGaps: VaveShouldCost[];
}

export async function POST(request: NextRequest) {
  const auth = await requireUserForAi('vave-ideation');
  if (!auth.ok) return auth.response;

  try {
    const { bomItems, focusAreas, shouldCostGaps }: IdeationRequest = await request.json();

    const topGaps = [...(shouldCostGaps ?? [])]
      .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
      .slice(0, 10)
      .map((g) => ({
        partNumber: g.partNumber,
        actualCost: g.actualCost,
        shouldCost: g.shouldCost,
        delta: g.delta,
        deltaPct: g.deltaPct,
      }));

    const topParts = [...(bomItems ?? [])]
      .sort((a, b) => b.annualSpend - a.annualSpend)
      .slice(0, 15)
      .map((i) => ({
        partNumber: i.partNumber,
        description: i.description,
        annualSpend: i.annualSpend,
        material: i.material,
        process: i.process,
        supplier: i.supplierName,
      }));

    const prompt = `You are a senior Value Engineering expert with 20 years of manufacturing experience.

Focus Areas identified for VAVE:
${JSON.stringify(focusAreas)}

Top Cost-Driving Parts:
${JSON.stringify(topParts, null, 2)}

Should Cost Gaps (actual vs. what part should cost):
${JSON.stringify(topGaps, null, 2)}

Generate 12 VAVE ideas using SCAMPER and TRIZ frameworks. Cover a mix of:
- Material substitution (Substitute)
- Part consolidation (Combine/Eliminate)
- Design simplification (Modify/Rearrange)
- Process changes (Adapt/Put to other use)
- Make vs. Buy decisions
- Supplier consolidation

Return ONLY a valid JSON array (no markdown, no preamble):
[{
  "title": "Concise idea title",
  "description": "2-3 sentence description of what to change and why",
  "framework": "SCAMPER",
  "scamperType": "Substitute|Combine|Adapt|Modify|Put to other use|Eliminate|Rearrange",
  "affectedParts": ["part_number"],
  "estSavingsUsd": 0,
  "estInvestmentUsd": 0,
  "feasibility": "High|Medium|Low",
  "complexity": "L1|L2|L3",
  "risk": "High|Medium|Low",
  "timeToImplementMonths": 0
}]`;

    const ai = await requestAiText(prompt);
    if (!ai.ok) {
      return NextResponse.json({ error: ai.error, details: ai.details }, { status: ai.status });
    }

    // An unreadable answer is an error, not an empty idea list; ratings the
    // model left out stay unset rather than defaulting to a middle value.
    try {
      return NextResponse.json(ideasFromAi(parseAiJson(ai.text)));
    } catch (error) {
      const message = error instanceof AiResultError ? error.message : 'AI ideation answer is not valid JSON.';
      return NextResponse.json({ error: message }, { status: 502 });
    }
  } catch (error) {
    console.error('VAVE ideation error:', error);
    return NextResponse.json({ error: 'Ideation failed' }, { status: 500 });
  }
}
