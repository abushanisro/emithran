'use client';

import React from 'react';
import { formatDimension, formatTolValue } from '@/lib/features/dimension-annotations';
import type { PmiLayout } from '@/lib/features/pmi-frames';
import { describeRecord, recordsNeedingReview, STATUS_LABEL, type PmiRecordView } from '@/lib/features/pmi-records';
import { PmiReviewList, type PmiReviewProps } from '@/components/viewer/pmi-review-list';
import { reviewableRecords } from '@/lib/features/pmi-review-ui';

/**
 * The PMI the STEP states but cannot place on the model: a tolerance or datum whose CAD feature
 * the file does not dimension (so no callout can be tied to it), and values that exist only as a
 * callout label. Each line says why it is here. Nothing in this panel is on the model by guess.
 */
/** "DistanceBetween2@Plane13(6)" -> "Distance Between": the CAD's own name for the callout. */
function callName(item: { label?: string | null | undefined; dimension_kind?: string | undefined }): string {
  const base = (item.label ?? '').split('@')[0]!.replace(/\d+$/, '');
  const words = base.replace(/([a-z])([A-Z])/g, '$1 $2');
  return words || item.dimension_kind || 'value';
}

export function PmiPanel({ layout, records, review, onSelectRecord }: {
  layout: PmiLayout;
  records?: readonly PmiRecordView[] | undefined;
  /** The reviewable records with their decisions and the caller's permission (from the backend); when given, the engineer review list replaces the read-only one. */
  review?: PmiReviewProps | undefined;
  onSelectRecord?: ((faceIds: number[]) => void) | undefined;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const frames = layout.frames.filter((f) => f.annotationId === null);
  const datums = layout.datums.filter((d) => d.annotationId === null);
  const readOnly = review ? [] : recordsNeedingReview(records);
  const toReview = review ? reviewableRecords(review.records).filter((r) => r.reviewState !== 'approved' && r.reviewState !== 'verified' || r.datumRefsReviewState === 'awaiting_review' || r.datumRefsReviewState === 'stale').length : readOnly.length;
  if (frames.length === 0 && datums.length === 0 && layout.labelOnly.length === 0 && readOnly.length === 0 && !(review && reviewableRecords(review.records).length)) return null;
  const row: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'baseline', lineHeight: '16px' };
  return (
    <div
      data-testid="pmi-panel"
      style={{
        position: 'absolute', left: 8, bottom: 8, zIndex: 30, maxWidth: 360, maxHeight: 220, overflow: 'auto',
        background: 'rgba(15,23,42,0.78)', color: '#2dd4bf', border: '1px solid #2dd4bf', borderRadius: 4,
        padding: '6px 8px', font: '11px/16px ui-monospace, SFMono-Regular, Menlo, monospace',
      }}
    >
      <button
        type="button" data-testid="pmi-panel-toggle" onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? 'Show the PMI list' : 'Hide the PMI list'}
        style={{ all: 'unset', cursor: 'pointer', fontWeight: 700, display: 'block', width: '100%' }}
      >
        {collapsed ? '▸' : '▾'} PMI in the file, not tied to a face{toReview ? ` · ${toReview} to review` : ''}
      </button>
      {!collapsed && <div style={{ marginTop: 2 }}>
      {frames.map((f) => (
        <div key={f.itemId} style={row} title={f.via}>
          <span>{f.symbol}</span><span>{formatTolValue(f.zoneMm)}</span>
          <span style={{ opacity: 0.8 }}>{f.cadFeature ?? ''}</span>
        </div>
      ))}
      {datums.map((d) => (
        <div key={d.itemId} style={row} title={d.via}>
          <span>[{d.letter}]</span><span style={{ opacity: 0.8 }}>datum {d.cadFeature ?? ''}</span>
        </div>
      ))}
      {layout.labelOnly.map((l) => (
        <div key={l.id} style={row} title="A value in the callout label only. The file stores no tolerance data for it; if the CAD drew one, it is in the PMI graphics view.">
          <span>{callName(l)} {formatDimension(l.nominal_mm ?? 0)}</span>
          <span style={{ opacity: 0.8 }}>label only: any tolerance is in the PMI graphics</span>
        </div>
      ))}
      {review && <PmiReviewList review={review} onSelectRecord={onSelectRecord ?? (() => undefined)} />}
      {readOnly.length > 0 && (
        <div data-testid="pmi-review" style={{ marginTop: 4, borderTop: '1px solid #2dd4bf', paddingTop: 3 }}>
          <div style={{ fontWeight: 700 }}>Needs review: not verified native PMI</div>
          {readOnly.map((r) => (
            <div key={r.annotation_ref} style={{ ...row, flexWrap: 'wrap' }} title={(r.validation.reasons ?? []).join(' · ')}>
              <span>{r.annotation_ref.split('@')[0]}</span>
              <span style={{ fontWeight: 700 }}>{describeRecord(r)}</span>
              <span style={{ opacity: 0.8 }}>{STATUS_LABEL[r.validation.status]}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ opacity: 0.65, marginTop: 2 }}>Datum references (A-B-C) are not stored as data in this STEP; see the PMI graphics view for what the CAD drew.</div>
      </div>}
    </div>
  );
}
