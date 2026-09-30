import { describe, it, expect } from 'vitest';
import { gdtCalloutNodes } from '@/lib/features/gdt-callout-nodes';
import type { GdtCallout } from '@/lib/api/hooks/useBOMItems';

// Shaped as the backend emits them (costing/shared/physics/gdt-callouts.ts).
const withFace: GdtCallout = {
  type: 'flatness', toleranceMm: 0.05, datum: '', confidence: null, source: 'step_pmi', faceIds: ['a1b2c3d4e5f6a7b8'],
};
const noFaceLink: GdtCallout = {
  type: 'position', toleranceMm: 0.1016, datum: 'A', confidence: null, source: 'step_pmi', faceIds: [],
};
const fromDrawing: GdtCallout = {
  type: 'perpendicularity', toleranceMm: 0.02, datum: 'A', confidence: 0.8, source: 'drawing', faceIds: [],
};
// Not in step_pmi.py's closed _SYMBOLS set — a drawing-parser type outside it.
const unknownSymbol: GdtCallout = {
  type: 'true_position', toleranceMm: 0.08, datum: '', confidence: null, source: 'drawing', faceIds: [],
};

describe('gdtCalloutNodes', () => {
  const [a, b, c, d] = gdtCalloutNodes('gdt_0', [withFace, noFaceLink, fromDrawing, unknownSymbol]);

  it('labels a callout with its symbol and tolerance, datum only when present', () => {
    expect(a!.label).toBe('Flatness ±0.05mm');
    expect(b!.label).toBe('Position ±0.1016mm (datum A)');
  });

  it('sets v2FeatureIds — the same highlight mechanism every other tree node uses — only when a real face link exists', () => {
    expect(a!.v2FeatureIds).toEqual(['a1b2c3d4e5f6a7b8']);
    expect(b!.v2FeatureIds).toBeUndefined();
  });

  it('a drawing-sourced callout never gets a highlight, even though it has a datum like a step_pmi one', () => {
    expect(fromDrawing.source).toBe('drawing');
    expect(c!.v2FeatureIds).toBeUndefined();
    expect(c!.attrs.find((x) => x.name === 'Highlight')!.value).toMatch(/drawing callout has no 3D face/);
  });

  it('explains why a step_pmi callout with no face link cannot be highlighted, distinctly from a drawing callout', () => {
    expect(b!.attrs.find((x) => x.name === 'Highlight')!.value).toMatch(/No face link for this callout in the model/);
  });

  it('title-cases a symbol outside the known set instead of showing it as raw snake_case', () => {
    expect(d!.label).toBe('True Position ±0.08mm');
  });

  it('carries source and confidence into the detail attrs, never inventing a confidence for a source that has none', () => {
    expect(a!.attrs.find((x) => x.name === 'Source')!.value).toBe('STEP model (semantic PMI)');
    expect(a!.attrs.some((x) => x.name === 'Confidence')).toBe(false);
    expect(c!.attrs.find((x) => x.name === 'Confidence')!.value).toBe('80%');
  });

  it('gives every node a stable, unique id under the given prefix', () => {
    const ids = gdtCalloutNodes('gdt_3', [withFace, noFaceLink]).map((n) => n.id);
    expect(ids).toEqual(['gdt_3_0', 'gdt_3_1']);
  });
});
