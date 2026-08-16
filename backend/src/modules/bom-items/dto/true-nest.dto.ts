// True (real polygon) 2D nesting placement -- visualization only. NOT a
// material-cost source; sheet-metal-nesting.engine.ts's rectangle-grid
// computeNesting() remains the sole source of truth for material cost,
// unchanged by this feature. See cad-engine/nesting.py's own module
// docstring for the full rationale.

export interface NestPlacementDto {
  xMm: number;
  yMm: number;
  rotationDeg: number;
}

export interface TrueNestResultDto {
  // Echoed request geometry -- the frontend renders THIS outline (not a
  // separate fetch), transformed per placement below.
  outlinePointsMm: number[][];
  holesMm: Array<{ cxMm: number; cyMm: number; diameterMm: number }>;
  outlineSource: 'wire_walk' | 'unavailable';

  sheetWidthMm: number;
  sheetLengthMm: number;
  partsPerSheet: number;
  // ONE sheet's worth of placements -- render as
  // `translate(xMm, yMm) rotate(rotationDeg)` applied to outlinePointsMm,
  // matching cad-engine/nesting.py's own return-shape doc comment.
  placements: NestPlacementDto[];
  // Geometric nest utilization from true polygon area (not bounding-rect-
  // derived) -- display-only, distinct from the existing rectangle-based
  // costing utilization shown elsewhere; never merge the two labels. This
  // reflects the heuristic BLF placement in this one result, NOT a
  // globally optimal packing -- label it "True-shape nest utilization" /
  // "Geometric nest utilization" in the UI, never "Real utilization" or
  // otherwise implied to be the best achievable for this part/sheet.
  utilizationPct: number;
  sheetsRequired: number | null;
  // True when cad-engine's evaluation budget was exhausted before the
  // sheet was confirmed full -- placements still reflect a real, valid
  // partial result, just possibly short of the sheet's true capacity.
  capped: boolean;
}
