import { NextRequest, NextResponse } from 'next/server';
import type { VaveBomItem, CostAnalysisResult } from '@/lib/api/vave';
import { requireUserForAi } from '@/lib/server/auth';
import { refuseCrossOrigin } from '@/lib/server/bff/origin';
import { readJsonBody } from '@/lib/server/read-body';
import { parseAiJson, requestAiText } from '@/lib/server/anthropic';
import { AiResultError, costAnalysisFromAi } from '@/lib/vave/ai-results';

// A BOM summary: generous for thousands of items, far below anything that strains the server.
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const refused = refuseCrossOrigin(request);
  if (refused) return refused;
  const auth = await requireUserForAi('vave-cost-analysis');
  if (!auth.ok) return auth.response;

  try {
    const parsed = await readJsonBody<{ bomItems?: VaveBomItem[] } | null>(request, MAX_BODY_BYTES);
    if (!parsed.ok) return parsed.response;
    const { bomItems } = parsed.value ?? {};

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

    const ai = await requestAiText(prompt);
    if (!ai.ok) {
      return NextResponse.json({ error: ai.error, details: ai.details }, { status: ai.status });
    }

    // An unreadable answer is an error, not an analysis with no groups.
    const spendMap = new Map(bomItems.map((i) => [i.partNumber, i.annualSpend]));
    let aiResult;
    try {
      aiResult = costAnalysisFromAi(parseAiJson(ai.text), spendMap);
    } catch (error) {
      const message = error instanceof AiResultError ? error.message : 'AI cost analysis answer is not valid JSON.';
      return NextResponse.json({ error: message }, { status: 502 });
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

    const result: CostAnalysisResult = {
      paretoItems,
      ...aiResult,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('VAVE cost analysis error:', error);
    return NextResponse.json({ error: 'Cost analysis failed' }, { status: 500 });
  }
}
