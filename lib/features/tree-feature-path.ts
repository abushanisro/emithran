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
export function treePathForFeature(root: FeatureTreeNode | null | undefined, featureId: string | null | undefined): string[] | null {
  if (!root || !featureId) return null;
  let best: { rank: number; path: string[] } | null = null;
  const walk = (node: FeatureTreeNode, ancestors: string[]) => {
    const path = [...ancestors, node.id];
    const rank = matchRank(node, featureId);
    if (rank > (best?.rank ?? 0)) best = { rank, path };
    for (const child of node.children ?? []) walk(child, path);
  };
  walk(root, []);
  return (best as { rank: number; path: string[] } | null)?.path ?? null;
}
