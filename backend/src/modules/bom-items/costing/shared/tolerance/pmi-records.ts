// Typed PMI engineering records on the canonical feature model.
//
// The CAD engine (cad-engine shared/pmi_records.py) turns a STEP's PMI into one record per annotation:
//   native_pmi        dimensions with +/- bounds and geometric tolerances read from STEP entities:
//                     validation 'verified', the only values that may drive a decision;
//   decoded_graphics  text that exists only as drawn glyphs (a Width callout's tolerance, the datum
//                     references of a frame): flagged 'decoded_cross_checked' / 'decoded_unverified',
//                     never automation-ready until a person confirms them;
//   unresolved        the drawing could not be read: the original graphics stay the only source;
//   conflict          native and drawn values disagree: nothing is trusted automatically.
//
// This module exposes them through the existing FeatureInstance model (joined on the engine's face
// ordinals) and re-checks automation readiness itself, so a producer bug cannot promote a decoded value.
// It changes no costing formula: nothing here is read by cost, process selection or DFM rules yet.

import type { FeatureInstance } from './feature-tolerances';

export type PmiValidationStatus = 'verified' | 'decoded_cross_checked' | 'decoded_unverified' | 'conflict' | 'unresolved';

export interface PmiLimits {
  lowerMm: number;
  upperMm: number;
  minMm: number;
  maxMm: number;
}

export interface PmiRecord {
  id: string;
  /** The original annotation (callout name in the STEP), for traceability. */
  annotationRef: string;
  recordType: 'dimension' | 'gdt' | 'datum';
  /** diameter | radius | width | distance | curve_length | ... (dimensions). */
  dimensionType: string | null;
  /** position | flatness | ... (GD&T). */
  characteristic: string | null;
  nominalMm: number | null;
  limits: PmiLimits | null;
  basic: boolean;
  zoneMm: number | null;
  datumRefs: string[] | null;
  datumRefsSource: string | null;
  datumLetter: string | null;
  source: 'native_pmi' | 'decoded_graphics' | 'callout_label';
  status: PmiValidationStatus;
  /** True only for a verified native value: the one thing that may drive a decision. */
  automationReady: boolean;
  requiresReview: boolean;
  checks: string[];
  reasons: string[];
  cadFeature: string | null;
  /** Face ordinals the record's engine feature(s) cover (the join key to FeatureInstance.faceIds). */
  faceIds: number[];
  association: string;
}

const STATUSES: ReadonlySet<string> = new Set(['verified', 'decoded_cross_checked', 'decoded_unverified', 'conflict', 'unresolved']);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function limits(raw: any): PmiLimits | null {
  const [lower, upper, min, max] = [num(raw?.lower_mm), num(raw?.upper_mm), num(raw?.min_mm), num(raw?.max_mm)];
  return lower != null && upper != null && min != null && max != null && min <= max ? { lowerMm: lower, upperMm: upper, minMm: min, maxMm: max } : null;
}

/** One stored record, or null when it is malformed (it is dropped, never repaired). */
function toRecord(raw: any): PmiRecord | null {
  const status = raw?.validation?.status;
  const annotationRef = str(raw?.annotation_ref);
  const recordType = raw?.record_type;
  if (!annotationRef || !STATUSES.has(status) || !['dimension', 'gdt', 'datum'].includes(recordType)) return null;
  const source = raw.source === 'native_pmi' || raw.source === 'decoded_graphics' || raw.source === 'callout_label' ? raw.source : null;
  if (!source) return null;
  // Defence in depth: only a verified NATIVE record is automation-ready, whatever the producer says.
  const automationReady = status === 'verified' && source === 'native_pmi' && raw.validation?.automation_ready === true;
  return {
    id: str(raw.id) ?? `pmi:${annotationRef}`,
    annotationRef,
    recordType,
    dimensionType: str(raw.dimension_type),
    characteristic: str(raw.characteristic),
    nominalMm: num(raw.nominal?.value),
    limits: limits(raw.tolerance),
    basic: raw.basic === true,
    zoneMm: num(raw.zone?.value),
    datumRefs: Array.isArray(raw.datum_refs) ? raw.datum_refs.filter((d: unknown): d is string => typeof d === 'string') : null,
    datumRefsSource: str(raw.datum_refs_source),
    datumLetter: str(raw.letter),
    source,
    status,
    automationReady,
    requiresReview: !automationReady,
    checks: Array.isArray(raw.validation?.checks) ? raw.validation.checks.filter((c: unknown): c is string => typeof c === 'string') : [],
    reasons: Array.isArray(raw.validation?.reasons) ? raw.validation.reasons.filter((c: unknown): c is string => typeof c === 'string') : [],
    cadFeature: str(raw.cad_feature),
    faceIds: Array.isArray(raw.feature_ref?.face_ids) ? raw.feature_ref.face_ids.filter((f: unknown): f is number => Number.isInteger(f)) : [],
    association: str(raw.feature_ref?.association) ?? '',
  };
}

/** The part's PMI records (feature graph `pmi.records`); malformed ones are dropped. */
export function resolvePmiRecords(featureGraph: unknown): PmiRecord[] {
  const raw = (featureGraph as { pmi?: { records?: unknown } } | null)?.pmi?.records;
  return Array.isArray(raw) ? raw.map(toRecord).filter((r): r is PmiRecord => r !== null) : [];
}

/** Only records that may drive a decision: verified, native. */
export function automationReadyRecords(records: readonly PmiRecord[]): PmiRecord[] {
  return records.filter((r) => r.automationReady);
}

/**
 * The records that apply to one feature instance, joined on the face ordinals the engine's feature carried.
 * `automationOnly` (default true) keeps verified native values only; pass false to also receive decoded and
 * unresolved records, each flagged, for display and review.
 */
export function pmiRecordsForInstance(
  records: readonly PmiRecord[], instance: Pick<FeatureInstance, 'faceIds'>, options: { automationOnly?: boolean } = {},
): PmiRecord[] {
  const automationOnly = options.automationOnly ?? true;
  const faces = new Set(instance.faceIds);
  return records.filter((r) => (!automationOnly || r.automationReady) && r.faceIds.some((f) => faces.has(f)));
}

/** The tightest limits a feature's records state (max of lower, min of upper), or null. Flagged records are excluded unless asked for. */
export function pmiLimitsForInstance(
  records: readonly PmiRecord[], instance: Pick<FeatureInstance, 'faceIds'>, options: { automationOnly?: boolean } = {},
): PmiLimits | null {
  const withLimits = pmiRecordsForInstance(records, instance, options).filter((r) => r.limits !== null && r.recordType === 'dimension');
  if (withLimits.length === 0) return null;
  return withLimits.reduce<PmiLimits>((acc, r) => ({
    lowerMm: Math.max(acc.lowerMm, r.limits!.lowerMm),
    upperMm: Math.min(acc.upperMm, r.limits!.upperMm),
    minMm: Math.max(acc.minMm, r.limits!.minMm),
    maxMm: Math.min(acc.maxMm, r.limits!.maxMm),
  }), withLimits[0]!.limits!);
}
