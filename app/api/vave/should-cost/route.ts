import { NextRequest, NextResponse } from 'next/server';
import type { VaveBomItem, ShouldCostResult } from '@/lib/api/vave';

export async function POST(request: NextRequest) {
  try {
    const { part }: { part: VaveBomItem } = await request.json();

    if (!part) {
      return NextResponse.json({ error: 'part is required' }, { status: 400 });
    }

    // Bottom-up cost model baseline (industry standard ratios)
    const BASE_MATERIAL_RATIO = 0.45;
    const BASE_PROCESS_RATIO  = 0.30;
    const OVERHEAD_RATE       = 0.25;
    const MARGIN_RATE         = 0.15;

    let materialCost = part.unitCost * BASE_MATERIAL_RATIO;
    let processCost  = part.unitCost * BASE_PROCESS_RATIO;

    // Adjust process ratio based on manufacturing process complexity
    if (part.process) {
      const proc = part.process.toLowerCase();
      if (proc.includes('cnc') || proc.includes('mach')) {
        // CNC machining: higher process cost ratio
        processCost = part.unitCost * 0.40;
        materialCost = part.unitCost * 0.35;
      } else if (proc.includes('cast') || proc.includes('forge')) {
        // Casting/forging: moderate process cost
        processCost = part.unitCost * 0.25;
        materialCost = part.unitCost * 0.50;
      } else if (proc.includes('stamp') || proc.includes('press')) {
        // Stamping: lower process cost for high volume
        processCost = part.unitCost * 0.20;
        materialCost = part.unitCost * 0.55;
      } else if (proc.includes('inject') || proc.includes('mould') || proc.includes('mold')) {
        // Injection moulding: very low material, high tooling amortisation in overhead
        processCost = part.unitCost * 0.15;
        materialCost = part.unitCost * 0.40;
      }
    }

    // If drawing analysis available, refine using complexity
    if (part.drawingAnalysis) {
      const analysis = part.drawingAnalysis as any;
      if (analysis.complexity === 'complex') {
        processCost  = processCost * 1.25;
        materialCost = materialCost * 1.1;
      } else if (analysis.complexity === 'simple') {
        processCost  = processCost * 0.80;
      }
    }

    const overhead    = (materialCost + processCost) * OVERHEAD_RATE;
    const margin      = (materialCost + processCost + overhead) * MARGIN_RATE;
    const shouldCost  = materialCost + processCost + overhead + margin;
    const delta       = part.unitCost - shouldCost;
    const deltaPct    = part.unitCost > 0 ? (delta / part.unitCost) * 100 : 0;

    // If the part has drawing analysis or the gap is significant (>15%), enrich with Claude
    if ((part.drawingAnalysis || Math.abs(deltaPct) > 15) && part.unitCost > 0) {
      const enrichPrompt = `You are a manufacturing cost engineer. Provide a refined should-cost estimate for:
Part: ${part.partNumber} — ${part.description ?? ''}
Material: ${part.material ?? part.drawingAnalysis?.material ?? 'Unknown'}
Process: ${part.process ?? part.drawingAnalysis?.process ?? 'Unknown'}
Current price: $${part.unitCost.toFixed(2)}
My bottom-up estimate: $${shouldCost.toFixed(2)} (material: $${materialCost.toFixed(2)}, process: $${processCost.toFixed(2)}, overhead: $${overhead.toFixed(2)}, margin: $${margin.toFixed(2)})

Return ONLY JSON: { "shouldCost": 0, "materialCost": 0, "processCost": 0, "overhead": 0, "margin": 0, "notes": "" }`;

      try {
        const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY!,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 500,
            messages: [{ role: 'user', content: enrichPrompt }],
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const rawText = aiData.content?.[0]?.text ?? '{}';
          const refined = JSON.parse(rawText.replace(/```json|```/g, '').trim());
          if (refined.shouldCost > 0) {
            const result: ShouldCostResult = {
              shouldCost: Number(refined.shouldCost),
              materialCost: Number(refined.materialCost ?? materialCost),
              processCost: Number(refined.processCost ?? processCost),
              overhead: Number(refined.overhead ?? overhead),
              margin: Number(refined.margin ?? margin),
              delta: part.unitCost - Number(refined.shouldCost),
              deltaPct: part.unitCost > 0 ? ((part.unitCost - Number(refined.shouldCost)) / part.unitCost) * 100 : 0,
              benchmarkSource: 'AI-refined bottom-up model',
            };
            return NextResponse.json(result);
          }
        }
      } catch {
        // Fall through to baseline result
      }
    }

    const result: ShouldCostResult = {
      shouldCost,
      materialCost,
      processCost,
      overhead,
      margin,
      delta,
      deltaPct,
      benchmarkSource: 'Bottom-up model (material + process + overhead + margin)',
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Should cost error:', error);
    return NextResponse.json({ error: 'Should cost calculation failed' }, { status: 500 });
  }
}
