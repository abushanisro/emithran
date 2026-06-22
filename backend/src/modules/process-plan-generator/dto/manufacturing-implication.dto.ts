export type ImplicationType = 'process' | 'inspection' | 'characteristic' | 'material';

export type ImplicationSource =
  | 'drawing_tolerance'
  | 'drawing_thread'
  | 'drawing_coating'
  | 'drawing_note'
  | 'cad_geometry';

export interface MaterialCandidate {
  name: string;
  reason: string;
  score: number; // relative ranking score — not a probability; higher = more likely match
}

export interface ManufacturingImplication {
  type: ImplicationType;
  title: string;
  reason: string;
  confidence: number; // 0 for type:'material' (rule-based ranking, not probabilistic)
  source: ImplicationSource;
  details?: Record<string, string>;          // enriched data per type
  materialCandidates?: MaterialCandidate[];  // populated only for type: 'material'
}

// ── Thread lookup tables (ISO 965-1, class 6H) ───────────────────────────────

export const TAP_DRILL_MM: Record<string, number> = {
  'M2':   1.60, 'M2.5': 2.05, 'M3':  2.50, 'M4':  3.30,
  'M5':   4.20, 'M6':   5.00, 'M8':  6.75, 'M10': 8.50,
  'M12': 10.25, 'M16': 14.00, 'M20': 17.50, 'M24': 21.00,
};

const TAP_CYCLE_SEC_PER_HOLE: Record<string, number> = {
  'M2': 4, 'M2.5': 5, 'M3': 6, 'M4': 7, 'M5': 8,
  'M6': 10, 'M8': 14, 'M10': 18, 'M12': 22, 'M16': 28, 'M20': 35, 'M24': 42,
};

// ── GD&T inspection method lookup ────────────────────────────────────────────

const GDT_INSPECTION_METHOD: Record<string, string> = {
  'Position':         'CMM',
  'True Position':    'CMM',
  'Profile':          'CMM',
  'Perpendicularity': 'CMM',
  'Angularity':       'CMM',
  'Cylindricity':     'CMM',
  'Concentricity':    'CMM',
  'Symmetry':         'CMM',
  'Flatness':         'Surface Plate + Dial Indicator',
  'Parallelism':      'CMM or Surface Plate',
  'Circularity':      'Roundness Tester',
  'Runout':           'Dial Indicator on V-Block',
  'Total Runout':     'CMM or Dial Indicator',
};

// ── Material candidate scoring ────────────────────────────────────────────────

