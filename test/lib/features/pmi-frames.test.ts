import { describe, expect, it } from 'vitest';

import { buildDimensionAnnotations } from '@/lib/features/dimension-annotations';
import { gdtSymbol, layoutPmi, type PmiItem } from '@/lib/features/pmi-frames';
import part from '../../fixtures/dimension-annotations/bspline-pmi.json';

// RMP-00015: a B-spline STEP with AP242 PMI. Real machining features and the PMI the engine read.
const annotations = buildDimensionAnnotations(part as any);
const items = (part.pmi as any).items as PmiItem[];
const layout = layoutPmi(items, annotations);
const frame = (feature: string) => layout.frames.find((f) => f.cadFeature === feature)!;
const labelOf = (id: string | null) => annotations.find((a) => a.id === id)?.label;

describe('PMI frames on the real part', () => {
  it('reads all four semantic geometric tolerances', () => {
    expect(layout.frames.map((f) => [f.type, f.zoneMm]).sort()).toEqual(
      [['cylindricity', 0.015], ['flatness', 0.25], ['position', 0.05], ['position', 0.15]].sort(),
    );
  });

  it('the hole-pattern position tolerance is placed on the 4x Ø5.5 holes through the name the file writes', () => {
    const f = frame('Hole Pattern2');
    expect(f.zoneMm).toBe(0.15);
    expect(labelOf(f.annotationId)).toBe('4× Ø5.5 ±0.15');
    expect(f.via).toMatch(/CAD feature name "Hole Pattern2"/);
  });

  it('the cylindricity tolerance and datum C land on the Ø26.5 hole', () => {
    expect(labelOf(frame('Simple Hole1').annotationId)).toBe('Ø26.5 ±0.25');
    const c = layout.datums.find((d) => d.letter === 'C')!;
    expect(labelOf(c.annotationId)).toBe('Ø26.5 ±0.25');
  });

  it('what the file does not tie to a dimensioned feature stays unanchored, with the reason', () => {
    const flat = frame('Plane10');
    expect(flat.annotationId).toBeNull();
    expect(flat.via).toMatch(/no radius or diameter dimension/);
    const pos = frame('Simple Hole8');
    expect(pos.annotationId).toBeNull();
    expect(layout.datums.filter((d) => d.annotationId === null).map((d) => d.letter).sort()).toEqual(['A', 'B']);
  });

  it('no frame carries a datum reference: the file stores none', () => {
    for (const f of layout.frames) expect(f.datumRefs).toEqual([]);
  });

  it('the slot width labels are reported as label-only, with no tolerance', () => {
    const widths = layout.labelOnly.filter((i) => i.dimension_kind === 'width');
    expect(widths.map((w) => w.nominal_mm).sort()).toEqual([15, 15.04]);
    for (const w of widths) expect(w.lower_mm).toBeUndefined();
  });
});

