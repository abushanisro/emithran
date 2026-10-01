import { describe, it, expect } from 'vitest';
import { drawingCadConsistencyNodes } from '@/lib/features/drawing-cad-consistency-nodes';
import type { FactMismatch } from '@/lib/api/hooks/useBOMItems';

// Shaped as the backend emits them (costing/shared/physics/drawing-cad-consistency.ts).
const bendMismatch: FactMismatch = {
  fact: 'bendCount', label: 'Bend count', drawingValue: '3 bends', cadValue: '2 bends',
  status: 'mismatch', severity: 'critical',
  message: 'Bend count: drawing says 3 bends, the 3D model measures 2 bends — these should be the same part.',
  v2FeatureIds: ['f1', 'f2'],
};
const thicknessMatch: FactMismatch = {
  fact: 'sheetThicknessMm', label: 'Sheet thickness', drawingValue: '2.0 mm', cadValue: '2.0 mm',
  status: 'match', severity: 'warning',
  message: 'Sheet thickness: drawing (2.0 mm) and 3D model (2.0 mm) agree.',
};
const drawingOnly: FactMismatch = {
  fact: 'threadCount', label: 'Thread count', drawingValue: '2 threads', cadValue: '—',
  status: 'drawing_only', severity: 'info',
  message: 'Thread count: only the drawing has this (2 threads) — the 3D model carries no value.',
};

describe('drawingCadConsistencyNodes', () => {
  const [a, b, c] = drawingCadConsistencyNodes([bendMismatch, thicknessMatch, drawingOnly]);

  it('carries the real drawing/CAD values, status, severity and message straight through', () => {
    expect(a).toMatchObject({
      fact: 'bendCount', label: 'Bend count',
      drawingValue: '3 bends', cadValue: '2 bends',
      status: 'mismatch', severity: 'critical',
      message: bendMismatch.message,
    });
  });

  it('sets v2FeatureIds — the same highlight mechanism every other tree node uses — only when real CAD features exist', () => {
    expect(a!.v2FeatureIds).toEqual(['f1', 'f2']);
    expect(b!.v2FeatureIds).toBeUndefined();
    expect(c!.v2FeatureIds).toBeUndefined();
  });

  it('never fabricates a highlight for a drawing_only fact', () => {
    expect(c!.status).toBe('drawing_only');
    expect(c!.v2FeatureIds).toBeUndefined();
  });

  it('gives every node a stable, unique id derived from its fact', () => {
    const ids = drawingCadConsistencyNodes([bendMismatch, thicknessMatch, drawingOnly]).map((n) => n.id);
    expect(ids).toEqual(['dcc_bendCount_0', 'dcc_sheetThicknessMm_1', 'dcc_threadCount_2']);
  });
});
