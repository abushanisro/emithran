/**
 * Review semantics of decoded PMI values, on the REAL records the CAD engine produced for RMP-00015
 * (src/test/fixtures/rmp15-pmi-records.json, with the engine's content fingerprints and the STEP file hash).
 * Pure logic, no database: the database function enforcing the same rules is exercised in
 * test/pmi-review.e2e-spec.ts against the real database once migration 908 is applied.
 */
import * as fixture from '../../../../fixtures/rmp15-pmi-records.json';
import {
  automationReadyRecords, canReviewPmi, engineerApprovedRecords, nativeVerifiedRecords, pmiFileSha256,
  pmiRecordsForInstance, recordsAwaitingReview, recordsConflictingOrUnresolved, recordsRejectedOrStale,
  resolvePmiRecords, reviewTargetOf, type PmiReviewRow,
} from '../../../../../modules/bom-items/costing/shared/tolerance/pmi-records';
import { featureInstances } from '../../../../../modules/bom-items/costing/shared/tolerance/feature-tolerances';

const graph = fixture as any;
const FILE = pmiFileSha256(graph)!;
const clone = () => JSON.parse(JSON.stringify(graph));
const SLOT = 'pmi:Width2@Width1(15)';
const POSITION = 'pmi:Position1@Hole Pattern2';

const rec = (records: ReturnType<typeof resolvePmiRecords>, id: string) => records.find((r) => r.id === id)!;
const row = (over: Partial<PmiReviewRow> = {}): PmiReviewRow => {
  const base = resolvePmiRecords(graph).find((r) => r.id === SLOT)!;
  return {
    recordKey: SLOT, scope: 'record', decision: 'approved', recordFingerprint: base.fingerprint!, fileSha256: FILE,
    reviewerId: 'u-owner', reviewerEmail: 'owner@example.test', reviewedAt: '2026-10-15T10:00:00Z',
    approvedValues: { nominal_mm: 15, lower_mm: -0.25, upper_mm: 0.25, unit: 'mm' }, decodedStatus: base.status,
    basis: 'engineering_drawing', notes: null, supersededAt: null, ...over,
  };
};

describe('the real records carry what an approval is bound to', () => {
  it('every record has a content fingerprint and the analysis has the STEP file hash', () => {
    const records = resolvePmiRecords(graph);
    expect(FILE).toMatch(/^[0-9a-f]{64}$/);
    expect(records).toHaveLength(20);
    expect(records.every((r) => /^[0-9a-f]{64}$/.test(r.fingerprint ?? ''))).toBe(true);
    expect(new Set(records.map((r) => r.fingerprint)).size).toBe(20);
  });
});

describe('before any decision (backward compatible)', () => {
  const records = resolvePmiRecords(graph);

  it('native verified records are automation-ready with their basis; decoded ones are awaiting review and are not', () => {
    expect(rec(records, 'pmi:Radius1@Cylinder2(45.75)')).toMatchObject({ reviewState: 'verified', automationReady: true, automationBasis: 'native_pmi' });
    expect(rec(records, SLOT)).toMatchObject({ reviewState: 'awaiting_review', automationReady: false, automationBasis: null, requiresReview: true });
    expect(nativeVerifiedRecords(records).length).toBe(13);
    expect(engineerApprovedRecords(records)).toEqual([]);
    expect(recordsAwaitingReview(records).map((r) => r.status).every((s) => s.startsWith('decoded'))).toBe(true);
    expect(automationReadyRecords(records).every((r) => r.source === 'native_pmi')).toBe(true);
  });

  it('is identical to the call without a reviews argument', () => {
    expect(resolvePmiRecords(graph, [])).toEqual(records);
  });
});

