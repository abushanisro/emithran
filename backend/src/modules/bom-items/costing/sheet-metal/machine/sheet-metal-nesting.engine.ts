// Pure function — no DB, no async. All inputs must be pre-resolved by the caller.

// Real per-process nesting part-to-part spacing (mm), by thickness — see
// sm_reference_data category='lookup_table', key prefix 'tblPartSpacing'
// (migration 518, closeout Plan Phase 3). Only the 3 machine classes this
// app actually has a registered cutting engine for are covered — Oxyfuel/
// Plasma have no cost engine here regardless of this data (see
// manufacturing-process-registry.ts).
//   fiber_laser: spacing == thickness, 1:1, capped at 50mm (every real data
//     point from 0.5mm to 50mm is exactly spacing=thickness; the source's
//     own 999mm row still reads 50mm, confirming the cap rather than
//     linear growth beyond it).
//   turret_punch / waterjet: FLAT spacing regardless of thickness (6.35mm /
//     5.08mm respectively, i.e. 1/4" and 0.2" — real tool/nozzle
//     clearances, not thickness-scaled).
export function resolveProcessPartSpacingMm(machineClass: string, thicknessMm: number): number {
  switch (machineClass) {
    case 'fiber_laser':
      return Math.min(thicknessMm, 50);
    case 'turret_punch':
      return 6.35;
    case 'waterjet':
      return 5.08;
    default:
      return Math.min(thicknessMm, 50); // no real data for this machine class -- laser's real curve is the closest disclosed default (see computePartAllowanceMm's own doc comment for why)
  }
}

// Standard stock sheet sizes (width × length mm), ascending by area. Shared
// by the rectangle-grid engine below AND true-nest-costing.engine.ts's
// true-shape candidate enumeration -- both must compare the SAME candidate
// set, or "which sheet sizes are even considered" could silently diverge
// between the fallback and primary costing paths.
export const STANDARD_SHEETS: ReadonlyArray<[number, number]> = [
  [1000, 2000],
  [1250, 2500],
  [1500, 3000],
  [2000, 4000],
  [2500, 5000],
];

export const EDGE_ALLOWANCE_MM = 2; // minimum clearance from sheet edge

// Part-to-part nesting allowance for Gross/Net Usage -- these calculators
// compute material utilisation BEFORE any cutting process is chosen (a part
// could still end up laser-cut, waterjet-cut, or turret-punched), so there
// is no real per-process identity to key spacing on here the way
// resolveProcessPartSpacingMm above can for an already-resolved cutting
// engine. Per an explicit product decision (2026-08-21, closeout Plan
// Phase 3), this now assumes laser cutting -- this app's dominant/default
// cutting method -- as a disclosed default rather than the previous
// generic shear-strength-based formula (itself a real, back-calculated
// "punch/draw cushion" spec value, but for a DIFFERENT physical process
// than what nesting spacing actually needs). If Gross/Net Usage ever gains
// a real "planned cutting process" input, this should key off
// resolveProcessPartSpacingMm(that process, thicknessMm) instead of always
// assuming laser.
export function computePartAllowanceMm(thicknessMm: number, hasImpressions = false): number {
  return resolveProcessPartSpacingMm('fiber_laser', thicknessMm) + (hasImpressions ? 10 : 0);
}

export interface TrueNestCostingCache {
  sheetWidthMm: number;
  sheetLengthMm: number;
  kerfMm: number;
  edgeMarginMm: number;
  partsPerSheet: number;
  utilizationPct: number;
  sheetWeightKg: number;
  grossWeightPerPartKg: number;
  cachedAt?: string;
}

// A cached true-shape-nest costing result (bom-items.service.ts's
// featureGraph.summary.trueNestCostingCache) is only valid for the kerf +
// edge margin it was computed with -- sheetWidthMm/sheetLengthMm are NOT
// part of the match criteria because sheet SELECTION is itself part of the
// cached computation (every viable candidate is compared, the best one
// wins and is stored) -- there is no external "which sheet" input to
// validate against here, unlike the old single-candidate design. Pulled out
// as a pure function so this correctness gate has real unit test coverage
// without mocking Supabase/cad-engine.
export function isTrueNestCostingCacheValid(
  cache: unknown,
  kerfMm: number,
  edgeMarginMm: number,
): cache is TrueNestCostingCache {
  if (!cache || typeof cache !== 'object') return false;
  const c = cache as Record<string, unknown>;
  const closeEnough = (a: unknown, b: number) => typeof a === 'number' && Math.abs(a - b) < 0.01;
  return (
    closeEnough(c.kerfMm, kerfMm) &&
    closeEnough(c.edgeMarginMm, edgeMarginMm) &&
    typeof c.sheetWidthMm === 'number' && c.sheetWidthMm > 0 &&
    typeof c.sheetLengthMm === 'number' && c.sheetLengthMm > 0 &&
    typeof c.partsPerSheet === 'number' && c.partsPerSheet > 0 &&
    typeof c.utilizationPct === 'number' &&
    typeof c.sheetWeightKg === 'number' && c.sheetWeightKg > 0 &&
    typeof c.grossWeightPerPartKg === 'number' && c.grossWeightPerPartKg > 0
  );
}

