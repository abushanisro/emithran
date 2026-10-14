import type { PmiReviewBasis, PmiReviewRow, PmiReviewScope, PmiReviewState, ReviewablePmiRecord } from '@/lib/api/hooks/usePmiReview';

/**
 * What the PMI review panel offers for each record, derived only from the record's review state and the
 * caller's permission as the BACKEND reported them. The backend and the database decide again on every
 * write; this only decides what the buttons say and when they are enabled.
 */

export interface ReviewClaim {
  /** 'record' for the decoded value itself, 'datum_refs' for the decoded datum references of a native frame. */
  scope: PmiReviewScope;
  /** The key the review is stored under. */
  recordKey: string;
  title: string;
  state: PmiReviewState;
  fingerprint: string | null;
  review: PmiReviewRow | null;
}

export const STATE_LABEL: Record<PmiReviewState, string> = {
  verified: 'Verified (native PMI)',
  awaiting_review: 'Awaiting review',
  approved: 'Approved by engineer',
  rejected: 'Rejected by engineer',
  stale: 'Stale: changed since the last decision, review again',
  conflict: 'Conflict: native and drawing disagree',
  unresolved: 'Unresolved: the drawing could not be read',
};

/** The things on a record an engineer can decide: its decoded value, and separately its decoded datum references. */
export function claimsOf(r: ReviewablePmiRecord): ReviewClaim[] {
  const claims: ReviewClaim[] = [];
  if (r.source !== 'native_pmi') {
    claims.push({ scope: 'record', recordKey: r.id, title: 'Decoded value', state: r.reviewState, fingerprint: r.fingerprint, review: r.review });
  }
  if (r.datumRefsReviewState !== null) {
    claims.push({
      scope: 'datum_refs', recordKey: `${r.id}#datum_refs`, title: `Datum references ${r.datumRefs?.join('-') ?? ''}`.trim(),
      state: r.datumRefsReviewState, fingerprint: r.datumRefsFingerprint, review: r.datumRefsReview,
    });
  }
  return claims;
}

/** Records that have something to review or a decision to show. */
export function reviewableRecords(records: readonly ReviewablePmiRecord[]): ReviewablePmiRecord[] {
  return records.filter((r) => claimsOf(r).length > 0);
}

export interface ActionState {
  canDecide: boolean;
  /** Why the buttons are disabled, or null when they are enabled. */
  reason: string | null;
}

export function actionState(claim: ReviewClaim, canReview: boolean, basis: PmiReviewBasis | ''): ActionState {
  if (!canReview) return { canDecide: false, reason: 'Only an organization owner can approve or reject.' };
  if (claim.state === 'verified') return { canDecide: false, reason: 'Native verified PMI needs no review.' };
  if (claim.state === 'conflict') return { canDecide: false, reason: 'Resolve the conflict at its source first: the native value and the drawing disagree.' };
  if (claim.state === 'unresolved') return { canDecide: false, reason: 'Read the drawing and re-analyse first: the callout could not be decoded.' };
  if (!claim.fingerprint) return { canDecide: false, reason: 'Re-analyse the part: this record has no content fingerprint.' };
  if (!basis) return { canDecide: false, reason: 'Choose the authoritative source you checked.' };
  return { canDecide: true, reason: null };
}

/** The sentence under a decided or stale claim. */
export function decisionLine(claim: ReviewClaim): string | null {
  const r = claim.review;
  if (!r) return null;
  const who = r.reviewerEmail ?? r.reviewerId;
  const when = new Date(r.reviewedAt).toLocaleString();
  const verb = r.decision === 'approved' ? 'Approved' : 'Rejected';
  const stale = claim.state === 'stale' ? ' (stale: the record or the STEP file changed since)' : '';
  return `${verb} by ${who} on ${when}, source checked: ${r.basis.replace(/_/g, ' ')}${r.notes ? `, note: ${r.notes}` : ''}${stale}`;
}

export const SHORT_STATE: Record<PmiReviewState, string> = {
  verified: 'native', awaiting_review: 'review', approved: 'approved', rejected: 'rejected', stale: 'stale', conflict: 'conflict', unresolved: 'unresolved',
};

/** The worst state among a record's claims, for the row badge (stale and conflict outrank approved). */
export function rowState(r: ReviewablePmiRecord): PmiReviewState {
  const order: PmiReviewState[] = ['conflict', 'unresolved', 'stale', 'rejected', 'awaiting_review', 'approved', 'verified'];
  const states = claimsOf(r).map((c) => c.state);
  return order.find((s) => states.includes(s)) ?? r.reviewState;
}
