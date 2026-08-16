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
}
