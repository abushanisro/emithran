import { describe, it, expect } from 'vitest';
import type { FeatureNodeV2 } from '@/lib/types/manufacturing';
import {
  groupFeaturesByType,
  featureSelectionKey,
  resolveFeatureSelection,
  findFeatureByFaceId,
  faceIdForTriangle,
} from '@/lib/features/machining-feature-tree';

const occ = (face_ids: number[]) => ({ centroid: [0, 0, 0] as [number, number, number], face_ids });
const feat = (id: string, type: string, variant: string, faces: number[][]): FeatureNodeV2 =>
  ({ id, feature_type: type as FeatureNodeV2['feature_type'], variant, occurrences: faces.map(occ) });

const through = feat('SimpleHole_through_0', 'SimpleHole', 'through', [[3], [4]]);
const threaded = feat('SimpleHole_threaded_0', 'SimpleHole', 'threaded', [[7]]);
const pocket = feat('PocketV2_default_0', 'PocketV2', 'default', [[10, 11, 12]]);
const all = [pocket, threaded, through];

describe('groupFeaturesByType', () => {
  it('groups by catalog type then variant, counting occurrences', () => {
    const groups = groupFeaturesByType(all);
    expect(groups.map((g) => g.type)).toEqual(['PocketV2', 'SimpleHole']);
    const holes = groups.find((g) => g.type === 'SimpleHole')!;
    expect(holes.occurrenceCount).toBe(3);
    expect(holes.variants.map((v) => [v.variant, v.occurrenceCount])).toEqual([['threaded', 1], ['through', 2]]);
  });
});

describe('resolveFeatureSelection', () => {
  const faces = (key: string) =>
    resolveFeatureSelection(key, all, [99, 100])?.occurrences.flatMap((o) => o.face_ids).sort((a, b) => a - b);

  it('one occurrence highlights only its faces', () => {
    expect(faces(featureSelectionKey.occurrence('SimpleHole_through_0', 1))).toEqual([4]);
  });
  it('a variant highlights every occurrence of that variant and nothing else', () => {
    expect(faces(featureSelectionKey.variant('SimpleHole', 'through'))).toEqual([3, 4]);
  });
  it('a type spans all its variants', () => {
    expect(faces(featureSelectionKey.type('SimpleHole'))).toEqual([3, 4, 7]);
  });
  it('all highlights every feature', () => {
    expect(faces(featureSelectionKey.all)).toEqual([3, 4, 7, 10, 11, 12]);
  });
  it('unclaimed highlights the reported unexplained faces, and nothing when none are reported', () => {
    expect(faces(featureSelectionKey.unclaimed)).toEqual([99, 100]);
    expect(resolveFeatureSelection(featureSelectionKey.unclaimed, all, null)).toBeNull();
  });
  it('an unknown feature id selects nothing', () => {
    expect(resolveFeatureSelection(featureSelectionKey.occurrence('nope', 0), all, null)).toBeNull();
  });
});

describe('3D pick -> feature', () => {
  const faceMap = [
    { face_id: 3, tri_start: 0, tri_count: 10 },
    { face_id: 4, tri_start: 10, tri_count: 5 },
    { face_id: 11, tri_start: 15, tri_count: 20 },
  ];
  it('maps a triangle to the B-Rep face whose range contains it', () => {
    expect(faceIdForTriangle(faceMap, 0)).toBe(3);
    expect(faceIdForTriangle(faceMap, 12)).toBe(4);
    expect(faceIdForTriangle(faceMap, 34)).toBe(11);
    expect(faceIdForTriangle(faceMap, 35)).toBeNull();
  });
  it('finds the feature and occurrence owning a face', () => {
    expect(findFeatureByFaceId(4, all)).toEqual({ feature: through, occurrenceIndex: 1 });
    expect(findFeatureByFaceId(11, all)?.feature.id).toBe('PocketV2_default_0');
    expect(findFeatureByFaceId(500, all)).toBeNull();
  });
});