describe('PMI frame rules', () => {
  const callouts = [{ id: 'd8-f1', kind: 'diameter', valueMm: 8, label: 'Ø8', faceIds: [1], count: 1, instances: [[1]], tolerance: null, featureType: 'SimpleHole' }] as any;
  const dim = (feature: string, nominal: number, kind = 'diameter'): PmiItem => ({ id: `d:${feature}:${nominal}`, kind: 'dimension', cad_feature: feature, dimension_kind: kind, nominal_mm: nominal });
  const geo = (feature: string): PmiItem => ({ id: `g:${feature}`, kind: 'geometric', type: 'position', zone_mm: 0.1, cad_feature: feature });

  it('a feature dimensioned twice to different sizes that both exist is ambiguous', () => {
    const two = [...callouts, { ...callouts[0], id: 'd9-f2', valueMm: 9, label: 'Ø9' }];
    const f = layoutPmi([dim('Hole1', 8), dim('Hole1', 9), geo('Hole1')], two).frames[0]!;
    expect(f.annotationId).toBeNull();
    expect(f.via).toMatch(/more than one callout/);
  });

  it('a dimensioned feature with no callout of that size is not placed', () => {
    const f = layoutPmi([dim('Hole1', 12), geo('Hole1')], callouts).frames[0]!;
    expect(f.annotationId).toBeNull();
  });

  it('a radius dimension never anchors a diameter callout of the same number', () => {
    const f = layoutPmi([dim('Hole1', 8, 'radius'), geo('Hole1')], callouts).frames[0]!;
    expect(f.annotationId).toBeNull();
  });

  it('a curve-length dimension is not a size to place by', () => {
    const f = layoutPmi([dim('Hole1', 8, 'curve length'), geo('Hole1')], callouts).frames[0]!;
    expect(f.annotationId).toBeNull();
  });

  it('no PMI is an empty layout', () => {
    expect(layoutPmi(null, callouts)).toEqual({ frames: [], datums: [], labelOnly: [] });
  });

  it('maps the symbols of the supported tolerance types', () => {
    expect([gdtSymbol('position'), gdtSymbol('flatness'), gdtSymbol('cylindricity'), gdtSymbol('perpendicularity')]).toEqual(['⌖', '⏥', '⌭', '⟂']);
    expect(gdtSymbol('unknown_type')).toBe('unknown_type');
  });
});

import { visibleAnnotations } from '@/lib/features/dimension-annotations';

describe('PMI view mode', () => {
  it('shows only the callouts the PMI speaks about: a stated tolerance, or a frame / datum placed on it', () => {
    const onModel = new Set(layout.frames.concat(layout.datums as any).map((f) => f.annotationId).filter((x): x is string => !!x));
    const shown = visibleAnnotations(annotations, 'pmi', onModel);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(annotations.length);
    for (const a of shown) expect(a.tolerance !== null || a.pmiNote !== null || onModel.has(a.id)).toBe(true);
    // the many R1.5 blends have no PMI and are not part of the PMI view
    expect(shown.some((a) => /R1\.5$/.test(a.label))).toBe(false);
    expect(shown.map((a) => a.label)).toContain('R45.75 ±0.15');
  });
});

describe('the centre slot', () => {
  const slot = annotations.find((a) => a.kind === 'slot' && a.label === 'Slot 15 × 29')!;

  it('is one callout from the two R7.5 ends, with the width and length the geometry gives', () => {
    expect(slot).toBeDefined();
    expect(slot.valueMm).toBe(15);
    expect(slot.count).toBe(1);
    expect(slot.faceIds.length).toBeGreaterThan(0);
  });

  it('states what the PMI says about it: the decoded Width record, 15 ±0.25, flagged for review', () => {
    // the engine's typed record: decoded from the drawn glyphs, with its limits, never presented as authoritative
    expect(slot.pmiNote).toMatch(/Width 15 ±0\.25 \(14\.75–15\.25 mm\)/);
    expect(slot.pmiNote).toMatch(/decoded from drawing/);
    expect(slot.pmiNote).toMatch(/review/);
    expect(slot.tolerance).toBeNull();
  });

  it('a slot the PMI never mentions carries no note and no tolerance', () => {
    const other = annotations.find((a) => a.kind === 'slot' && a.label !== 'Slot 15 × 29')!;
    expect(other.pmiNote).toBeNull();
    expect(other.tolerance).toBeNull();
  });

  it('shows in the all and PMI views, never in the Ø or R views', () => {
    expect(visibleAnnotations(annotations, 'all')).toContain(slot);
    expect(visibleAnnotations(annotations, 'diameter')).not.toContain(slot);
    expect(visibleAnnotations(annotations, 'radius')).not.toContain(slot);
    const pmiView = visibleAnnotations(annotations, 'pmi', new Set());
    expect(pmiView).toContain(slot);
    expect(pmiView.filter((a) => a.kind === 'slot')).toEqual([slot]); // only the slot the PMI speaks about
  });

  it('its end arcs are no longer separate R7.5 callouts', () => {
    expect(annotations.find((a) => a.kind === 'radius' && a.valueMm === 7.5)).toBeUndefined();
  });
});
