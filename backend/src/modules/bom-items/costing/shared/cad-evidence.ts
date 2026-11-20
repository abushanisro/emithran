/**
 * Which CAD measurement a calculator input's value was taken from, so the UI can
 * show the faces behind it. The keys are the contract with the CAD engine's
 * feature_graph_v2 (cut path -> `cut_length`, `measurements.*`, bend features)
 * and with lib/features/field-highlight.ts on the frontend.
 */
export const CAD_EVIDENCE_KEYS = [
  'cut_length',
  'pierce_count',
  'bend_count',
  'bend_line_length',
  'flat_pattern_area',
  'hole_diameters',
  // Plastic molding: the nominal wall (the antiparallel face pairs that voted for it) and the solid's volume (the whole body).
  'wall_thickness',
  'part_volume',
  // The part's whole surface (a casting's area for coating and blasting): every face.
  'part_surface',
  // A part measured along its die (or press) direction, a forging or a powder metal part (cad-engine forging/feature_extractor.py
  // die_measurements): the faces seen along it, those on the parting line, and those its depth and plan extents are measured between.
  'projected_area',
  'parting_perimeter',
  'die_depth',
  'plan_length',
  'plan_width',
  // A composite laminate (cad-engine composites/feature_extractor.py laminate_measurements): its tool side, trimmed edge, both skins, its
  // height along the layup direction and its footprint's length and width.
  'tool_area',
  'trim_length',
  'skin_area',
  'layup_height',
  'footprint_length',
  'footprint_width',
  // An additive build (cad-engine additive/feature_extractor.py), along its build direction.
  'build_height',
  'overhang_area',
  'support_volume',
  'plate_contact_area',
  // A bar, tube or profile (cad-engine bar_tube/feature_extractor.py): its centreline end to end and its cross-section.
  'developed_length',
  'section_area',
] as const;

export type CadEvidenceKey = (typeof CAD_EVIDENCE_KEYS)[number];

/** Calculator input -> the CAD quantity it is filled from. */
const EVIDENCE_BY_FIELD: Readonly<Record<string, CadEvidenceKey>> = {
  'Cutting Length': 'cut_length',
  'Length Of Cut': 'cut_length',
  'Burr Edge Length': 'cut_length',
  'No Of Starts': 'pierce_count',
  'No Of Bends': 'bend_count',
  'Bending Line Length': 'bend_line_length',
  'Flat Pattern Area': 'flat_pattern_area',
  'Punch Count': 'pierce_count',
  'Nibble Length': 'cut_length',
  'Tool Changes': 'hole_diameters',
  'Nominal Wall Thickness': 'wall_thickness',
  'Shot Melt Volume': 'part_volume',
  'Part Volume': 'part_volume',
};

/** "Nibble Length (mm)" -> "Nibble Length": live calculator fields carry their unit in the name. */
const withoutUnit = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, '').trim();

/**
 * The evidence key for an input step, or undefined. Requires the value's declared
 * source to be CAD extraction: a value entered by hand or read from a lookup
 * table is not "measured on these faces".
 */
export function cadEvidenceKey(fieldName: string, source: string | undefined): CadEvidenceKey | undefined {
  if (!source || !/^CAD\b/i.test(source)) return undefined;
  return EVIDENCE_BY_FIELD[fieldName] ?? EVIDENCE_BY_FIELD[withoutUnit(fieldName)];
}
