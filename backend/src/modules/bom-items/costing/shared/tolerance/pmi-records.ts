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
// A decoded value becomes usable ONLY by an explicit, recorded decision of an authorized engineer
// (pmi_record_reviews, migration 908), bound to the record's content fingerprint and the STEP file's hash:
//   awaiting_review  decoded, nobody has decided
//   approved         approved for exactly this content and this file; automation basis 'engineer_approved'
//   rejected         rejected; never usable
//   stale            a decision exists but the record or the file changed since: counts for nothing
//   verified         native semantic PMI (authoritative on its own)
//   conflict / unresolved   not reviewable: resolve the conflict or read the drawing first
// Each record is decided on its own; there is no blanket flag. A frame's datum references are a
// separate claim with their own decision.
//
// This module exposes them through the existing FeatureInstance model (joined on the engine's face
// ordinals) and re-checks everything itself, so neither a producer bug nor a stale row can promote a
// decoded value. It changes no costing formula: nothing here is read by cost, process selection or
// DFM rules yet.

import type { FeatureInstance } from './feature-tolerances';

export type PmiValidationStatus = 'verified' | 'decoded_cross_checked' | 'decoded_unverified' | 'conflict' | 'unresolved';

export interface PmiLimits {
  lowerMm: number;
  upperMm: number;
  minMm: number;
  maxMm: number;
}

export type PmiReviewState = 'verified' | 'awaiting_review' | 'approved' | 'rejected' | 'stale' | 'conflict' | 'unresolved';
export type PmiReviewScope = 'record' | 'datum_refs';
export const PMI_REVIEW_BASES = ['engineering_drawing', 'cad_model_pmi', 'customer_specification', 'other'] as const;
export type PmiReviewBasis = (typeof PMI_REVIEW_BASES)[number];

/** One decision in pmi_record_reviews. */
export interface PmiReviewRow {
  recordKey: string;
  scope: PmiReviewScope;
  decision: 'approved' | 'rejected';
  recordFingerprint: string;
  fileSha256: string;
  reviewerId: string;
  reviewerEmail: string | null;
  reviewedAt: string;
  approvedValues: Record<string, unknown>;
  decodedStatus: string;
  basis: PmiReviewBasis | string;
  notes: string | null;
  supersededAt: string | null;
}

