/**
 * Whole-part machining feature tree, built only from feature_graph_v2.
 *
 * Grouping is catalog feature type -> variant -> occurrence. The type names are
 * the reference catalog's own "//Feature" names (SimpleHole, MultiStepHole,
 * PocketV2, ...), which the CAD engine is gated to emit
 * (cad-engine/shared/reference_features.json) — so no display-name table is
 * kept here to drift from the catalog.
 */
import type { FeatureNodeV2, FeatureOccurrence } from '@/lib/types/manufacturing';

export interface MachiningVariantGroup {
  variant: string;
  features: FeatureNodeV2[];
  occurrenceCount: number;
}

export interface MachiningTypeGroup {
  type: string;
  variants: MachiningVariantGroup[];
  occurrenceCount: number;
}

export function groupFeaturesByType(features: readonly FeatureNodeV2[]): MachiningTypeGroup[] {
  const byType = new Map<string, Map<string, FeatureNodeV2[]>>();
  for (const f of features) {
    const type = String(f.feature_type);
    const variant = f.variant ?? 'default';
    const variants = byType.get(type) ?? new Map<string, FeatureNodeV2[]>();
    variants.set(variant, [...(variants.get(variant) ?? []), f]);
    byType.set(type, variants);
  }
  return [...byType.entries()]
    .map(([type, variants]) => {
      const variantGroups = [...variants.entries()]
        .map(([variant, fs]) => ({
          variant,
          features: fs,
          occurrenceCount: fs.reduce((s, f) => s + f.occurrences.length, 0),
        }))
        .sort((a, b) => a.variant.localeCompare(b.variant));
      return {
        type,
        variants: variantGroups,
        occurrenceCount: variantGroups.reduce((s, v) => s + v.occurrenceCount, 0),
      };
    })
    .sort((a, b) => a.type.localeCompare(b.type));
}

/** Selection keys for the feature tree. One string so it fits the existing selection state. */
export const featureSelectionKey = {
  all: 'v2:*',
  unclaimed: 'v2:unclaimed',
  type: (type: string) => `v2:type:${type}`,
  variant: (type: string, variant: string) => `v2:variant:${type}:${variant}`,
  feature: (featureId: string) => `v2:feature:${featureId}`,
  occurrence: (featureId: string, index: number) => `v2:occ:${featureId}#${index}`,
};

/**
 * Resolves a selection key to the exact faces to highlight, as one merged
 * FeatureNodeV2. Returns null for an unknown key or nothing to show.
 */
export function resolveFeatureSelection(
  key: string,
  features: readonly FeatureNodeV2[],
  unclaimedFaceIds: readonly number[] | null | undefined,
): FeatureNodeV2 | null {
  const merge = (id: string, fs: readonly FeatureNodeV2[], occurrences?: FeatureOccurrence[]): FeatureNodeV2 | null => {
    const occ = occurrences ?? fs.flatMap((f) => f.occurrences);
    if (occ.length === 0) return null;
    return { id, feature_type: fs[0]?.feature_type ?? ('SimpleHole' as FeatureNodeV2['feature_type']), occurrences: occ };
  };

  if (key === featureSelectionKey.all) return merge(key, features);
  if (key === featureSelectionKey.unclaimed) {
    if (!unclaimedFaceIds?.length) return null;
    return {
      id: key,
      feature_type: 'PlanarFace' as FeatureNodeV2['feature_type'],
      occurrences: [{ centroid: [0, 0, 0], face_ids: [...unclaimedFaceIds] }],
    };
  }
  if (key.startsWith('v2:type:')) {
    const type = key.slice('v2:type:'.length);
    return merge(key, features.filter((f) => String(f.feature_type) === type));
  }
  if (key.startsWith('v2:variant:')) {
    const rest = key.slice('v2:variant:'.length);
    const sep = rest.indexOf(':');
    const type = rest.slice(0, sep);
    const variant = rest.slice(sep + 1);
    return merge(key, features.filter((f) => String(f.feature_type) === type && (f.variant ?? 'default') === variant));
  }
  if (key.startsWith('v2:feature:')) {
    const id = key.slice('v2:feature:'.length);
    return merge(key, features.filter((f) => f.id === id));
  }
  if (key.startsWith('v2:occ:')) {
    const rest = key.slice('v2:occ:'.length);
    const hash = rest.lastIndexOf('#');
    const id = rest.slice(0, hash);
    const index = Number(rest.slice(hash + 1));
    const f = features.find((x) => x.id === id);
    const occ = f?.occurrences[index];
    return f && occ ? merge(key, [f], [occ]) : null;
  }
  return null;
}

/**
 * The feature that owns a picked B-Rep face, and which of its occurrences —
 * for turning a 3D click into a tree selection. First owner wins; once Phase 1
 * face-coverage accounting lands every face has at most one owner.
 */
export function findFeatureByFaceId(
  faceId: number,
  features: readonly FeatureNodeV2[],
): { feature: FeatureNodeV2; occurrenceIndex: number } | null {
  for (const feature of features) {
    const occurrenceIndex = feature.occurrences.findIndex((o) => o.face_ids?.includes(faceId));
    if (occurrenceIndex >= 0) return { feature, occurrenceIndex };
  }
  return null;
}

/**
 * B-Rep face id owning an STL triangle, from feature_graph_v2.metadata.face_map
 * (each face owns the contiguous triangle range [tri_start, tri_start+tri_count)).
 * Pass the face_map sorted by tri_start. Null when the triangle is in no range.
 */
export function faceIdForTriangle(
  sortedFaceMap: readonly { face_id: number; tri_start: number; tri_count: number }[],
  triangleIndex: number,
): number | null {
  let lo = 0;
  let hi = sortedFaceMap.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const e = sortedFaceMap[mid]!;
    if (triangleIndex < e.tri_start) hi = mid - 1;
    else if (triangleIndex >= e.tri_start + e.tri_count) lo = mid + 1;
    else return e.face_id;
  }
  return null;
}
