import type { CalculationTraceStep, ConfidenceLevel } from './cost-breakdown.dto';

export interface BlankSpecDto {
  form: 'sheet' | 'round_bar' | 'hex_bar' | 'rectangular_bar' | 'billet' | 'extrusion' | 'casting' | 'granules';
  sizeLabel: string;
  grossWeightKg: number;
  netWeightKg: number;
  utilizationPct: number;
  wasteKg: number;
  wasteCost: number;
  // Sheet metal nesting only — which rectangle the parts-per-sheet packing
  // actually used. 'cad_flat_pattern_bounding_rect' = the true unfolded flat
  // pattern's own footprint (cad-engine's 2D unfold solver, directly measured
  // from CAD geometry — never an estimate, so 'verified' here means exactly
  // that, not "OEM-verified"). 'folded_3d_bounding_box' = the part's folded
  // envelope (maxLength/maxWidth), used only when the true flat-pattern
  // rectangle wasn't resolvable for this part -- a real, disclosed fallback,
  // not a silent substitution.
  nestingDimensionSource?: 'cad_flat_pattern_bounding_rect' | 'folded_3d_bounding_box';
  nestingDimensionConfidence?: 'verified' | 'fallback';
  // Theoretical per-position nesting basis for grossWeightKg above (which IS
  // the per-part yield -- sheetWeight / partsPerSheet -- the costing engine
  // prices material on). Only set when a real nesting result exists.
  sheetWidthMm?: number;
  sheetLengthMm?: number;
  partsPerSheet?: number;
  // The FULL physical stock-sheet weight (sheetWidthMm x sheetLengthMm x
  // thickness x density) -- a genuinely different quantity from grossWeightKg
  // above (which is already divided by partsPerSheet). Exposed explicitly so
  // callers never have to multiply grossWeightKg back out by partsPerSheet
  // (or worse, mistake grossWeightKg itself for the sheet's total weight --
  // confirmed live: a UI panel labeled "Sheet > Gross weight" displayed
  // grossWeightKg's per-part value with no full-sheet figure anywhere to
  // contrast it against, reading as a physically-impossible sheet weight).
  sheetWeightKg?: number;
  // Actual batch sheet consumption for the quantity this cost summary was
  // computed for -- a DIFFERENT concept from grossWeightKg above, not a
  // replacement for it. sheetsRequired sheets will, in practice, produce
  // plannedParts positions for a batch of only quantityRequired good parts,
  // leaving excessPositions unused/spare -- material cost is NOT derived
  // from these figures; they exist purely for disclosure. Never invent or
  // back-fill these when the real nesting engine didn't run.
  sheetsRequired?: number;
  plannedParts?: number;
  excessPositions?: number;
  actualBatchGrossMaterialKg?: number;
  // Which nesting engine actually decided sheetWidthMm/sheetLengthMm/
  // partsPerSheet/utilizationPct above -- 'true_shape' when a real flat-
  // pattern outline exists and cad-engine's true-shape nest succeeded for at
  // least one candidate standard sheet (compared across ALL viable
  // candidates by lowest gross weight/part, never rectangle-grid-prefiltered);
  // 'rectangle_grid_fallback' when no real outline exists yet, or true-shape
  // nesting failed for every candidate -- sheet-metal-nesting.engine.ts's
  // computeNesting() is the fallback source in that case. Never silent:
  // nestingFallbackReason is set whenever this is 'rectangle_grid_fallback'.
  nestingMethod?: 'true_shape' | 'rectangle_grid_fallback';
  nestingFallbackReason?: string;
  // Present only once the "Sheet Metal - Gross Material Usage (Nesting)"
  // calculator's process_calculator_mappings row is resolvable on this DB --
  // absent (never fabricated) until that migration is applied, in which
  // case grossWeightKg above still came from the same underlying
  // evaluation, just without this audit-trail metadata attached.
  calculatorId?: string;
  calculatorVersion?: number;
  calculationTrace?: CalculationTraceStep[];
  confidence?: ConfidenceLevel;
}
