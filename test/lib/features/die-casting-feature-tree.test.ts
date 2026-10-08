import { describe, it, expect } from 'vitest';
import { groupDieCastFeatures, occurrenceProperties } from '@/lib/features/die-casting-feature-tree';
import type { FeatureNodeV2 } from '@/lib/types/manufacturing';

const node = (id: string, type: string, occs: Record<string, unknown>[], variant?: string): FeatureNodeV2 => ({
  id,
  feature_type: type as FeatureNodeV2['feature_type'],
  ...(variant ? { variant } : {}),
  occurrences: occs.map((o) => ({ centroid: [0, 0, 0], face_ids: [1], ...o })) as FeatureNodeV2['occurrences'],
});

describe('groupDieCastFeatures', () => {
  const groups = groupDieCastFeatures([
    node('h1', 'SimpleHole', [{ diameter_mm: 4 }, { diameter_mm: 6 }], 'through'),
    node('m1', 'MultiStepHole', [{ step_count: 3 }], 'stepped'),
    node('v1', 'Void', [{ retraction_axis_name: 'x' }]),
    node('p1', 'PlanarFace', [{ area_mm2: 10 }]),
    node('n1', 'NotSupported', [{}]),
  ]);

  it('puts each catalog type in its category, empty types omitted', () => {
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));
    expect(byKey.holes!.types.map((t) => t.type)).toEqual(['SimpleHole', 'MultiStepHole']);
    expect(byKey.volume!.types.map((t) => t.type)).toEqual(['Void']);
    expect(byKey.surfaces!.count).toBe(1);
    expect(byKey.not_supported!.count).toBe(1);
  });

  it('numbers occurrences per type, one row per physical instance', () => {
    const holes = groups.find((g) => g.key === 'holes')!;
    expect(holes.count).toBe(3);
    expect(holes.types[0]!.rows.map((r) => r.label)).toEqual(['SimpleHole:1', 'SimpleHole:2']);
  });
});

describe('occurrenceProperties', () => {
  it('lists reported scalars and drops face ids', () => {
    const [g] = groupDieCastFeatures([node('m1', 'MultiStepHole', [{ step_count: 3, monotonic: true, depth_mm: 11.18 }], 'stepped')]).filter((x) => x.count);
    const props = occurrenceProperties(g!.types[0]!.rows[0]!);
    const names = props.map((p) => p.name);
    expect(names).toContain('step_count');
    expect(names).not.toContain('face_ids');
    expect(props.find((p) => p.name === 'depth_mm')!.value).toBe('11.18');
    expect(props.find((p) => p.name === 'Variant')!.value).toBe('stepped');
  });
});
