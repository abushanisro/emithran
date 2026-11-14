// The Manufacturing Process tree row of a CAD feature: when a feature is selected somewhere else (a Feature breakdown
// card, a calculator input's eye), the tree selects and reveals the row that stands for it. Pure.

export interface FeatureTreeNode {
  id: string;
  children?: FeatureTreeNode[];
  /** The one feature_graph_v2 entry the row stands for. */
  v2FeatureId?: string;
  /** The feature_graph_v2 entries the row groups. */
  v2FeatureIds?: string[];
  /** Exact occurrences of entries the row stands for. */
  v2Occurrences?: { featureId: string; occurrenceIndex: number }[];
}

/** How closely a row stands for the feature: the entry itself, one of the entries it groups, or nothing. */
function matchRank(node: FeatureTreeNode, featureId: string): number {
  if (node.v2FeatureId === featureId) return 2;
  if (node.v2FeatureIds?.includes(featureId) || node.v2Occurrences?.some((o) => o.featureId === featureId)) return 1;
  return 0;
}

/**
 * The ids from the root down to the row that stands for the feature, or null when no row does. The row of the
 * entry itself wins over a row that only groups it; between equal rows the first in tree order wins.
 */
export function treePathForFeature(
  root: FeatureTreeNode | null | undefined,
  featureId: string | readonly string[] | null | undefined,
): string[] | null {
  const ids = (typeof featureId === 'string' ? [featureId] : featureId ?? []).filter(Boolean);
  if (!root || ids.length === 0) return null;
  let best: { rank: number; path: string[] } | null = null;
  const walk = (node: FeatureTreeNode, ancestors: string[]) => {
    const path = [...ancestors, node.id];
    const rank = Math.max(...ids.map((id) => matchRank(node, id)));
    if (rank > (best?.rank ?? 0)) best = { rank, path };
    for (const child of node.children ?? []) walk(child, path);
  };
  walk(root, []);
  return (best as { rank: number; path: string[] } | null)?.path ?? null;
}

type GraphFeature = { id: string; occurrences?: ReadonlyArray<{ face_ids?: readonly number[] }> };
type Highlight = { id: string; occurrences?: ReadonlyArray<{ face_ids?: readonly number[] }> };

/**
 * The feature_graph_v2 entries a highlight shows. A card builds its highlight under its own id ("detected_pocket", "gcd-Ø4 hole", a merged
 * "hl-…"), so the id names a feature only when it is one; otherwise the highlight is the features its faces belong to, most shared faces
 * first. Faces are what the model lights, so this is exactly what the card shows, whatever it was built from.
 */
export function featuresOfHighlight(highlight: Highlight | null | undefined, features: readonly GraphFeature[] | null | undefined): string[] {
  if (!highlight) return [];
  const all = features ?? [];
  if (all.some((f) => f.id === highlight.id)) return [highlight.id];
  const shown = new Set((highlight.occurrences ?? []).flatMap((o) => o.face_ids ?? []));
  if (shown.size === 0) return [];
  return all
    .map((f) => ({ id: f.id, shared: (f.occurrences ?? []).flatMap((o) => o.face_ids ?? []).filter((x) => shown.has(x)).length }))
    .filter((f) => f.shared > 0)
    .sort((a, b) => b.shared - a.shared)
    .map((f) => f.id);
}
