/**
 * Which CAD measurement a calculator input is filled from, for inputs the
 * dialog fills itself (the BOM autofill path, where no cost-engine seed names
 * the evidence). Same rule and table as the backend's costing/shared/
 * cad-evidence.ts, which test/lib/features/cad-evidence-fields.test.ts keeps
 * identical: an input is CAD evidence only when its value's shown source is
 * CAD extraction.
 */
const EVIDENCE_BY_FIELD: Readonly<Record<string, string>> = {
  'Cutting Length': 'cut_length',
  'Length Of Cut': 'cut_length',
  'Burr Edge Length': 'cut_length',
  'No Of Starts': 'pierce_count',
  'No Of Bends': 'bend_count',
  'Bending Line Length': 'bend_line_length',
  'Flat Pattern Area': 'flat_pattern_area',
};

export function cadEvidenceKeyFor(fieldName: string, source: string | undefined): string | undefined {
  if (!source || !/^CAD\b/i.test(source)) return undefined;
  return EVIDENCE_BY_FIELD[fieldName];
}

/** For the drift test only. */
export const CAD_EVIDENCE_BY_FIELD = EVIDENCE_BY_FIELD;
