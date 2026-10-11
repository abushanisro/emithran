// Pure function — no DB, no async. All inputs must be pre-resolved by the caller.

// Nesting part-to-part spacing (mm) by process and thickness, from the staged
// tblPartSpacing table (sm_reference_data lookup_table 'tblPartSpacing:*',
// migration 518; memory/Sheetmetal/lookuptable/..._tblPartSpacing.csv).
// Six processes: Fiber Laser and Laser Cut (1x thickness, capped at 50),
// Oxyfuel Cut (3x, capped at 225), Plasma Cut (2x, capped at 100), Turret
// Press (flat 6.35) and Waterjet Cut (flat 5.08). The caller loads the rows.
//
// Each row's thickness is the upper bound of its bracket (the 999 row is the
// catch-all), so a thickness takes the first row at or above it: never a
// spacing tighter than the table gives for that thickness.
export interface PartSpacingRow {
  process: string;
  thicknessMm: number;
  spacingMm: number;
}

/** null = the table has no row for this process (or no rows at all). */
export function resolvePartSpacingMm(
  rows: readonly PartSpacingRow[] | null | undefined,
  process: string,
  thicknessMm: number,
): number | null {
  const own = (rows ?? []).filter((r) => r.process === process).sort((a, b) => a.thicknessMm - b.thicknessMm);
  if (own.length === 0) return null;
  const row = own.find((r) => r.thicknessMm >= thicknessMm) ?? own[own.length - 1]!;
  return row.spacingMm;
}

// The stock sheet a part is nested on is no longer a fixed list here: it is
// the selected laser's nominal sheet (machine library), else the reference
// standard sheet (standardSheetWidth/Length) — see
// BOMItemsService.resolveNestingSheet. The rectangle-grid and true-shape
// paths both receive that same sheet, so they can never consider different
// sizes.
export interface NestingSheet { widthMm: number; lengthMm: number }

// Edge allowance (mm): the Sheet Metal Calculators' own default
// (memory/Sheetmetal/Sheet_Metal_Calculators.md, "Edge Allowance (mm) 2").
export const EDGE_ALLOWANCE_MM = 2;

// Gross/Net Usage computes material utilisation BEFORE a cutting process is
// chosen, so it nests at the spacing of the default cutting process, Fiber
// Laser (product decision 2026-08-21, closeout Plan Phase 3). Its spacing now
// comes from tblPartSpacing like every other process; a route-specific nest
// (Oxyfuel 3x, Plasma 2x, ...) needs material usage computed per route.
export const GROSS_USAGE_SPACING_PROCESS = 'Fiber Laser';

/** Part allowance for Gross/Net Usage, or null when tblPartSpacing has no row. */
export function computePartAllowanceMm(
  spacingRows: readonly PartSpacingRow[] | null | undefined,
  thicknessMm: number,
): number | null {
  return resolvePartSpacingMm(spacingRows, GROSS_USAGE_SPACING_PROCESS, thicknessMm);
}

interface TrueNestCostingCache {
  sheetWidthMm: number;
  sheetLengthMm: number;
  kerfMm: number;
  edgeMarginMm: number;
  partsPerSheet: number;
  utilizationPct: number;
  sheetWeightKg: number;
  grossWeightPerPartKg: number;
  cachedAt?: string;
  /** The geometry this result was computed from — see trueNestInputFingerprint. */
  inputFingerprint?: string;
}

/**
 * A stable fingerprint of every real input a true-shape nest result depends on.
 *
 * WHY THIS EXISTS
 *
 * The cache used to be validated on kerf and edge margin alone. That was only
 * safe because Reanalyze rebuilds featureGraph.summary as a fresh object and
 * therefore silently DESTROYED the cache — so a geometry change could never
 * reuse a stale result, but neither could an identical re-analysis reuse a
 * perfectly valid one. Since an uncached resolve walked every candidate sheet
 * sequentially against cad-engine's single-threaded /nest endpoint (13-30s per
 * sheet on real parts), that made every Reanalyze cost 65-150s on the next
 * cost-summary AND again on the next route-comparison, which is what timed the
 * page out.
 *
 * Carrying the cache across Reanalyze is only correct if validity is tied to
 * the geometry rather than to the accident of the summary being rewritten.
 * This fingerprint is that tie: outline, holes, thickness, density and net
 * weight are exactly the inputs resolveTrueShapeNestCosting feeds to /nest and
 * to selectBestTrueNestCandidate. Same geometry -> same fingerprint -> reuse.
 * Any real geometry change -> different fingerprint -> recompute.
 *
 * Coordinates are rounded to 0.01 mm before hashing so floating-point noise
 * from an identical re-extraction does not invalidate a valid cache, while a
 * real change of a hundredth of a millimetre still does.
 */
