'use client';

import React from 'react';
import {
  PMI_BASIS_LABEL, type PmiReviewBasis, type PmiReviewRequest, type PmiReviewState, type ReviewablePmiRecord,
} from '@/lib/api/hooks/usePmiReview';
import { actionState, claimsOf, decisionLine, rowState, SHORT_STATE, STATE_LABEL, reviewableRecords } from '@/lib/features/pmi-review-ui';
import { formatTolValue } from '@/lib/features/dimension-annotations';

/**
 * The engineer review list inside the PMI panel: every decoded value (and the decoded datum references of a
 * native frame) with what was read, what it is tied to, why it may be wrong, and the decision taken so far.
 * Selecting a row highlights the faces it is tied to. Approve and reject are offered to owners only; the
 * backend refuses everyone else and refuses a record that changed since it was opened.
 */
export interface PmiReviewProps {
  records: ReviewablePmiRecord[];
  canReview: boolean;
  role: string | null;
  bases: PmiReviewBasis[];
  saving: boolean;
  onReview: (request: PmiReviewRequest) => void;
}

const COLOR: Record<PmiReviewState, string> = {
  verified: '#2dd4bf', approved: '#4ade80', awaiting_review: '#fbbf24', stale: '#fb923c', rejected: '#f87171', conflict: '#f87171', unresolved: '#f87171',
};

const value = (r: ReviewablePmiRecord): string => {
  if (r.recordType === 'dimension') {
    if (r.nominalMm == null) return 'value not read';
    if (!r.limits) return `${formatTolValue(r.nominalMm)} ${r.unit} (no tolerance read)`;
    const tol = Math.abs(r.limits.upperMm + r.limits.lowerMm) < 1e-9 ? `±${formatTolValue(r.limits.upperMm)}` : `+${formatTolValue(r.limits.upperMm)}/${formatTolValue(r.limits.lowerMm)}`;
    return `${formatTolValue(r.nominalMm)} ${tol} ${r.unit}  →  ${formatTolValue(r.limits.minMm)} to ${formatTolValue(r.limits.maxMm)} ${r.unit}`;
  }
  if (r.recordType === 'gdt') return `${r.characteristic ?? 'gdt'} ${r.zoneMm != null ? formatTolValue(r.zoneMm) : '?'} ${r.unit}${r.datumRefs?.length ? `  datums ${r.datumRefs.join('-')}` : ''}`;
  return `datum ${r.datumLetter ?? '?'}`;
};

const cell: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap', lineHeight: '15px' };
const label: React.CSSProperties = { opacity: 0.65, minWidth: 74 };

