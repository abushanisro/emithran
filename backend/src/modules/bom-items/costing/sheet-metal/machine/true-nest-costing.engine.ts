// Pure function — no DB, no async, no cad-engine call. All candidate
// results must be pre-resolved by the caller (bom-items.service.ts calls
// cad-engine's real true-shape nest once per viable standard sheet size,
// then hands the results here to pick the winner).
//
// This is a SEPARATE, explicit costing path from sheet-metal-nesting.engine.ts's
// rectangle-grid computeNesting() -- that engine remains the fallback ONLY
// (no real flat-pattern outline available yet, or true-shape nesting failed
// for every candidate below), never a pre-filter that eliminates candidates
// before true-shape nesting gets to evaluate them. Rectangle-grid ranking
// and true-shape ranking are NOT guaranteed to agree (a smaller sheet can
// genuinely interlock a concave/irregular part better than a larger one
// packs its bounding rectangle), so every viable candidate must be
// evaluated by its OWN true-shape result, never assumed equivalent to the
// rectangle-grid's ranking.

import { computeMassBasedUtilizationPct } from './sheet-metal-nesting.engine';

export interface TrueNestCandidate {
  sheetWidthMm: number;
  sheetLengthMm: number;
  // Real, non-overlapping placement count from cad-engine's true-shape nest
  // for THIS candidate sheet (nesting.py's compute_true_nest) -- 0/absent
  // candidates (part doesn't fit this sheet at any rotation, or cad-engine
  // declined) must be filtered out by the caller before calling
  // selectBestTrueNestCandidate, not passed in as 0.
  partsPerSheet: number;
  // sheetWidthMm * sheetLengthMm * thicknessMm / 1e9 * densityKgM3 -- same
  // formula computeNesting() itself uses, computed by the caller since this
  // module has no knowledge of thickness/density.
  sheetWeightKg: number;
}

export interface TrueNestCostingSelection {
  sheetWidthMm: number;
  sheetLengthMm: number;
  partsPerSheet: number;
  sheetWeightKg: number;
  grossWeightPerPartKg: number;
  utilisationPct: number;
}

// Selection rule: MIN(Input Wt/Part) across all candidate sheet sizes --
// laser_cutting_costing_params.md §6a, verbatim. Equivalently the candidate
// with the HIGHEST mass-based utilization (computeMassBasedUtilizationPct),
// since netWeightKg is fixed across all candidates for the same part.
// Utilization is always recomputed from real mass here -- never trust a
// true-nest polygon-area utilization percentage passed in some other way
// (see computeMassBasedUtilizationPct's own doc comment for why those can
// disagree with real net weight).
export function selectBestTrueNestCandidate(
  candidates: TrueNestCandidate[],
  netWeightKg: number,
): TrueNestCostingSelection | null {
  let best: TrueNestCostingSelection | null = null;
  for (const c of candidates) {
    if (c.partsPerSheet <= 0 || c.sheetWeightKg <= 0) continue;
    const grossWeightPerPartKg = c.sheetWeightKg / c.partsPerSheet;
    if (!best || grossWeightPerPartKg < best.grossWeightPerPartKg) {
      best = {
        sheetWidthMm: c.sheetWidthMm,
        sheetLengthMm: c.sheetLengthMm,
        partsPerSheet: c.partsPerSheet,
        sheetWeightKg: c.sheetWeightKg,
        grossWeightPerPartKg,
        utilisationPct: Math.round(computeMassBasedUtilizationPct(netWeightKg, grossWeightPerPartKg) * 10) / 10,
      };
    }
  }
  return best;
}

/**
 * A part cut from several blanks (one per solid body: a channel and its end plate), each nested on its own on the same
 * sheet. Every blank takes sheetWeight / (copies of it per sheet) of material, so one part takes the sum of those:
 *   grossWeightPerPart = sheetWeight x SUM(1 / partsPerSheet_b)
 * and one sheet holds floor(1 / SUM(1 / partsPerSheet_b)) whole sets. This is how a part whose blanks are cut as separate
 * nests is costed; nesting the blanks together (a tab dropped into another blank's skeleton) could only lower it.
 * Null when a blank does not fit the sheet, or a whole set needs more than one sheet (no honest parts-per-sheet).
 */
export function combineBlankNests(
  sheet: { sheetWidthMm: number; sheetLengthMm: number; sheetWeightKg: number },
  partsPerSheetPerBlank: number[],
  netWeightKg: number,
): TrueNestCostingSelection | null {
  if (partsPerSheetPerBlank.length === 0 || sheet.sheetWeightKg <= 0) return null;
  if (partsPerSheetPerBlank.some((n) => !(n > 0))) return null;
  const sheetsPerSet = partsPerSheetPerBlank.reduce((sum, n) => sum + 1 / n, 0);
  const setsPerSheet = Math.floor(1 / sheetsPerSet + 1e-9);
  if (setsPerSheet < 1) return null;
  const grossWeightPerPartKg = sheet.sheetWeightKg * sheetsPerSet;
  return {
    sheetWidthMm: sheet.sheetWidthMm,
    sheetLengthMm: sheet.sheetLengthMm,
    partsPerSheet: setsPerSheet,
    sheetWeightKg: sheet.sheetWeightKg,
    grossWeightPerPartKg,
    utilisationPct: Math.round(computeMassBasedUtilizationPct(netWeightKg, grossWeightPerPartKg) * 10) / 10,
  };
}