describe('approval', () => {
  it('an approved decoded record becomes automation-ready, with basis "engineer_approved" and its decision attached', () => {
    const r = rec(resolvePmiRecords(graph, [row()]), SLOT);
    expect(r).toMatchObject({ reviewState: 'approved', automationReady: true, automationBasis: 'engineer_approved', requiresReview: false });
    expect(r.review).toMatchObject({ decision: 'approved', reviewerId: 'u-owner', basis: 'engineering_drawing' });
    expect(r.limits).toEqual({ lowerMm: -0.25, upperMm: 0.25, minMm: 14.75, maxMm: 15.25 }); // the values approved, with provenance intact
    expect(r.source).toBe('decoded_graphics');
  });

  it('is per record: approving the slot width makes no other decoded record ready', () => {
    const records = resolvePmiRecords(graph, [row()]);
    expect(engineerApprovedRecords(records).map((r) => r.id)).toEqual([SLOT]);
    expect(rec(records, 'pmi:Width4@Width3(15.04)').automationReady).toBe(false);
    expect(rec(records, 'pmi:Perpendicularity1@Plane11').automationReady).toBe(false);
  });

  it('is not a blanket flag: a row for another record key approves nothing here', () => {
    const records = resolvePmiRecords(graph, [row({ recordKey: 'pmi:Width4@Width3(15.04)' })]);
    expect(rec(records, SLOT).reviewState).toBe('awaiting_review');
  });

  it('the join to the canonical feature instance now offers the approved tolerance to automation', () => {
    const instances = featureInstances(graph.feature_graph_v2);
    const slot = instances.find((i) => i.faceIds.includes(118))!;
    const before = pmiRecordsForInstance(resolvePmiRecords(graph), slot);
    const after = pmiRecordsForInstance(resolvePmiRecords(graph, [row()]), slot);
    expect(before).toEqual([]);
    expect(after.map((r) => r.id)).toEqual([SLOT]);
  });
});

describe('rejection', () => {
  it('a rejected record is never usable and is reported as rejected', () => {
    const records = resolvePmiRecords(graph, [row({ decision: 'rejected' })]);
    expect(rec(records, SLOT)).toMatchObject({ reviewState: 'rejected', automationReady: false, automationBasis: null });
    expect(recordsRejectedOrStale(records).map((r) => r.id)).toEqual([SLOT]);
  });
});

describe('stale approvals', () => {
  it('an approval is stale when the record content changed since (nominal, tolerance, faces, decoded text)', () => {
    for (const mutate of [
      (r: any) => { r.nominal.value = 15.5; },
      (r: any) => { r.tolerance.upper_mm = 0.3; },
      (r: any) => { r.feature_ref.face_ids = [1, 2, 3]; },
    ]) {
      const g = clone();
      const raw = g.pmi.records.find((r: any) => r.id === SLOT);
      mutate(raw);
      raw.fingerprint = 'f'.repeat(64); // the engine recomputes the fingerprint of changed content
      const r = rec(resolvePmiRecords(g, [row()]), SLOT);
      expect(r.reviewState).toBe('stale');
      expect(r.automationReady).toBe(false);
      expect(r.review?.decision).toBe('approved'); // the old decision is kept for the audit view, but counts for nothing
    }
  });

  it('an approval is stale when the STEP file changed, even if the record content is identical', () => {
    const g = clone();
    g.pmi.source.file_sha256 = '0'.repeat(64);
    const r = rec(resolvePmiRecords(g, [row()]), SLOT);
    expect(r.reviewState).toBe('stale');
    expect(r.automationReady).toBe(false);
  });

  it('an analysis without a source fingerprint cannot honour any approval', () => {
    const g = clone();
    delete g.pmi.source;
    expect(rec(resolvePmiRecords(g, [row()]), SLOT).reviewState).toBe('stale');
  });

  it('a superseded decision is ignored: only the current one counts', () => {
    const records = resolvePmiRecords(graph, [row({ supersededAt: '2026-10-15T11:00:00Z' })]);
    expect(rec(records, SLOT).reviewState).toBe('awaiting_review');
  });

  it('a stale record is listed with the rejected ones as unusable until reviewed again', () => {
    const g = clone();
    g.pmi.source.file_sha256 = '1'.repeat(64);
    expect(recordsRejectedOrStale(resolvePmiRecords(g, [row()])).map((r) => r.id)).toEqual([SLOT]);
  });
});

