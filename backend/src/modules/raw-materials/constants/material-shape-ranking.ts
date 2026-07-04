// Shared shape/product-form ranking by manufacturing family.
//
// Single source of truth used by BOTH the raw-materials list API (partFamily
// sort) and the BOM costing material lookup. Before this existed the costing
// lookup took the first ilike match regardless of form — a "6061-T6 Sheet" row
// could price a machined billet part (wrong ₹/kg AND wrong label on the UI).
//
// Rank semantics (lower = better):
//   0..n  — index in the family's preferred list
//   50    — shape on file but neither preferred nor discouraged
//   99    — no shape on file
//   100   — actively wrong form for the family (a sheet cannot be a billet)

export const FAMILY_PREFERRED_SHAPES: Record<string, string[]> = {
  sheet_metal:       ['sheets', 'coils', 'plates'],
  cnc_milled:        ['plates', 'blocks', 'bars', 'ingots'],
  cnc_turned:        ['bars', 'rods', 'tubes', 'profiles'],
  mill_turn:         ['bars', 'rods', 'tubes', 'profiles'],
  casting:           ['ingots'],
  forging:           ['bars', 'rods', 'ingots'],
  injection_moulded: ['granules', 'pellets'],
  stamping:          ['coils', 'sheets'],
};

export const FAMILY_DISCOURAGED_SHAPES: Record<string, string[]> = {
  cnc_milled:  ['sheets', 'coils'],
  cnc_turned:  ['sheets', 'coils', 'plates'],
  mill_turn:   ['sheets', 'coils', 'plates'],
  sheet_metal: ['bars', 'rods', 'blocks', 'ingots'],
};

export function shapeRankForFamily(shape: string | null | undefined, family: string): number {
  if (!shape) return 99;
  const s = shape.toLowerCase();
  if ((FAMILY_DISCOURAGED_SHAPES[family] ?? []).includes(s)) return 100;
  const idx = (FAMILY_PREFERRED_SHAPES[family] ?? []).indexOf(s);
  return idx === -1 ? 50 : idx;
}

export function isDiscouragedShapeForFamily(shape: string | null | undefined, family: string): boolean {
  return shapeRankForFamily(shape, family) === 100;
}
