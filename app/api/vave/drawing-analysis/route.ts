import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { DrawingAnalysisResult } from '@/lib/api/vave';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

const FALLBACK: DrawingAnalysisResult = {
  material: 'Unknown',
  material_confidence: 0,
  process: 'Unknown',
  dimensions_mm: { L: 0, W: 0, H: 0 },
  tightest_tolerance_mm: 0,
  tolerance_confidence: 0,
  surface_finish_ra: 0,
  surface_finish_confidence: 0,
  sheet_thickness_mm: 0,
  sheet_thickness_confidence: 0,
  bend_count: 0,
  heat_treatment: 'None',
  coating: 'None',
  complexity: 'medium',
  threads: [],
  gdt_callouts: [],
  clearanceHoles: [],
  general_tolerances: '',
  drawing_revision: '',
  drawing_notes: '',
  drawing_intelligence_confidence: 0,
};

export async function POST(request: NextRequest) {
  try {
    const body: {
      imageUrl?: string;
      imageBase64?: string;
      mediaType?: string;
      partNumber?: string;
    } = await request.json();

    const { imageUrl, imageBase64, partNumber } = body;

    if (!imageUrl && !imageBase64) {
      return NextResponse.json({ error: 'imageUrl or imageBase64 is required' }, { status: 400 });
    }

    let base64: string;
    let mediaType: string;

    if (imageBase64) {
      base64 = imageBase64;
      mediaType = (body.mediaType ?? 'image/png') as string;
    } else {
      const imageResponse = await fetch(imageUrl!);
      if (!imageResponse.ok) {
        return NextResponse.json({ error: 'Failed to fetch drawing image' }, { status: 400 });
      }
      const contentType = imageResponse.headers.get('content-type') ?? 'image/png';
      mediaType =
        contentType.includes('pdf')
          ? 'application/pdf'
          : contentType.includes('jpeg') || contentType.includes('jpg')
            ? 'image/jpeg'
            : 'image/png';
      const buffer = await imageResponse.arrayBuffer();
      base64 = Buffer.from(buffer).toString('base64');
    }

    const fileDesc = mediaType === 'application/pdf' ? 'PDF engineering drawing' : 'engineering drawing image';

    const prompt = `You are a manufacturing engineering expert. Analyze this ${fileDesc}${partNumber ? ` for part ${partNumber}` : ''} and extract the following. For each AI-interpreted field also return a confidence score (0.0–1.0) reflecting how clearly the drawing states the value (1.0 = explicitly written in title block, 0.5 = inferred from symbols/context, 0.0 = not found/guessed).

1. Material specification — read ONLY from the title block or an explicit material callout on the drawing. Do not infer, guess, or substitute similar grades. If the title block is unclear or absent, return "Not specified" with material_confidence: 0. Examples of valid values: "CRCA", "SS304", "Aluminium 6061-T6"
2. Manufacturing process (e.g., "Sheet Metal Laser Cutting", "CNC Machining", "Die Casting", "Injection Moulding")
3. Envelope dimensions in mm (L × W × H — read from title block first, then estimate from drawing views; use formed/assembled dimensions, not flat-pattern)
4. Tightest tolerance in mm (e.g., 0.05 for ±0.05) — look for GD&T callouts, tolerance blocks, general tolerance note
5. Surface finish Ra in µm (e.g., 1.6) — look for Ra symbols (√), finish callouts, or general notes; return 0 if not stated
6. Sheet metal material thickness in mm — look for notes like "2.0mm CRCA", "t=1.5", "THKNS: 3mm"; also check the NOTES block for statements like "SHEET THICKNESS- 1.6 mm", "SHEET THK: 2.0", "MATERIAL THICKNESS 1.2MM" and extract that value; return 0 if not sheet metal or not stated anywhere
7. Number of bends — count distinct bend lines or press-brake form lines; return 0 if not sheet metal or unclear
8. Heat treatment (e.g., "Case hardened", "Annealed", "None")
9. Coating (e.g., "Zinc plated", "Powder coated RAL9005", "None")
10. Overall complexity: simple | medium | complex
11. Thread callouts — list ALL tapped/threaded holes as an array. For each entry: size (e.g. "M4"), pitch in mm (e.g. 0.7), count (integer), extractionConfidence (0.0–1.0: 1.0 = explicit callout table with pitch stated, 0.7 = clear thread symbol with standard pitch assumed, 0.4 = inferred from note or unclear context), extractionSource (always "drawing_ai"). Return [] if none found.
12. GD&T callouts — list ALL geometric tolerance frames (FCF boxes). For each: type — one of "Position", "Flatness", "Parallelism", "Perpendicularity", "Profile", "Runout", "Straightness", "Circularity", "Cylindricity", "Angularity" (map GD&T symbols to these names); tolerance — value in mm as a number; datum — datum reference letters joined with "|" (e.g. "A|B|C"), "" if none; confidence — 0.0–1.0 (1.0 = clearly legible FCF box, 0.5 = partially legible, 0.3 = inferred). Return [] if none found.
13. General tolerance standard (e.g. "ISO 2768-mK", "DIN ISO 2768-m", "ASME Y14.5-2009"); return "" if not stated
14. Drawing revision (e.g. "Rev A", "B", "Rev 1.2", "2"); return "" if not stated
15. Drawing notes — verbatim content of the general notes block (max 300 chars); return "" if not present
16. Overall drawing intelligence confidence (0.0–1.0) reflecting how complete and clearly documented the drawing is
17. Clearance hole callouts — extract non-threaded hole callouts such as "6X Ø8.80 +0.05/-0.00" or "4X Ø4.5 THRU". For each: diameterMm (e.g. 8.80), count (integer), tolerancePlus (e.g. 0.05, or null if not stated), toleranceMinus (e.g. 0.00, or null if not stated). Do NOT include threaded holes here — only plain/clearance/through holes. Return [] if none found.

Return ONLY valid JSON (no markdown, no preamble):
{
  "material": "",
  "material_confidence": 0.0,
  "process": "",
  "dimensions_mm": {"L": 0, "W": 0, "H": 0},
  "tightest_tolerance_mm": 0,
  "tolerance_confidence": 0.0,
  "surface_finish_ra": 0,
  "surface_finish_confidence": 0.0,
  "sheet_thickness_mm": 0,
  "sheet_thickness_confidence": 0.0,
  "bend_count": 0,
  "heat_treatment": "",
  "coating": "",
  "complexity": "simple",
  "threads": [{"size": "M4", "pitch": 0.7, "count": 2, "extractionConfidence": 0.9, "extractionSource": "drawing_ai"}],
  "gdt_callouts": [{"type": "Position", "tolerance": 0.05, "datum": "A|B", "confidence": 0.9}],
  "clearanceHoles": [{"diameterMm": 8.80, "count": 6, "tolerancePlus": 0.05, "toleranceMinus": 0.0}],
  "general_tolerances": "",
  "drawing_revision": "",
  "drawing_notes": "",
  "drawing_intelligence_confidence": 0.0
}`;

    const geminiResult = await model.generateContent([
      {
        inlineData: {
          mimeType: mediaType,
          data: base64,
        },
      },
      prompt,
    ]);

    const rawText = geminiResult.response.text();

    let result: DrawingAnalysisResult;
    try {
      result = JSON.parse(rawText.replace(/```json|```/g, '').trim());
      // Ensure array fields are always arrays
      if (!Array.isArray(result.threads)) result.threads = [];
      if (!Array.isArray(result.gdt_callouts)) result.gdt_callouts = [];
      if (!Array.isArray(result.clearanceHoles)) result.clearanceHoles = [];
    } catch {
      result = { ...FALLBACK };
    }

    result.analyzedAt = new Date().toISOString();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Drawing analysis error:', error);
    return NextResponse.json({ error: 'Drawing analysis failed' }, { status: 500 });
  }
}