/** Who may approve or reject: an active owner of the item organization (the only elevated role that exists). */
export function canReviewPmi(role: string | null | undefined): boolean {
  return role === 'owner';
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
  /** True for a verified native value, or a decoded value an authorized engineer approved for exactly this content. */
  automationReady: boolean;
  /** Why it is automation-ready: native semantic PMI, or an engineer's recorded approval. null when it is not. */
  automationBasis: 'native_pmi' | 'engineer_approved' | null;
  requiresReview: boolean;
  /** Content fingerprint (cad-engine record_fingerprint): what an approval is bound to. */
  fingerprint: string | null;
  datumRefsFingerprint: string | null;
  reviewState: PmiReviewState;
  /** The current decision on this record (even when stale), or null. */
  review: PmiReviewRow | null;
  /** The datum references of a frame are decided separately; null when the record has none to review. */
  datumRefsReviewState: PmiReviewState | null;
  datumRefsReview: PmiReviewRow | null;
  datumRefsAutomationReady: boolean;
  checks: string[];
  reasons: string[];
  cadFeature: string | null;
  unit: string;
  /** The text read off the drawn glyphs (decoded records), exactly as decoded. */
  decodedText: string | null;
  /** How clean the decode was: lowest glyph overlap and margin, glyphs set aside, orientation ambiguity. */
  glyphMatch: { minIou: number | null; minMargin: number | null; ignoredGlyphs: number; ambiguousOrientation: boolean } | null;
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

const DECODED = new Set(['decoded_cross_checked', 'decoded_unverified']);

/** The state of one claim given its stored decision: bound to the content AND the file, else stale. */
function stateOf(
  status: PmiValidationStatus, fingerprint: string | null, row: PmiReviewRow | undefined, fileSha256: string | null,
): PmiReviewState {
  if (status === 'verified') return 'verified';
  if (status === 'conflict') return 'conflict';
  if (status === 'unresolved') return 'unresolved';
  if (!row) return 'awaiting_review';
  const current = fingerprint !== null && fileSha256 !== null && row.recordFingerprint === fingerprint && row.fileSha256 === fileSha256;
  return current ? row.decision : 'stale';
}

/** One stored record, or null when it is malformed (it is dropped, never repaired). */
function toRecord(raw: any, rows: readonly PmiReviewRow[], fileSha256: string | null): PmiRecord | null {
  const status = raw?.validation?.status;
  const annotationRef = str(raw?.annotation_ref);
  const recordType = raw?.record_type;
  if (!annotationRef || !STATUSES.has(status) || !['dimension', 'gdt', 'datum'].includes(recordType)) return null;
  const source = raw.source === 'native_pmi' || raw.source === 'decoded_graphics' || raw.source === 'callout_label' ? raw.source : null;
  if (!source) return null;
  const id = str(raw.id) ?? `pmi:${annotationRef}`;
  const fingerprint = str(raw.fingerprint);
  const datumRefsFingerprint = str(raw.datum_refs_fingerprint);
  const review = rows.find((r) => r.recordKey === id && r.scope === 'record' && r.supersededAt === null) ?? null;
  const datumRefsReview = rows.find((r) => r.recordKey === `${id}#datum_refs` && r.scope === 'datum_refs' && r.supersededAt === null) ?? null;
  const reviewState = stateOf(status, fingerprint, review ?? undefined, fileSha256);
  // Defence in depth: native + verified (producer flag agreeing) is automation-ready; a decoded record only by a current approval.
  const nativeReady = status === 'verified' && source === 'native_pmi' && raw.validation?.automation_ready === true;
  const approved = DECODED.has(status) && source !== 'native_pmi' && reviewState === 'approved';
  const automationReady = nativeReady || approved;
  const hasDatumRefs = Array.isArray(raw.datum_refs) && raw.datum_refs_validation != null;
  const datumRefsReviewState: PmiReviewState | null = hasDatumRefs && status !== 'conflict' && status !== 'unresolved'
    ? stateOf('decoded_unverified', datumRefsFingerprint, datumRefsReview ?? undefined, fileSha256)
    : null;
  return {
    id,
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
    automationBasis: nativeReady ? 'native_pmi' : approved ? 'engineer_approved' : null,
    requiresReview: !automationReady,
    fingerprint,
    datumRefsFingerprint,
    reviewState,
    review,
    datumRefsReviewState,
    datumRefsReview,
    datumRefsAutomationReady: datumRefsReviewState === 'approved',
    checks: Array.isArray(raw.validation?.checks) ? raw.validation.checks.filter((c: unknown): c is string => typeof c === 'string') : [],
    reasons: Array.isArray(raw.validation?.reasons) ? raw.validation.reasons.filter((c: unknown): c is string => typeof c === 'string') : [],
    cadFeature: str(raw.cad_feature),
    unit: str(raw.nominal?.unit) ?? str(raw.zone?.unit) ?? 'mm',
    decodedText: str(raw.provenance?.decode?.text),
    glyphMatch: raw.provenance?.decode
      ? {
          minIou: num(raw.provenance.decode.min_glyph_iou), minMargin: num(raw.provenance.decode.min_glyph_margin),
          ignoredGlyphs: num(raw.provenance.decode.ignored_glyphs) ?? 0, ambiguousOrientation: raw.provenance.decode.ambiguous_orientation === true,
        }
      : null,
    faceIds: Array.isArray(raw.feature_ref?.face_ids) ? raw.feature_ref.face_ids.filter((f: unknown): f is number => Number.isInteger(f)) : [],
    association: str(raw.feature_ref?.association) ?? '',
  };
}

/** The STEP file hash the PMI was read from (engine pmi.source.file_sha256), or null on an older analysis. */
export function pmiFileSha256(featureGraph: unknown): string | null {
  const v = (featureGraph as { pmi?: { source?: { file_sha256?: unknown } } } | null)?.pmi?.source?.file_sha256;
  return typeof v === 'string' && v ? v : null;
}

/**
 * The part's PMI records (feature graph `pmi.records`); malformed ones are dropped. `reviews` are the
 * CURRENT (not superseded) decisions; without them every decoded record is awaiting review.
 */
export function resolvePmiRecords(featureGraph: unknown, reviews: readonly PmiReviewRow[] = []): PmiRecord[] {
  const raw = (featureGraph as { pmi?: { records?: unknown } } | null)?.pmi?.records;
  const file = pmiFileSha256(featureGraph);
  return Array.isArray(raw) ? raw.map((r) => toRecord(r, reviews, file)).filter((r): r is PmiRecord => r !== null) : [];
}

/** Records that may drive a decision: verified native values and engineer-approved decoded values, each with its basis. */
export function automationReadyRecords(records: readonly PmiRecord[]): PmiRecord[] {
  return records.filter((r) => r.automationReady);
}

export const nativeVerifiedRecords = (records: readonly PmiRecord[]) => records.filter((r) => r.automationBasis === 'native_pmi');
export const engineerApprovedRecords = (records: readonly PmiRecord[]) => records.filter((r) => r.automationBasis === 'engineer_approved');
export const recordsAwaitingReview = (records: readonly PmiRecord[]) => records.filter((r) => r.reviewState === 'awaiting_review');
/** Decided against, or decided for content that has since changed: unusable until reviewed again. */
export const recordsRejectedOrStale = (records: readonly PmiRecord[]) => records.filter((r) => r.reviewState === 'rejected' || r.reviewState === 'stale');
export const recordsConflictingOrUnresolved = (records: readonly PmiRecord[]) => records.filter((r) => r.reviewState === 'conflict' || r.reviewState === 'unresolved');

export type PmiReviewTarget =
  | { ok: true; record: PmiRecord; scope: PmiReviewScope; recordKey: string; fingerprint: string }
  | { ok: false; code: 'not_found' | 'not_reviewable' | 'no_source_fingerprint'; reason: string };

/**
 * What an approval or rejection would apply to, or why it cannot. The database function re-checks all of
 * this atomically; this gives a precise error before the write and is what the service and tests use.
 */
export function reviewTargetOf(featureGraph: unknown, recordKey: string, scope: PmiReviewScope): PmiReviewTarget {
  const id = scope === 'datum_refs' ? recordKey.replace(/#datum_refs$/, '') : recordKey;
  const record = resolvePmiRecords(featureGraph).find((r) => r.id === id);
  if (!record) return { ok: false, code: 'not_found', reason: `no PMI record ${id} on this part (re-analysed since?)` };
  if (pmiFileSha256(featureGraph) === null) {
    return { ok: false, code: 'no_source_fingerprint', reason: 'this analysis carries no source fingerprint: re-analyse the part before reviewing' };
  }
  if (scope === 'record') {
    if (!DECODED.has(record.status)) {
      return { ok: false, code: 'not_reviewable', reason: record.status === 'verified'
        ? 'a native verified record needs no review'
        : `a ${record.status} record cannot be approved: ${record.status === 'conflict' ? 'resolve the conflict first' : 'read the drawing and re-analyse first'}` };
    }
    if (!record.fingerprint) return { ok: false, code: 'not_reviewable', reason: 'the record has no content fingerprint: re-analyse the part' };
    return { ok: true, record, scope, recordKey: record.id, fingerprint: record.fingerprint };
  }
  if (record.datumRefsReviewState === null || !record.datumRefsFingerprint) {
    return { ok: false, code: 'not_reviewable', reason: 'this record has no datum references to review' };
  }
  return { ok: true, record, scope, recordKey: `${record.id}#datum_refs`, fingerprint: record.datumRefsFingerprint };
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
