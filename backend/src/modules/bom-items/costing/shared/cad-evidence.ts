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
};

/**
 * The evidence key for an input step, or undefined. Requires the value's declared
 * source to be CAD extraction: a value entered by hand or read from a lookup
 * table is not "measured on these faces".
 */
export function cadEvidenceKey(fieldName: string, source: string | undefined): CadEvidenceKey | undefined {
  if (!source || !/^CAD\b/i.test(source)) return undefined;
  return EVIDENCE_BY_FIELD[fieldName];
}
