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

// ── Material grade normalization ───────────────────────────────────────────────
// The vision model returns the title-block text more or less verbatim, which fails
// downstream exact-grade lookups two ways: OCR lookalikes ("AA606I", "5O52") and
// format drift ("AL 6061", "Aluminium 6061-T6" vs the canonical "AA6061-T6").

const AL_WROUGHT_SERIES = new Set([
  '1100', '2014', '2024', '3003', '5052', '5083', '5754',
  '6060', '6061', '6063', '6082', '7050', '7075',
]);

// Letter lookalikes adjacent to digits only — never touches real alpha tokens
function fixOcrDigitLookalikes(s: string): string {
  return s
    .replace(/(?<=\d)[IL]/g, '1')
    .replace(/[IL](?=\d{2})/g, '1')
    .replace(/(?<=\d)O(?=\d|$)/g, '0')
    .replace(/(?<=[A-Z]{2}\d)O/g, '0');
}

/**
 * Canonicalize a raw material string. Returns null when the string carries no
 * material information (empty / "Not specified" / "Unknown") so callers can fall
 * back to rescanning the notes block.
 */
function normalizeMaterialGrade(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const up = fixOcrDigitLookalikes(raw.toUpperCase().trim());
  if (up.length === 0 || /NOT\s*SPECIFIED|UNKNOWN|^N\/?A$|^NONE$|^-+$/.test(up)) return null;

  // Aluminium wrought: "AA6061", "AA 6061", "AL-6061", "ALUMINIUM 6061-T6", "6061T6"
  const al = up.match(/(?:AA|AL(?:UMINI?UM)?)?[\s\-]*(\d{4})[\s\-]*(T\d{1,2}|H\d{2})?/);
  if (al?.[1] && AL_WROUGHT_SERIES.has(al[1])) {
    return `AA${al[1]}${al[2] ? `-${al[2]}` : ''}`;
  }

  // Stainless: "SS304", "SS 316L", "AISI 304", "STAINLESS STEEL 316"
  const ss = up.match(/(?:SS|AISI|STAINLESS(?:\s+STEEL)?)[\s\-]*(\d{3}L?)/);
  if (ss?.[1]) return `SS${ss[1]}`;

  return raw.trim(); // CRCA / MS / IS2062 / DC01 etc. pass through verbatim
}

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

1. Material specification — read ONLY from the title block or an explicit material callout on the drawing. Also check the NOTES block for lines like "MATERIAL - AA6061", "MATL: SS304", "MATERIAL: CRCA". Transcribe the grade digits exactly as printed (e.g. "AA6061", not "AA606I"). Do not infer, guess, or substitute similar grades. If no material is stated anywhere, return "Not specified" with material_confidence: 0. Examples of valid values: "CRCA", "SS304", "AA6061-T6"
2. Manufacturing process (e.g., "Sheet Metal Laser Cutting", "CNC Machining", "Die Casting", "Injection Moulding")
3. Envelope dimensions in mm (L × W × H — read from title block first, then estimate from drawing views; use formed/assembled dimensions, not flat-pattern)
4. Tightest tolerance in mm (e.g., 0.05 for ±0.05) — look for GD&T callouts, tolerance blocks, general tolerance note
5. Surface finish Ra in µm (e.g., 1.6) — look for Ra symbols (√), finish callouts, or general notes; return 0 if not stated
6. Sheet metal material thickness in mm — look for notes like "2.0mm CRCA", "t=1.5", "THKNS: 3mm"; also check the NOTES block for statements like "SHEET THICKNESS- 1.6 mm", "SHEET THK: 2.0", "MATERIAL THICKNESS 1.2MM" and extract that value; return 0 if not sheet metal or not stated anywhere
7. Number of bends — count EVERY press-brake fold, using all evidence: (a) side/section/end views: each 90° (or other angle) change of direction in the sheet profile is one bend — an L-profile has 1, a U- or Z-profile has 2, a hat profile has 4; (b) flat-pattern views: count dashed/phantom bend lines; (c) notes like "BEND UP 90°", "2 BENDS", "FOLD LINE". A bracket with two formed flanges = 2 bends even if no bend line is drawn. Return 0 ONLY if the part is clearly flat in every view; return 0 if not sheet metal
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

    // Canonicalize the material grade; if the model returned nothing usable,
    // rescue an explicit "MATERIAL - <grade>" callout from the notes block.
    const normalized = normalizeMaterialGrade(result.material);
    if (normalized) {
      result.material = normalized;
    } else {
      const noteMatch = (result.drawing_notes ?? '')
        .toUpperCase()
        // Separator matched via alternation, not a character class: Tailwind's
        // source scanner treats any bracket-colon token in app/ files as an
        // arbitrary-property class and emits invalid CSS.
        .match(/MATERIAL\s*(?:-|–|:|=)?\s*([A-Z0-9][A-Z0-9 .\-\/]{1,30})/);
      const rescued = noteMatch?.[1] ? normalizeMaterialGrade(noteMatch[1]) : null;
      if (rescued) {
        result.material = rescued;
        // Explicit callout, but read from notes rather than title block
        result.material_confidence = Math.max(result.material_confidence ?? 0, 0.7);
      }
    }

    result.analyzedAt = new Date().toISOString();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Drawing analysis error:', error);
    return NextResponse.json({ error: 'Drawing analysis failed' }, { status: 500 });
  }
}
