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
}