export interface NestingInput {
  flatPatternLengthMm: number;   // unfolded longest dimension
  flatPatternWidthMm: number;    // unfolded shorter dimension
  thicknessMm: number;
  netWeightKg: number;           // from CAD volume × density (already computed by caller)
  densityKgM3: number;
  materialPricePerKg: number;
  scrapPricePerKg?: number;      // recovery value (default 0)
  edgeAllowanceMm?: number;      // default 2
  scrapRecoveryPct?: number;     // fraction recovered (default 0.90)
  hasImpressions?: boolean;      // true for stamping (adds 10mm extra)
  // Real order/batch quantity being costed. Drives sheetsRequired/plannedParts/
  // excessPositions/actualBatchGrossMaterialKg only -- never guessed, and never
  // fed back into grossWeightPerPartKg (the theoretical per-position yield the
  // rest of the costing pipeline already prices material on). Omit or <= 0 to
  // skip batch-consumption computation entirely (all four outputs undefined).
  quantityRequired?: number;
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
  // Actual batch sheet consumption -- distinct from grossWeightPerPartKg
  // (theoretical per-position yield) above. Only populated when the caller
  // supplied a positive quantityRequired. Informational/disclosure only:
  // material cost (grossMaterialCost/netMaterialCost) is NOT derived from
  // these, and never should be without an explicit accounting-policy change.
  sheetsRequired?: number;             // ceil(quantityRequired / partsPerSheet)
  plannedParts?: number;               // partsPerSheet * sheetsRequired
  excessPositions?: number;            // plannedParts - quantityRequired
  actualBatchGrossMaterialKg?: number; // sheetsRequired * sheetWeightKg
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

// Utilization is ALWAYS this mass-based ratio -- Net Weight/Part ÷ Gross
// Weight/Part, per the reference costing algorithm (Sheet-Metal-Cost-Model-
// Algorithm.md §1.3) -- never a geometry-proxy percentage (e.g. a true-nest
// polygon's own area ratio, which does not necessarily subtract every
// internal cutout/window the same way the real CAD net-weight calculation
// does). Confirmed live: a frame-shaped part's true-nest polygon-area
// utilization reported 83.9% while its real mass-based utilization was
// 55.0% -- a costing-breaking discrepancy this shared function exists to
// make impossible to reintroduce by accident.
export function computeMassBasedUtilizationPct(netWeightKg: number, grossWeightPerPartKg: number): number {
  if (netWeightKg <= 0 || grossWeightPerPartKg <= 0) return 0;
  return Math.min(100, (netWeightKg / grossWeightPerPartKg) * 100);
}

export function computeNesting(input: NestingInput): NestingResult {
  const {
    flatPatternLengthMm,
    flatPatternWidthMm,
    thicknessMm,
    netWeightKg,
    densityKgM3,
    materialPricePerKg,
    scrapPricePerKg = 0,
    edgeAllowanceMm = EDGE_ALLOWANCE_MM,
    scrapRecoveryPct = 0.90,
    hasImpressions = false,
    quantityRequired,
  } = input;

  const partAllowanceMm = computePartAllowanceMm(thicknessMm, hasImpressions);

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
  const utilisation = computeMassBasedUtilizationPct(netWeightKg, grossWeightPerPart);

  const grossMaterialCost = grossWeightPerPart * materialPricePerKg;
  const scrapRecoveryCost = scrapWeightPerPart * scrapPricePerKg * scrapRecoveryPct;
  const netMaterialCost = Math.max(0, grossMaterialCost - scrapRecoveryCost);

  // Actual batch sheet consumption -- kept entirely separate from the
  // per-part figures above (see NestingResult doc comment). Never rounds
  // quantityRequired or bestParts, since these must land on exact integers.
  let sheetsRequired: number | undefined;
  let plannedParts: number | undefined;
  let excessPositions: number | undefined;
  let actualBatchGrossMaterialKg: number | undefined;
  if (typeof quantityRequired === 'number' && quantityRequired > 0) {
    sheetsRequired = Math.ceil(quantityRequired / bestParts);
    plannedParts = bestParts * sheetsRequired;
    excessPositions = plannedParts - quantityRequired;
    actualBatchGrossMaterialKg = Math.round(sheetsRequired * sheetWeightKg * 1000) / 1000;
  }

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
    sheetsRequired,
    plannedParts,
    excessPositions,
    actualBatchGrossMaterialKg,
  };
}