describe('what may be reviewed', () => {
  it('a decoded record can be targeted, with the fingerprint the engineer must present', () => {
    const t = reviewTargetOf(graph, SLOT, 'record');
    expect(t.ok).toBe(true);
    if (t.ok) expect(t.fingerprint).toBe(rec(resolvePmiRecords(graph), SLOT).fingerprint);
  });

  it('a native verified record needs no review and cannot be approved', () => {
    const t = reviewTargetOf(graph, 'pmi:Radius1@Cylinder2(45.75)', 'record');
    expect(t).toMatchObject({ ok: false, code: 'not_reviewable' });
  });

  it('a conflicting record cannot be approved until the conflict is resolved', () => {
    const g = clone();
    const raw = g.pmi.records.find((r: any) => r.id === SLOT);
    raw.validation.status = 'conflict';
    const t = reviewTargetOf(g, SLOT, 'record');
    expect(t).toMatchObject({ ok: false, code: 'not_reviewable' });
    expect((t as any).reason).toMatch(/resolve the conflict/);
    expect(recordsConflictingOrUnresolved(resolvePmiRecords(g)).map((r) => r.id)).toContain(SLOT);
  });

  it('an unresolved record cannot be approved: the drawing has to be read first', () => {
    const g = clone();
    g.pmi.records.find((r: any) => r.id === SLOT).validation.status = 'unresolved';
    expect(reviewTargetOf(g, SLOT, 'record')).toMatchObject({ ok: false, code: 'not_reviewable' });
  });

  it('a conflicting or unresolved record stays so even if an old approval row exists', () => {
    const g = clone();
    g.pmi.records.find((r: any) => r.id === SLOT).validation.status = 'conflict';
    const r = rec(resolvePmiRecords(g, [row()]), SLOT);
    expect(r.reviewState).toBe('conflict');
    expect(r.automationReady).toBe(false);
  });

  it('an unknown record is not found, and an old analysis without a source fingerprint must be re-analysed first', () => {
    expect(reviewTargetOf(graph, 'pmi:Nothing@1', 'record')).toMatchObject({ ok: false, code: 'not_found' });
    const g = clone();
    delete g.pmi.source;
    expect(reviewTargetOf(g, SLOT, 'record')).toMatchObject({ ok: false, code: 'no_source_fingerprint' });
  });

  it('a record with no engine fingerprint (an older analysis) cannot be approved', () => {
    const g = clone();
    delete g.pmi.records.find((r: any) => r.id === SLOT).fingerprint;
    expect(reviewTargetOf(g, SLOT, 'record')).toMatchObject({ ok: false, code: 'not_reviewable' });
  });
});

describe('datum references are a separate claim', () => {
  const datumRow = (over: Partial<PmiReviewRow> = {}): PmiReviewRow => {
    const base = resolvePmiRecords(graph).find((r) => r.id === POSITION)!;
    return row({ recordKey: `${POSITION}#datum_refs`, scope: 'datum_refs', recordFingerprint: base.datumRefsFingerprint!, approvedValues: { datum_refs: ['A', 'B', 'C'], zone_mm: 0.15 }, ...over });
  };

  it('a native frame stays verified for its zone while its decoded datum references await review', () => {
    const r = rec(resolvePmiRecords(graph), POSITION);
    expect(r).toMatchObject({ reviewState: 'verified', automationReady: true, datumRefsReviewState: 'awaiting_review', datumRefsAutomationReady: false });
  });

  it('approving the datum references makes them usable without touching anything else', () => {
    const records = resolvePmiRecords(graph, [datumRow()]);
    const r = rec(records, POSITION);
    expect(r).toMatchObject({ datumRefsReviewState: 'approved', datumRefsAutomationReady: true, reviewState: 'verified' });
    expect(rec(records, 'pmi:Position2@Simple Hole8').datumRefsReviewState).toBe('awaiting_review');
  });

  it('they can be targeted separately, and a zone approval row does not approve them', () => {
    const t = reviewTargetOf(graph, POSITION, 'datum_refs');
    expect(t).toMatchObject({ ok: true, recordKey: `${POSITION}#datum_refs` });
    const wrongScope = datumRow({ recordKey: POSITION, scope: 'record' });
    expect(rec(resolvePmiRecords(graph, [wrongScope]), POSITION).datumRefsReviewState).toBe('awaiting_review');
  });

  it('a decoded datum approval goes stale when the references change', () => {
    const g = clone();
    const raw = g.pmi.records.find((r: any) => r.id === POSITION);
    raw.datum_refs = ['A', 'B'];
    raw.datum_refs_fingerprint = 'e'.repeat(64);
    expect(rec(resolvePmiRecords(g, [datumRow()]), POSITION).datumRefsReviewState).toBe('stale');
  });

  it('a record with no datum references has nothing to review', () => {
    expect(reviewTargetOf(graph, SLOT, 'datum_refs')).toMatchObject({ ok: false, code: 'not_reviewable' });
  });
});

describe('who may review', () => {
  it('only an owner of the organization', () => {
    expect(canReviewPmi('owner')).toBe(true);
    for (const role of ['member', 'viewer', 'admin', '', null, undefined]) expect(canReviewPmi(role as any)).toBe(false);
  });
});
