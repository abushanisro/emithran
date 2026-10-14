import { describe, expect, it } from 'vitest';

import { describeRecord, recordsNeedingReview, widthRecordOfSlot, type PmiRecordView } from '@/lib/features/pmi-records';
import { buildDimensionAnnotations } from '@/lib/features/dimension-annotations';
import part from '../../fixtures/dimension-annotations/bspline-pmi.json';

// The typed records the engine produced for RMP-00015 (cad-engine shared/pmi_records.py).
const records = (part.pmi as any).records as PmiRecordView[];
const byRef = (name: string) => records.find((r) => r.annotation_ref === name)!;

describe('PMI records in the viewer', () => {
  it('states a value the way an engineer reads it, with the limits', () => {
    expect(describeRecord(byRef('Width2@Width1(15)'))).toBe('15 ±0.25 (14.75–15.25 mm)');
    expect(describeRecord(byRef('Radius1@Cylinder2(45.75)'))).toBe('45.75 ±0.15 (45.6–45.9 mm)');
    expect(describeRecord(byRef('Position1@Hole Pattern2'))).toBe('position 0.15 A-B-C');
    expect(describeRecord(byRef('Cylindricity1@Simple Hole1'))).toBe('cylindricity 0.015');
    expect(describeRecord(byRef('Datum451@Simple Hole1(C)'))).toBe('datum C');
  });

  it('the review list holds exactly what is not verified native PMI', () => {
    const review = recordsNeedingReview(records).map((r) => r.annotation_ref).sort();
    expect(review).toEqual(['DistanceBetween2@Plane13(6)', 'Perpendicularity1@Plane11', 'Width2@Width1(15)', 'Width4@Width3(15.04)'].sort());
    expect(recordsNeedingReview(records).every((r) => r.validation.status !== 'verified')).toBe(true);
  });

  it('nothing verified is on the review list, and a decoded record is never marked automation-ready', () => {
    for (const r of recordsNeedingReview(records)) expect(r.validation.automation_ready).toBe(false);
    expect(recordsNeedingReview(records).map((r) => r.annotation_ref)).not.toContain('Radius1@Cylinder2(45.75)');
  });

  it('finds the slot width by the engine faces the record carries', () => {
    const slot = buildDimensionAnnotations(part as any).find((a) => a.label === 'Slot 15 × 29')!;
    expect(widthRecordOfSlot(records, slot.faceIds)?.annotation_ref).toBe('Width2@Width1(15)');
    expect(widthRecordOfSlot(records, [999999])).toBeNull();
    expect(widthRecordOfSlot(undefined, slot.faceIds)).toBeNull();
  });

  it('a conflict and an unresolved callout are listed with their status', () => {
    const conflict = { annotation_ref: 'X@1', record_type: 'dimension', nominal: { value: 5 }, validation: { status: 'conflict', automation_ready: false, reasons: ['the drawn text disagrees'] } } as PmiRecordView;
    const unresolved = { annotation_ref: 'Y@1', record_type: 'dimension', validation: { status: 'unresolved', automation_ready: false } } as PmiRecordView;
    expect(recordsNeedingReview([conflict, unresolved]).map((r) => r.validation.status)).toEqual(['conflict', 'unresolved']);
    expect(describeRecord(unresolved)).toBe('value not read');
  });
});
