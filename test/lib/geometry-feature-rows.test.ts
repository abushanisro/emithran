import { describe, expect, it } from 'vitest';

import { featureCountSummary, featureTypeLabel, geometryFeatureGroups } from '@/lib/features/geometry-feature-rows';
import type { FeatureNodeV2 } from '@/lib/types/manufacturing';

const occ = (n: number, extra: Record<string, unknown> = {}) => Array.from({ length: n }, () => ({ centroid: [0, 0, 0], face_ids: [1], ...extra }));
const f = (id: string, feature_type: string, variant: string, n: number, extra: Record<string, unknown> = {}, occExtra: Record<string, unknown> = {}) =>
  ({ id, feature_type, variant, occurrences: occ(n, occExtra), ...extra }) as unknown as FeatureNodeV2;

// The Cannula Holder's analysis: 13 holes in four sizes, pockets, grooves, faces and rounded edges.
const features = [
  f('e0', 'Edge', 'round', 30, { diameter_mm: 0 }),
  f('h1', 'SimpleHole', 'threaded', 4, { diameter_mm: 1.6 }),
  f('h2', 'SimpleHole', 'blind', 4, { diameter_mm: 4 }),
  f('h3', 'SimpleHole', 'threaded', 4, { diameter_mm: 2.5 }),
  f('h4', 'SimpleHole', 'blind', 1, { diameter_mm: 18.400000000000002 }),
  f('p', 'PocketV2', 'default', 6),
  f('e1', 'Edge', 'round', 2, { diameter_mm: 42 }, { radius_mm: 21 }),
  f('s', 'Slot', 'groove', 2, { diameter_mm: 8 }, { radius_mm: 4 }),
  f('pf', 'PlanarFace', 'default', 24),
  f('none', 'CurvedWall', 'default', 0),
];

describe('geometryFeatureGroups', () => {
  const groups = geometryFeatureGroups(features);
  const group = (type: string) => groups.find((g) => g.type === type)!;

  it('lists every feature type the analysis found, with its occurrence count', () => {
    expect(groups.map((g) => `${g.type} ${g.count}`)).toEqual(['Edge 32', 'PlanarFace 24', 'PocketV2 6', 'SimpleHole 13', 'Slot 2']);
  });

  it('counts holes by occurrence, one row per size and variant', () => {
    expect(group('SimpleHole').rows.map((r) => `${r.label} × ${r.count}`)).toEqual([
      'Ø4.0 mm · blind × 4', 'Ø18.4 mm · blind × 1', 'Ø1.6 mm · threaded × 4', 'Ø2.5 mm · threaded × 4',
    ]);
  });

  it('names a rounded edge or a groove by its measured radius, and a feature with no size by its variant', () => {
    expect(group('Edge').rows.map((r) => r.label)).toEqual(['round', 'R21.0 mm · round']);
    expect(group('Slot').rows[0]!.label).toBe('R4.0 mm · groove');
    expect(group('PocketV2').rows[0]!.label).toBe('default');
  });

  it('names each type in words, in the plural, from the catalog name itself', () => {
    expect(groups.map((g) => g.label)).toEqual(['Edges', 'Planar faces', 'Pockets', 'Simple holes', 'Slots']);
    expect(['MultiStepHole', 'CurvedSurface', 'CurvedWall', 'Boss', 'SharpEdge', 'Keyway'].map(featureTypeLabel))
      .toEqual(['Multi step holes', 'Curved surfaces', 'Curved walls', 'Bosses', 'Sharp edges', 'Keyways']);
  });

  it('summarises the part in counts, largest group first', () => {
    expect(featureCountSummary(features)).toEqual(['32 edges', '24 planar faces', '13 simple holes', '6 pockets', '2 slots']);
  });

  it('each row carries the feature it stands for, for highlighting', () => {
    expect(group('Slot').rows[0]!.feature.id).toBe('s');
  });
});