function scoreMaterialCandidates(
  sheetThicknessMm: number | null | undefined,
  coating: string | null | undefined,
  partName: string | null | undefined,
  drawingNotes: string | null | undefined,
): MaterialCandidate[] {
  const nameUpper  = (partName ?? '').toUpperCase();
  const coatingLow = (coating ?? '').toLowerCase();
  const notesUpper = (drawingNotes ?? '').toUpperCase();
  const isSheetMetal = (sheetThicknessMm ?? 0) > 0;

  // Part-name signals
  const hasStructural = /FRAME|BRACKET|MOUNT|CHASSIS|SUPPORT|BACKFRAME|FRONTFRAME|PANEL|ENCLOSURE|COVER|DOOR/.test(nameUpper);
  const hasHygienic   = /FOOD|PHARMA|MEDICAL|SANITARY|HYGIENE|STERILE|SURGICAL/.test(nameUpper);

  // Coating signals (field + drawing notes)
  const hasPowderCoat  = coatingLow.includes('powder') || notesUpper.includes('POWDER COAT');
  const hasZinc        = coatingLow.includes('zinc') || coatingLow.includes('galv') || notesUpper.includes('ZINC') || notesUpper.includes('GALVANIS');
  const hasPhosphating = notesUpper.includes('PHOSPHAT');
  const hasAnodize     = coatingLow.includes('anodiz') || notesUpper.includes('ANODIZ');

  // Notes signals
  const hasOutdoor     = /OUTDOOR|EXTERNAL|WEATHER|EXTERIOR/.test(notesUpper);
  const hasCorrosion   = /CORROSION|FOOD GRADE|FOOD-GRADE|HYGIENIC|FOOD CONTACT/.test(notesUpper);

  if (isSheetMetal) {
    let crcaScore  = 55;
    let hrScore    = 20;
    let ss304Score = 15;

    if (hasStructural)                         { crcaScore += 15; hrScore += 5; }
    if (hasPowderCoat || hasZinc)             { crcaScore += 10; ss304Score = Math.max(5, ss304Score - 5); }
    if (hasPhosphating)                        { crcaScore += 8; }
    if (hasOutdoor)                            { crcaScore += 5; hrScore += 3; }
    if (hasHygienic || hasCorrosion)          { ss304Score += 30; crcaScore -= 20; hrScore -= 10; }

    const crcaReason = [
      `${sheetThicknessMm} mm sheet metal part`,
      hasPowderCoat ? 'preferred substrate for powder coating' : 'standard grade for laser cutting and press brake forming',
      hasStructural ? 'structural / frame application confirmed by part name' : null,
      hasPhosphating ? 'phosphating pre-treatment suggests mild steel substrate' : null,
      'widely available in IS2062 standard',
    ].filter(Boolean).join(' · ');

    return [
      { name: 'IS2062 E250 CRCA',     reason: crcaReason, score: cap(crcaScore) },
      { name: 'IS2062 E350 HR Sheet', reason: 'Hot-rolled structural grade · higher yield strength for load-bearing brackets and frames · weldable', score: cap(hrScore) },
      {
        name: 'SS304 Sheet',
        reason: (hasHygienic || hasCorrosion)
          ? 'Hygienic / food / corrosion-resistant application detected — austenitic stainless steel required'
          : 'Use when corrosion resistance required without coating · common in outdoor or wet environments',
        score: cap(ss304Score),
      },
    ].sort((a, b) => b.score - a.score);
  }

  // CNC machined bar stock
  let en8Score   = 40;
  let alScore    = 30;
  let ss304Score = 15;

  if (hasStructural)                { en8Score  += 10; }
  if (hasHygienic || hasCorrosion) { ss304Score += 30; en8Score -= 15; }
  if (hasAnodize)                  { alScore   += 20; en8Score -= 10; }

  return [
    { name: 'EN8 / C45 Bar',        reason: 'General purpose medium-carbon steel · good machinability and strength · standard for CNC turning and milling', score: cap(en8Score) },
    {
      name: 'Aluminium 6061-T6 Bar',
      reason: hasAnodize
        ? 'Anodizing detected — aluminium alloy substrate required · T6 temper gives good strength-to-weight ratio'
        : 'Lightweight with excellent machinability · suitable for precision machined parts requiring good surface finish',
      score: cap(alScore),
    },
    {
      name: 'SS304 Bar',
      reason: (hasHygienic || hasCorrosion)
        ? 'Hygienic / food / corrosion-resistant application detected — stainless steel required'
        : 'Use for corrosion environments, chemical exposure, or hygienic applications',
      score: cap(ss304Score),
    },
  ].sort((a, b) => b.score - a.score);
}

// Scores are relative rankings, not probabilities — cap below 90 to avoid misleading consumers.
function cap(v: number): number {
  return Math.min(90, Math.max(0, v));
}

// ── Main export ───────────────────────────────────────────────────────────────

