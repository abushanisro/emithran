import { NextRequest, NextResponse } from 'next/server';
import type { DrawingAnalysisResult } from '@/lib/api/vave';

export async function POST(request: NextRequest) {
  try {
    const { imageUrl, partNumber }: { imageUrl: string; partNumber?: string } = await request.json();

    if (!imageUrl) {
      return NextResponse.json({ error: 'imageUrl is required' }, { status: 400 });
    }

    // Fetch the image and convert to base64
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return NextResponse.json({ error: 'Failed to fetch drawing image' }, { status: 400 });
    }

    const contentType = imageResponse.headers.get('content-type') ?? 'image/png';
    const mediaType = contentType.includes('jpeg') || contentType.includes('jpg')
      ? 'image/jpeg'
      : contentType.includes('pdf')
      ? 'image/png' // PDFs not supported directly; caller should convert first
      : 'image/png';

    const buffer = await imageResponse.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');

    const prompt = `You are a manufacturing engineering expert. Analyze this engineering drawing${partNumber ? ` for part ${partNumber}` : ''} and extract:
1. Material specification (e.g., "Steel 1018", "Aluminium 6061-T6", "ABS Plastic")
2. Manufacturing process (e.g., "CNC Machining", "Die Casting", "Injection Moulding", "Sheet Metal Stamping")
3. Envelope dimensions in mm (L × W × H — estimate from title block or drawing views)
4. Tightest tolerance found (in mm, e.g., ±0.05)
5. Surface finish requirement (Ra value in µm, e.g., 1.6)
6. Heat treatment or coating (e.g., "Case hardened", "Zinc plated", "None")
7. Overall complexity (simple = standard geometry, medium = moderate complexity, complex = high precision/complex geometry)

Return ONLY valid JSON (no markdown, no preamble):
{
  "material": "",
  "process": "",
  "dimensions_mm": {"L": 0, "W": 0, "H": 0},
  "tightest_tolerance_mm": 0,
  "surface_finish_ra": 0,
  "heat_treatment": "",
  "coating": "",
  "complexity": "simple|medium|complex"
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
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64 },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return NextResponse.json({ error: 'Drawing analysis failed', details: err }, { status: response.status });
    }

    const aiData = await response.json();
    const rawText = aiData.content?.[0]?.text ?? '{}';

    let result: DrawingAnalysisResult;
    try {
      result = JSON.parse(rawText.replace(/```json|```/g, '').trim());
    } catch {
      result = {
        material: 'Unknown',
        process: 'Unknown',
        dimensions_mm: { L: 0, W: 0, H: 0 },
        tightest_tolerance_mm: 0,
        surface_finish_ra: 0,
        heat_treatment: 'None',
        coating: 'None',
        complexity: 'medium',
      };
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Drawing analysis error:', error);
    return NextResponse.json({ error: 'Drawing analysis failed' }, { status: 500 });
  }
}
