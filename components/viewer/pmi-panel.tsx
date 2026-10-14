'use client';

import React from 'react';
import { formatDimension, formatTolValue } from '@/lib/features/dimension-annotations';
import type { PmiLayout } from '@/lib/features/pmi-frames';

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

export function PmiPanel({ layout }: { layout: PmiLayout }) {
  const frames = layout.frames.filter((f) => f.annotationId === null);
  const datums = layout.datums.filter((d) => d.annotationId === null);
  if (frames.length === 0 && datums.length === 0 && layout.labelOnly.length === 0) return null;
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
      <div style={{ fontWeight: 700, marginBottom: 2 }}>PMI in the file, not tied to a face</div>
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
        <div key={l.id} style={row} title="A value in the callout label only; the file stores no tolerance for it.">
          <span>{callName(l)} {formatDimension(l.nominal_mm ?? 0)}</span>
          <span style={{ opacity: 0.8 }}>label only, no tolerance stored</span>
        </div>
      ))}
      <div style={{ opacity: 0.65, marginTop: 2 }}>Datum references (A-B-C) are not stored in this STEP.</div>
    </div>
  );
}
