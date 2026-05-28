import { NextRequest, NextResponse } from 'next/server';
import type { VaveBomItem, CostAnalysisResult, QFDMatrix } from '@/lib/api/vave';

export async function POST(request: NextRequest) {
  try {
    const { bomItems }: { bomItems: VaveBomItem[] } = await request.json();

    if (!bomItems?.length) {
      return NextResponse.json({ error: 'No BOM items provided' }, { status: 400 });
    }

    const sortedBySpend = [...bomItems].sort((a, b) => b.annualSpend - a.annualSpend);
    const totalSpend = sortedBySpend.reduce((s, i) => s + i.annualSpend, 0);

    // Build a concise BOM summary for the AI (top 30 items max to stay within token budget)
    const topItems = sortedBySpend.slice(0, 30).map((item) => ({
      partNumber: item.partNumber,
      description: item.description,
      annualSpend: item.annualSpend,
      material: item.material,
      process: item.process,
      supplier: item.supplierName,
    }));

    const prompt = `You are a Value Engineering expert performing a cost analysis on a manufacturing BOM.

BOM Data (sorted by annual spend, total = $${totalSpend.toFixed(2)}):
${JSON.stringify(topItems, null, 2)}

Perform ALL of the following analyses and return ONLY valid JSON (no markdown, no preamble):

1. Affinity Grouping: Group parts by functional similarity (max 6 groups, e.g. "Structural", "Fasteners", "Electronics", "Seals & Gaskets")
2. Focus Areas: List 3-6 specific actionable VAVE savings opportunities
3. QFD Matrix: Map customer needs to part functions — use the affinity group names as "functions"
   Customer needs to consider: Cost Reduction, Quality & Reliability, Weight Reduction, Lead Time, Serviceability, Regulatory Compliance

Return this exact JSON structure:
{
  "affinityGroups": [
    { "name": "Group Name", "parts": ["PN1", "PN2"], "totalCost": 0, "description": "Why these are grouped" }
  ],
  "focusAreas": ["Actionable focus area 1", "Actionable focus area 2"],
  "qfdMatrix": {
    "customerNeeds": ["Cost Reduction", "Quality & Reliability", "Weight Reduction", "Lead Time", "Serviceability"],
    "functions": ["GroupName1", "GroupName2"],
    "relationships": [
      { "need": "Cost Reduction", "function": "GroupName1", "weight": "Strong" }
    ]
  }
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return NextResponse.json({ error: 'AI analysis failed', details: err }, { status: response.status });
    }

    const aiData = await response.json();
    const rawText = aiData.content?.[0]?.text ?? '{}';
    let aiResult: { affinityGroups?: any[]; focusAreas?: string[]; qfdMatrix?: QFDMatrix } = {};
    try {
      aiResult = JSON.parse(rawText.replace(/```json|```/g, '').trim());
    } catch {
      aiResult = { affinityGroups: [], focusAreas: [] };
    }

    // Build Pareto items with cumulative percentage (computed locally — no AI needed)
    let cumulative = 0;
    const paretoItems = sortedBySpend.map((item) => {
      cumulative += item.annualSpend;
      const cumulativePct = totalSpend > 0 ? (cumulative / totalSpend) * 100 : 0;
      return {
        id: item.id,
        partNumber: item.partNumber,
        description: item.description,
        annualSpend: item.annualSpend,
        cumulativePct,
        isTopTwenty: cumulativePct <= 80 && item.annualSpend / totalSpend >= 0.005,
      };
    });

    // Enrich affinity groups with computed totalCost
    const spendMap = new Map(bomItems.map((i) => [i.partNumber, i.annualSpend]));
    const enrichedGroups = (aiResult.affinityGroups ?? []).map((g: any) => ({
      name: g.name,
      parts: g.parts ?? [],
      totalCost: (g.parts ?? []).reduce((s: number, pn: string) => s + (spendMap.get(pn) ?? 0), 0),
      description: g.description ?? '',
    }));

    const result: CostAnalysisResult = {
      paretoItems,
      affinityGroups: enrichedGroups,
      focusAreas: aiResult.focusAreas ?? [],
      qfdMatrix: aiResult.qfdMatrix,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('VAVE cost analysis error:', error);
    return NextResponse.json({ error: 'Cost analysis failed' }, { status: 500 });
  }
}
