// Pure function — no DB, no async. All inputs must be pre-resolved by the caller.

// C₀ back-calculated from spec example:
//   allowance = 0.1186 = C × 2mm × sqrt(352/10) ⟹ C ≈ 0.0593
const PART_ALLOWANCE_CONSTANT = 0.0593;

// Standard stock sheet sizes (width × length mm), ascending by area
const STANDARD_SHEETS: ReadonlyArray<[number, number]> = [
  [1000, 2000],
  [1250, 2500],
  [1500, 3000],
  [2000, 4000],
  [2500, 5000],
];

const EDGE_ALLOWANCE_MM = 2; // minimum clearance from sheet edge

export interface NestingInput {
  flatPatternLengthMm: number;   // unfolded longest dimension
  flatPatternWidthMm: number;    // unfolded shorter dimension
  thicknessMm: number;
  netWeightKg: number;           // from CAD volume × density (already computed by caller)
  densityKgM3: number;
  shearStrengthMpa: number;      // from raw_materials (used for part allowance)
  materialPricePerKg: number;
  scrapPricePerKg?: number;      // recovery value (default 0)
  edgeAllowanceMm?: number;      // default 2
  scrapRecoveryPct?: number;     // fraction recovered (default 0.90)
  hasImpressions?: boolean;      // true for stamping (adds 10mm extra)
}

export interface NestingResult {
  sheetLengthMm: number;
  sheetWidthMm: number;
  partsPerSheet: number;
  sheetWeightKg: number;
  grossWeightPerPartKg: number;
  scrapWeightPerPartKg: number;
  utilisationPct: number;
  grossMaterialCost: number;     // in same currency as materialPricePerKg
  scrapRecoveryCost: number;
  netMaterialCost: number;
  partAllowanceMm: number;
}

export interface NestingDimensionResolution {
  lengthMm: number;
  widthMm: number;
  source: 'cad_flat_pattern_bounding_rect' | 'folded_3d_bounding_box';
  confidence: 'verified' | 'fallback';
}

// Which rectangle nesting should actually pack against. Prefers the
// cad-engine's true unfolded flat-pattern bounding rectangle (from its 2D
// unfold solver) over the folded 3D part's own bounding box -- for any bent
// part these are two genuinely different rectangles (unfolding adds
// developed length at each bend), so packing against the folded envelope
// overcounts real nesting capacity. Falls back to the folded box only when
// the true flat-pattern rectangle wasn't resolvable for this part (e.g.
// non-manifold topology the unfold solver couldn't walk) -- never silently;
// source/confidence disclose exactly which rectangle was used.
export function resolveNestingDimensions(
  trueFlatLengthMm: number,
  trueFlatWidthMm: number,
  foldedLengthMm: number,
  foldedWidthMm: number,
): NestingDimensionResolution {
  if (trueFlatLengthMm > 0 && trueFlatWidthMm > 0) {
    return {
      lengthMm: Math.max(trueFlatLengthMm, trueFlatWidthMm),
      widthMm: Math.min(trueFlatLengthMm, trueFlatWidthMm),
      source: 'cad_flat_pattern_bounding_rect',
      confidence: 'verified',
    };
  }
  return {
    lengthMm: foldedLengthMm,
    widthMm: foldedWidthMm,
    source: 'folded_3d_bounding_box',
    confidence: 'fallback',
  };
}

export function computeNesting(input: NestingInput): NestingResult {
  const {
    flatPatternLengthMm,
    flatPatternWidthMm,
    thicknessMm,
    netWeightKg,
    densityKgM3,
    shearStrengthMpa,
    materialPricePerKg,
    scrapPricePerKg = 0,
    edgeAllowanceMm = EDGE_ALLOWANCE_MM,
    scrapRecoveryPct = 0.90,
    hasImpressions = false,
  } = input;

  // Part-to-part allowance (punch/draw cushion from spec formula)
  const shearSafe = shearStrengthMpa > 0 ? shearStrengthMpa : 350;
  const partAllowanceMm =
    PART_ALLOWANCE_CONSTANT * thicknessMm * Math.sqrt(shearSafe / 10) +
    (hasImpressions ? 10 : 0);

  const usablePartL = flatPatternLengthMm + partAllowanceMm;
  const usablePartW = flatPatternWidthMm + partAllowanceMm;

  let bestParts = 0;
  let bestSheet: [number, number] = STANDARD_SHEETS[STANDARD_SHEETS.length - 1];

  for (const [w, l] of STANDARD_SHEETS) {
    if (w < flatPatternWidthMm + 2 * edgeAllowanceMm) continue;
    if (l < flatPatternLengthMm + 2 * edgeAllowanceMm) continue;

    const usableW = w - 2 * edgeAllowanceMm;
    const usableL = l - 2 * edgeAllowanceMm;

    // Try both orientations and pick the better one
    const pOrient1 =
      Math.floor(usableW / usablePartW) * Math.floor(usableL / usablePartL);
    const pOrient2 =
      Math.floor(usableW / usablePartL) * Math.floor(usableL / usablePartW);

    const p = Math.max(pOrient1, pOrient2);
    if (p > bestParts) {
      bestParts = p;
      bestSheet = [w, l];
    }
  }

  // Guard: at least 1 part per sheet
  if (bestParts < 1) bestParts = 1;

  const [sheetW, sheetL] = bestSheet;
  const sheetVolMm3 = sheetW * sheetL * thicknessMm;
  const sheetWeightKg = (sheetVolMm3 / 1e9) * densityKgM3;
  const grossWeightPerPart = sheetWeightKg / bestParts;
  const scrapWeightPerPart = Math.max(0, grossWeightPerPart - netWeightKg);
  const utilisation = netWeightKg > 0 && grossWeightPerPart > 0
    ? Math.min(100, (netWeightKg / grossWeightPerPart) * 100)
    : 0;

  const grossMaterialCost = grossWeightPerPart * materialPricePerKg;
  const scrapRecoveryCost = scrapWeightPerPart * scrapPricePerKg * scrapRecoveryPct;
  const netMaterialCost = Math.max(0, grossMaterialCost - scrapRecoveryCost);

  return {
    sheetLengthMm: sheetL,
    sheetWidthMm: sheetW,
    partsPerSheet: bestParts,
    sheetWeightKg: Math.round(sheetWeightKg * 1000) / 1000,
    grossWeightPerPartKg: Math.round(grossWeightPerPart * 1000) / 1000,
    scrapWeightPerPartKg: Math.round(scrapWeightPerPart * 1000) / 1000,
    utilisationPct: Math.round(utilisation * 10) / 10,
    grossMaterialCost: Math.round(grossMaterialCost * 100) / 100,
    scrapRecoveryCost: Math.round(scrapRecoveryCost * 100) / 100,
    netMaterialCost: Math.round(netMaterialCost * 100) / 100,
    partAllowanceMm: Math.round(partAllowanceMm * 100) / 100,
  };
}
