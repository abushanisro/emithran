import { describe, expect, it } from 'vitest';

import type { ReviewablePmiRecord } from '@/lib/api/hooks/usePmiReview';
import { actionState, claimsOf, decisionLine, reviewableRecords, rowState } from '@/lib/features/pmi-review-ui';

const record = (over: Partial<ReviewablePmiRecord> = {}): ReviewablePmiRecord => ({
  id: 'r1', annotationRef: 'Width2@Width1(15)', recordType: 'dimension', dimensionType: 'width', characteristic: null,
  nominalMm: 15, unit: 'mm', limits: null, zoneMm: null, datumRefs: null, datumLetter: null,
  source: 'decoded_graphics', status: 'decoded_unverified', automationReady: false, automationBasis: null,
  checks: [], reasons: [], cadFeature: 'Width1', decodedText: '15.00 ±0.25', glyphMatch: null, faceIds: [3, 4],
  association: '', fingerprint: 'fp1', datumRefsFingerprint: null, reviewState: 'awaiting_review', review: null,
  datumRefsReviewState: null, datumRefsReview: null, datumRefsAutomationReady: false, ...over,
});

describe('PMI review claims', () => {
  it('a decoded record has one claim; a native record without decoded datum refs has none', () => {
    expect(claimsOf(record()).map((c) => c.scope)).toEqual(['record']);
    expect(claimsOf(record({ source: 'native_pmi', status: 'verified', reviewState: 'verified' }))).toEqual([]);
  });

  it('decoded datum references of a native frame are a separate claim under their own key', () => {
    const r = record({ source: 'native_pmi', recordType: 'gdt', datumRefs: ['A', 'B'], datumRefsReviewState: 'awaiting_review', datumRefsFingerprint: 'fp2' });
    const [claim] = claimsOf(r);
    expect(claim).toMatchObject({ scope: 'datum_refs', recordKey: 'r1#datum_refs', fingerprint: 'fp2' });
  });

  it('lists only records that have something to review', () => {
    const rows = reviewableRecords([record(), record({ id: 'n', source: 'native_pmi', reviewState: 'verified' })]);
    expect(rows.map((r) => r.id)).toEqual(['r1']);
  });
});

describe('PMI review actions', () => {
  const claim = () => claimsOf(record())[0]!;

  it('only an owner with a chosen source can decide', () => {
    expect(actionState(claim(), false, 'engineering_drawing').canDecide).toBe(false);
    expect(actionState(claim(), true, '').reason).toMatch(/source/i);
    expect(actionState(claim(), true, 'engineering_drawing')).toEqual({ canDecide: true, reason: null });
  });

  it.each(['conflict', 'unresolved', 'verified'] as const)('%s can never be approved', (state) => {
    const c = { ...claim(), state };
    expect(actionState(c, true, 'engineering_drawing').canDecide).toBe(false);
  });

  it('a record without a fingerprint cannot be decided', () => {
    expect(actionState({ ...claim(), fingerprint: null }, true, 'other').canDecide).toBe(false);
  });
});

describe('PMI review display', () => {
  const decided = {
    recordKey: 'r1', scope: 'record' as const, decision: 'approved' as const, recordFingerprint: 'fp1', fileSha256: 'x', reviewerId: 'u1',
    reviewerEmail: 'a@b.c', reviewedAt: '2026-10-15T10:00:00Z', approvedValues: {}, basis: 'engineering_drawing', notes: 'checked', supersededAt: null,
  };

  it('names the reviewer, the source and flags a stale decision', () => {
    const line = decisionLine({ ...claimsOf(record({ reviewState: 'stale', review: decided }))[0]! });
    expect(line).toContain('a@b.c');
    expect(line).toContain('engineering drawing');
    expect(line).toContain('stale');
  });

  it('the row badge shows the worst state of its claims', () => {
    const r = record({ source: 'native_pmi', reviewState: 'verified', datumRefsReviewState: 'stale', datumRefsFingerprint: 'f' });
    expect(rowState(r)).toBe('stale');
    expect(rowState(record({ reviewState: 'approved', review: decided }))).toBe('approved');
  });
});
