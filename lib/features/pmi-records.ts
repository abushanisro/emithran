/**
 * The typed PMI engineering records the CAD engine produced for a part (pmi.records, cad-engine
 * shared/pmi_records.py), as the viewer shows them.
 *
 * Native values are authoritative ('verified'); a value decoded from the drawn glyphs is shown with its
 * status and a review flag and is never presented as authoritative; a conflict or unresolved callout is
 * listed with its reason. Nothing here decides anything: it only states what each record is.
 */

export type PmiRecordStatus = 'verified' | 'decoded_cross_checked' | 'decoded_unverified' | 'conflict' | 'unresolved';

export interface PmiRecordView {
  annotation_ref: string;
  record_type: 'dimension' | 'gdt' | 'datum';
  dimension_type?: string | null | undefined;
  characteristic?: string | null | undefined;
  nominal?: { value?: number | null | undefined } | null | undefined;
  tolerance?: { lower_mm: number; upper_mm: number; min_mm: number; max_mm: number } | null | undefined;
  zone?: { value?: number | null | undefined } | null | undefined;
  datum_refs?: readonly string[] | null | undefined;
  letter?: string | null | undefined;
  source?: string | undefined;
  validation: {
    status: PmiRecordStatus;
    automation_ready?: boolean | undefined;
    reasons?: readonly string[] | undefined;
  };
  feature_ref?: { face_ids?: readonly number[] | undefined } | null | undefined;
}

const trim = (n: number) => String(Number(n.toFixed(4)));

export const STATUS_LABEL: Record<PmiRecordStatus, string> = {
  verified: 'verified (native PMI)',
  decoded_cross_checked: 'decoded from drawing, cross-checked: review',
  decoded_unverified: 'decoded from drawing, unverified: review',
  conflict: 'conflict: native and drawing disagree',
  unresolved: 'unresolved: see the drawing',
};

/** "15 ±0.25 (14.75–15.25 mm)" / "⌖ 0.15 A-B-C" / "datum A": the value a record states. */
export function describeRecord(r: PmiRecordView): string {
  if (r.record_type === 'dimension') {
    const n = r.nominal?.value;
    if (n == null) return 'value not read';
    const t = r.tolerance;
    if (!t) return `${trim(n)}${r.dimension_type === 'width' ? '' : ''} (no tolerance read)`;
    const tol = Math.abs(t.upper_mm + t.lower_mm) < 1e-9 ? `±${trim(t.upper_mm)}` : `+${trim(t.upper_mm)}/${trim(t.lower_mm)}`;
    return `${trim(n)} ${tol} (${trim(t.min_mm)}–${trim(t.max_mm)} mm)`;
  }
  if (r.record_type === 'gdt') {
    const z = r.zone?.value;
    return `${r.characteristic ?? 'gdt'} ${z != null ? trim(z) : '?'}${r.datum_refs?.length ? ` ${r.datum_refs.join('-')}` : ''}`;
  }
  return `datum ${r.letter ?? '?'}`;
}

/** The records that still need a person: everything that is not a verified native value, except cross-checked datum letters. */
export function recordsNeedingReview(records: readonly PmiRecordView[] | null | undefined): PmiRecordView[] {
  return (records ?? []).filter((r) => r.validation.status !== 'verified' && !(r.record_type === 'datum' && r.validation.status === 'decoded_cross_checked'));
}

/** The width record of a slot: a record of type width whose engine faces overlap the slot's. */
export function widthRecordOfSlot(records: readonly PmiRecordView[] | null | undefined, slotFaceIds: readonly number[]): PmiRecordView | null {
  const faces = new Set(slotFaceIds);
  return (records ?? []).find((r) => r.record_type === 'dimension' && r.dimension_type === 'width'
    && (r.feature_ref?.face_ids ?? []).some((f) => faces.has(f))) ?? null;
}
