import { NextRequest, NextResponse } from 'next/server';
import type { VaveBomItem, VaveShouldCost, CreateVaveIdea } from '@/lib/api/vave';

interface IdeationRequest {
  bomItems: VaveBomItem[];
  focusAreas: string[];
  shouldCostGaps: VaveShouldCost[];
}

export async function POST(request: NextRequest) {
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

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return NextResponse.json({ error: 'AI ideation failed', details: err }, { status: response.status });
    }

    const aiData = await response.json();
    const rawText = aiData.content?.[0]?.text ?? '[]';

    let ideas: CreateVaveIdea[] = [];
    try {
      ideas = JSON.parse(rawText.replace(/```json|```/g, '').trim());
      if (!Array.isArray(ideas)) ideas = [];
    } catch {
      ideas = [];
    }

    // Sanitize and add defaults
    const FRAMEWORKS: readonly string[] = ['SCAMPER', 'TRIZ', 'FAST', 'Manual'];
    const FEASIBILITIES: readonly string[] = ['High', 'Medium', 'Low'];
    const COMPLEXITIES: readonly string[] = ['L1', 'L2', 'L3'];
    const sanitized: CreateVaveIdea[] = ideas.map((idea) => ({
      title: String(idea.title ?? 'Untitled idea').slice(0, 255),
      description: idea.description ?? undefined,
      framework: (FRAMEWORKS.includes(idea.framework ?? '') ? idea.framework : 'SCAMPER') as CreateVaveIdea['framework'],
      scamperType: idea.scamperType ?? undefined,
      affectedParts: Array.isArray(idea.affectedParts) ? idea.affectedParts : [],
      estSavingsUsd: Math.max(0, Number(idea.estSavingsUsd ?? 0)),
      estInvestmentUsd: Math.max(0, Number(idea.estInvestmentUsd ?? 0)),
      feasibility: (FEASIBILITIES.includes(idea.feasibility ?? '') ? idea.feasibility : 'Medium') as CreateVaveIdea['feasibility'],
      complexity: (COMPLEXITIES.includes(idea.complexity ?? '') ? idea.complexity : 'L2') as CreateVaveIdea['complexity'],
      risk: (FEASIBILITIES.includes(idea.risk ?? '') ? idea.risk : 'Medium') as CreateVaveIdea['risk'],
      timeToImplementMonths: idea.timeToImplementMonths ? Number(idea.timeToImplementMonths) : undefined,
      status: 'draft' as const,
    }));

    return NextResponse.json(sanitized);
  } catch (error) {
    console.error('VAVE ideation error:', error);
    return NextResponse.json({ error: 'Ideation failed' }, { status: 500 });
  }
}