export function PmiReviewList({ review, onSelectRecord }: { review: PmiReviewProps; onSelectRecord: (faceIds: number[]) => void }) {
  const [selected, setSelected] = React.useState<string | null>(null);
  const [basis, setBasis] = React.useState<PmiReviewBasis | ''>('');
  const [notes, setNotes] = React.useState('');
  const rows = reviewableRecords(review.records);
  if (rows.length === 0) return null;

  const choose = (r: ReviewablePmiRecord) => {
    const next = selected === r.id ? null : r.id;
    setSelected(next);
    setBasis('');
    setNotes('');
    onSelectRecord(next ? r.faceIds : []);
  };

  return (
    <div data-testid="pmi-review" style={{ marginTop: 4, borderTop: '1px solid #2dd4bf', paddingTop: 3 }}>
      <div style={{ fontWeight: 700 }}>
        Engineer review: values decoded from the drawing
        {!review.canReview && <span style={{ fontWeight: 400, opacity: 0.8 }}> (view only; owners approve)</span>}
      </div>
      {rows.map((r) => {
        const open = selected === r.id;
        const state = rowState(r);
        return (
          <div key={r.id} data-testid={`pmi-review-row`} style={{ marginTop: 2 }}>
            <button
              type="button" onClick={() => choose(r)} aria-expanded={open}
              style={{ all: 'unset', cursor: 'pointer', display: 'flex', gap: 6, width: '100%', alignItems: 'baseline' }}
            >
              <span>{open ? '▾' : '▸'}</span>
              <span style={{ flex: 1 }}>{r.annotationRef.split('@')[0]} <b>{value(r).split('  →')[0]}</b></span>
              <span data-testid="pmi-review-state" style={{ color: COLOR[state], fontWeight: 700 }}>{SHORT_STATE[state]}</span>
            </button>
            {open && (
              <div data-testid="pmi-review-detail" style={{ margin: '2px 0 4px 14px', paddingLeft: 6, borderLeft: `2px solid ${COLOR[state]}` }}>
                <div style={cell}><span style={label}>Annotation</span><span>{r.annotationRef}</span></div>
                <div style={cell}><span style={label}>Decoded text</span><span style={{ fontWeight: 700 }}>{r.decodedText ? `"${r.decodedText}"` : 'none'}</span></div>
                <div style={cell}><span style={label}>Value</span><span>{value(r)}</span></div>
                <div style={cell}><span style={label}>Source</span><span>{r.source.replace(/_/g, ' ')} · {r.status.replace(/_/g, ' ')}</span></div>
                <div style={cell}><span style={label}>Feature</span><span>{r.cadFeature ?? 'not named in the file'}</span></div>
                <div style={cell}>
                  <span style={label}>Faces</span>
                  <span>{r.faceIds.length ? `${r.faceIds.slice(0, 8).join(', ')}${r.faceIds.length > 8 ? ` +${r.faceIds.length - 8}` : ''} (highlighted)` : 'none: not tied to a model feature'}</span>
                </div>
                {r.association && <div style={{ ...cell, opacity: 0.75 }}><span style={label} />{r.association}</div>}
                {r.glyphMatch && (
                  <div style={cell}>
                    <span style={label}>Glyph match</span>
                    <span>overlap ≥ {r.glyphMatch.minIou ?? '?'}, margin ≥ {r.glyphMatch.minMargin ?? '?'}{r.glyphMatch.ignoredGlyphs ? `, ${r.glyphMatch.ignoredGlyphs} mark(s) set aside` : ''}{r.glyphMatch.ambiguousOrientation ? ', AMBIGUOUS orientation' : ''}</span>
                  </div>
                )}
                {r.reasons.map((x) => <div key={x} style={{ ...cell, color: '#fbbf24' }}><span style={label}>Note</span><span>{x}</span></div>)}
                {claimsOf(r).map((claim) => {
                  const action = actionState(claim, review.canReview, basis);
                  const line = decisionLine(claim);
                  return (
                    <div key={claim.scope} data-testid={`pmi-claim-${claim.scope}`} style={{ marginTop: 4, paddingTop: 3, borderTop: '1px dashed #2dd4bf66' }}>
                      <div style={{ fontWeight: 700 }}>{claim.title}: <span style={{ color: COLOR[claim.state] }}>{STATE_LABEL[claim.state]}</span></div>
                      {line && <div style={{ opacity: 0.85 }}>{line}</div>}
                      {claim.state !== 'verified' && (
                        <>
                          <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                            <select
                              data-testid="pmi-review-basis" value={basis} onChange={(e) => setBasis(e.target.value as PmiReviewBasis | '')}
                              style={{ background: '#0f172a', color: '#2dd4bf', border: '1px solid #2dd4bf', font: 'inherit' }}
                            >
                              <option value="">Source checked…</option>
                              {review.bases.map((b) => <option key={b} value={b}>{PMI_BASIS_LABEL[b] ?? b}</option>)}
                            </select>
                            <input
                              data-testid="pmi-review-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note (optional)" maxLength={2000}
                              style={{ flex: 1, minWidth: 90, background: '#0f172a', color: '#2dd4bf', border: '1px solid #2dd4bf', font: 'inherit' }}
                            />
                          </div>
                          <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
                            {(['approved', 'rejected'] as const).map((decision) => (
                              <button
                                key={decision} type="button" data-testid={decision === 'approved' ? 'pmi-review-approve' : 'pmi-review-reject'}
                                disabled={!action.canDecide || review.saving}
                                title={action.reason ?? (decision === 'approved' ? 'Approve exactly these values for this STEP file' : 'Reject these values')}
                                onClick={() => review.onReview({
                                  recordKey: claim.recordKey, scope: claim.scope, decision, recordFingerprint: claim.fingerprint!, basis: basis as PmiReviewBasis,
                                  ...(notes.trim() ? { notes: notes.trim() } : {}),
                                })}
                                style={{
                                  padding: '1px 8px', font: 'inherit', fontWeight: 700, cursor: action.canDecide ? 'pointer' : 'not-allowed',
                                  color: action.canDecide ? '#0f172a' : '#64748b', background: action.canDecide ? (decision === 'approved' ? '#4ade80' : '#f87171') : 'transparent',
                                  border: `1px solid ${action.canDecide ? 'transparent' : '#64748b'}`,
                                }}
                              >
                                {decision === 'approved' ? 'Approve' : 'Reject'}
                              </button>
                            ))}
                          </div>
                          {action.reason && <div data-testid="pmi-review-why" style={{ opacity: 0.8, marginTop: 2 }}>{action.reason}</div>}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