export function deriveImplications(item: {
  tightestToleranceMm?: number | null;
  coating?: string | null;
  sheetThicknessMm?: number | null;
  drawingMaterial?: string | null;
  partName?: string | null;
  drawingIntelligence?: {
    threads?: Array<{ size: string; pitch: number; count: number; extractionConfidence?: number; extractionSource?: string }>;
    gdt_callouts?: Array<{ type: string; tolerance: number; datum: string }>;
    drawing_notes?: string;
  } | null;
}): ManufacturingImplication[] {
  const implications: ManufacturingImplication[] = [];

  const threads     = item.drawingIntelligence?.threads ?? [];
  const gdtCallouts = item.drawingIntelligence?.gdt_callouts ?? [];
  const notes       = (item.drawingIntelligence?.drawing_notes ?? '').toLowerCase();
  const tol         = item.tightestToleranceMm;
  const coating     = item.coating;

  // ── 1. Thread intelligence (ISO 965-1) ───────────────────────────────────
  if (threads.length > 0) {
    const totalHoles = threads.reduce((s, t) => s + t.count, 0);
    const specs = threads.map((t) => `${t.size}×${t.pitch} ×${t.count}`).join(', ');
    const primary = threads[0];
    const tapDrillMm = TAP_DRILL_MM[primary.size] ?? null;
    const estimatedCycleSec = Math.round(
      threads.reduce((s, t) => s + t.count * (TAP_CYCLE_SEC_PER_HOLE[t.size] ?? 10), 0),
    );
    // Blind hole inferred from notes; hole depth data not yet available from drawing extraction.
    // TODO: when drawing extraction provides threadDepth/holeDepth, use it here instead.
    const isBlindHole = notes.includes('blind');
    const toolType = isBlindHole ? 'Spiral-Flute Tap' : 'Spiral-Point Tap';

    implications.push({
      type: 'process',
      title: `Tapping Required (${totalHoles} hole${totalHoles !== 1 ? 's' : ''})`,
      reason: `Drawing threads detected: ${specs}`,
      confidence: 0.92,
      source: 'drawing_thread',
      details: {
        tapDrillMm:         tapDrillMm != null ? String(tapDrillMm) : 'refer drawing',
        tool:               `${primary.size} ${toolType}`,
        classFit:           '6H',
        inspection:         'Go/No-Go Thread Gauge',
        estimatedCycleSec:  String(estimatedCycleSec),
        recommendedProcess: isBlindHole
          ? 'Rigid tapping with spiral-flute tap (blind holes — chip evacuation critical)'
          : 'Rigid tapping with spiral-point tap (through holes)',
        depthBasis:         isBlindHole ? 'blind_inferred_from_notes' : 'assumed_through',
        standard:           'ISO 965-1',
      },
    });
  }

  // ── 2. Tight tolerance ≤ ±0.10 mm → CMM (ISO 2768) ──────────────────────
  if (tol != null && tol > 0 && tol <= 0.10) {
    implications.push({
      type: 'inspection',
      title: 'CMM Inspection Required',
      reason: `Tightest tolerance ±${tol} mm — exceeds manual gauge threshold`,
      confidence: 0.90,
      source: 'drawing_tolerance',
      details: { standard: 'ISO 2768' },
    });
  }

  // ── 3. Coating present → Surface Treatment ───────────────────────────────
  if (coating && coating !== 'None') {
    implications.push({
      type: 'process',
      title: 'Surface Treatment Required',
      reason: `Drawing-confirmed coating: ${coating}`,
      confidence: 0.88,
      source: 'drawing_coating',
      details: { standard: 'ISO 2409' },
    });
  }

  // ── 4. Bending dimensions critical → FAI ─────────────────────────────────
  if (notes.includes('bending') && notes.includes('critical')) {
    implications.push({
      type: 'inspection',
      title: 'First Article Inspection — Bend Dimensions Critical',
      reason: 'Drawing note specifies bending dimensions are critical',
      confidence: 0.85,
      source: 'drawing_note',
    });
  }

  // ── 5. GD&T callouts → precision inspection with method ──────────────────
  const GDT_TYPES = Object.keys(GDT_INSPECTION_METHOD);
  const relevantCallouts = gdtCallouts.filter((g) =>
    GDT_TYPES.some((t) => g.type?.includes(t)),
  );

  if (relevantCallouts.length > 0) {
    const tightest  = Math.min(...relevantCallouts.map((g) => g.tolerance));
    const typeSet   = [...new Set(relevantCallouts.map((g) => g.type))];
    const CMM_FIRST = ['Position', 'True Position', 'Profile', 'Perpendicularity', 'Angularity'];
    const primaryCallout = relevantCallouts.find((g) =>
      CMM_FIRST.some((t) => g.type?.includes(t)),
    ) ?? relevantCallouts[0];
    const methodKey = GDT_TYPES.find((key) => primaryCallout.type?.includes(key));
    const method    = methodKey ? GDT_INSPECTION_METHOD[methodKey] : 'CMM';

    implications.push({
      type: 'inspection',
      title: `Precision Measurement Required — ${relevantCallouts.length} GD&T callout${relevantCallouts.length !== 1 ? 's' : ''}`,
      reason: `Geometric tolerances: ${typeSet.join(', ')} — tightest zone: ${tightest} mm`,
      confidence: 0.93,
      source: 'drawing_tolerance',
      details: {
        inspectionMethod: method,
        calloutCount:     String(relevantCallouts.length),
        tightestZoneMm:   String(tightest),
        types:            typeSet.join(', '),
        standard:         'ASME Y14.5 / ISO 1101',
      },
    });
  }

  // ── 6. Material candidates — when drawing doesn't specify ─────────────────
  const UNSPECIFIED = new Set(['Unknown', 'Not Specified', 'Not specified', 'None', '']);
  const isUnspecified = !item.drawingMaterial || UNSPECIFIED.has(item.drawingMaterial.trim());

  if (isUnspecified) {
    const isSheetMetal = (item.sheetThicknessMm ?? 0) > 0;
    const candidates = scoreMaterialCandidates(
      item.sheetThicknessMm,
      coating,
      item.partName,
      item.drawingIntelligence?.drawing_notes,
    );

    implications.push({
      type: 'material',
      title: 'Material Not Specified on Drawing',
      reason: `No material callout found — candidates ranked by rule-based scoring (${isSheetMetal ? 'sheet geometry, coating, part name, drawing notes' : 'part family, coating, application keywords'})`,
      confidence: 0, // rule-based ranking — not a probabilistic confidence estimate
      source: 'cad_geometry',
      materialCandidates: candidates,
    });
  }

  return implications;
}
