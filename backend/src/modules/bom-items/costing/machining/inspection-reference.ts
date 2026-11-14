// The inspection of a machined part, from memory/Machining (staged in machining_reference_data at the machining source version):
//  - Special Inspection, "Feature Inspection" of each SimpleHole, MultiStepHole and RingedHole (operations_full__operations.csv);
//  - one analysis of the default inspection type (variables defaultInspectionType) per inspected part, its time from tblInspection;
//  - a share of the parts inspected (variables defaultInspectionSampleRatio, "Percentage inspection ratio");
//  - every part's final quality inspection (Bench Operation "Final Inspecting", variables defaultFinalInspectionTime, minutes).
// The reference does not say whether an analysis is per hole or per part; it is read as one analysis (one CMM program) per inspected
// part, which is the decision recorded with this change. Pure: the caller loads the rows; a value absent from them is named, never filled.

export const INSPECTION_VARIABLE_KEYS = ['defaultInspectionType', 'defaultInspectionSampleRatio', 'defaultFinalInspectionTime'] as const;
export const INSPECTION_TABLE = 'tblInspection';
/** The tblInspection column holding an analysis's time. */
export const INSPECTION_TIME_COLUMN = 'Time Per Analysis (s)';
/** The feature types the reference inspects (Special Inspection: Feature Inspection//<type>). */
export const INSPECTED_FEATURE_TYPES: ReadonlySet<string> = new Set(['SimpleHole', 'MultiStepHole', 'RingedHole']);

export interface InspectionReference {
  /** variables: defaultInspectionType (the tblInspection row Name). */
  inspectionType: string;
  /** tblInspection "Time Per Analysis (s)" of that type. */
  timePerAnalysisS: number;
  /** variables: defaultInspectionSampleRatio (share of parts inspected, 0..1). */
  sampleRatio: number;
  /** variables: defaultFinalInspectionTime (min, every part). */
  finalInspectionMin: number;
}

export function resolveInspectionReference(
  variables: ReadonlyArray<{ key: string; value: string | number | null }> | null | undefined,
  table: ReadonlyArray<Record<string, unknown>> | null | undefined,
): { reference: InspectionReference | null; missing: string[] } {
  const missing: string[] = [];
  const byKey = new Map((variables ?? []).map((v) => [v.key, v.value]));
  const inspectionType = String(byKey.get('defaultInspectionType') ?? '').trim();
  if (!inspectionType) missing.push('variables: defaultInspectionType');
  const number = (k: string, allowZero: boolean) => {
    const v = Number(byKey.get(k));
    if (!Number.isFinite(v) || v < 0 || (!allowZero && v === 0)) { missing.push(`variables: ${k}`); return NaN; }
    return v;
  };
  const sampleRatio = number('defaultInspectionSampleRatio', true);
  if (Number.isFinite(sampleRatio) && sampleRatio > 1) missing.push('variables: defaultInspectionSampleRatio (a share of the parts, at most 1)');
  const finalInspectionMin = number('defaultFinalInspectionTime', true);
  const row = inspectionType ? (table ?? []).find((r) => String(r['Name'] ?? '').trim().toLowerCase() === inspectionType.toLowerCase()) : undefined;
  const timePerAnalysisS = Number(row?.[INSPECTION_TIME_COLUMN]);
  if (inspectionType && !(Number.isFinite(timePerAnalysisS) && timePerAnalysisS > 0)) missing.push(`${INSPECTION_TABLE}: no "${INSPECTION_TIME_COLUMN}" for ${inspectionType}`);
  if (missing.length > 0) return { reference: null, missing };
  return { reference: { inspectionType: String(row!['Name']), timePerAnalysisS, sampleRatio, finalInspectionMin }, missing: [] };
}

/** The features the reference inspects, from the part's feature_graph_v2: every occurrence of a hole type it names. */
export function inspectedFeatures(features: ReadonlyArray<{ id: string; feature_type: string; occurrences?: readonly unknown[] }> | null | undefined) {
  return (features ?? []).filter((f) => INSPECTED_FEATURE_TYPES.has(f.feature_type));
}

/** Every occurrence the reference inspects, by feature and occurrence index: what the inspection line lists and lights. */
export function inspectedOccurrences(
  features: ReadonlyArray<{ id: string; feature_type: string; occurrences?: readonly unknown[] }> | null | undefined,
): Array<{ featureId: string; occurrenceIndex: number }> {
  return inspectedFeatures(features).flatMap((f) => (f.occurrences ?? []).map((_, occurrenceIndex) => ({ featureId: f.id, occurrenceIndex })));
}