export function trueNestInputFingerprint(input: {
  outlinePointsMm: unknown;
  holesMm: unknown;
  thicknessMm: number;
  densityKgM3: number;
  netWeightKg: number;
}): string {
  const r2 = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (typeof v === 'number') return r2(v);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      // Key order is not guaranteed across re-extraction, so sort it.
      return Object.keys(o).sort().map((k) => [k, norm(o[k])]);
    }
    return v ?? null;
  };

  const payload = JSON.stringify([
    norm(input.outlinePointsMm),
    norm(input.holesMm),
    r2(input.thicknessMm),
    r2(input.densityKgM3),
    // Net weight moves gross weight per part directly, and it is derived from
    // CAD volume, so a volume change must invalidate the cache too.
    typeof input.netWeightKg === 'number' ? Math.round(input.netWeightKg * 1e6) / 1e6 : null,
  ]);

  // FNV-1a — deterministic, dependency-free, and this is a cache key, not a
  // security boundary.
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16)}-${payload.length.toString(16)}`;
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
  inputFingerprint?: string,
  sheet?: NestingSheet,
): cache is TrueNestCostingCache {
  if (!cache || typeof cache !== 'object') return false;
  const c = cache as Record<string, unknown>;
  const closeEnough = (a: unknown, b: number) => typeof a === 'number' && Math.abs(a - b) < 0.01;
  // The cache now survives Reanalyze, so geometry is what makes it valid — a
  // cache written before fingerprinting existed, or one written from different
  // geometry, is refused rather than silently reused at the old parts-per-sheet.
  if (inputFingerprint !== undefined && c.inputFingerprint !== inputFingerprint) return false;
  // A nest on a different stock sheet (e.g. the selected laser changed) is
  // a different result.
  if (sheet && !(closeEnough(c.sheetWidthMm, sheet.widthMm) && closeEnough(c.sheetLengthMm, sheet.lengthMm))) return false;
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

interface NestingInput {
  flatPatternLengthMm: number;   // unfolded longest dimension
  flatPatternWidthMm: number;    // unfolded shorter dimension
  thicknessMm: number;
  netWeightKg: number;           // from CAD volume × density (already computed by caller)
  densityKgM3: number;
  materialPricePerKg: number;
  scrapPricePerKg?: number;      // recovery value (default 0)
  edgeAllowanceMm?: number;      // default 2
  scrapRecoveryPct?: number;     // fraction recovered (default 0.90)
  // Real order/batch quantity being costed. Drives sheetsRequired/plannedParts/
  // excessPositions/actualBatchGrossMaterialKg only -- never guessed, and never
  // fed back into grossWeightPerPartKg (the theoretical per-position yield the
  // rest of the costing pipeline already prices material on). Omit or <= 0 to
  // skip batch-consumption computation entirely (all four outputs undefined).
  quantityRequired?: number;
  /** Part-to-part allowance (mm), from computePartAllowanceMm. */
  partAllowanceMm: number;
  /** Stock sheet(s) to nest on — see NestingSheet. */
  sheets: readonly NestingSheet[];
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

interface NestingDimensionResolution {
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
    quantityRequired,
    partAllowanceMm,
    sheets,
  } = input;

  const usablePartL = flatPatternLengthMm + partAllowanceMm;
  const usablePartW = flatPatternWidthMm + partAllowanceMm;

  let bestParts = 0;
  const last = sheets[sheets.length - 1]!;
  let bestSheet: [number, number] = [last.widthMm, last.lengthMm];

  for (const { widthMm: w, lengthMm: l } of sheets) {
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
