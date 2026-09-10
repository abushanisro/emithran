import type { RouteNode } from './route-tree';

// Ordering + grouping for the Workflow Builder's route comparison list.
//
// Pure functions over the already-adapted RouteNode[] — every ordering key is
// a REAL, engine-supplied value carried through adaptRoutesToTree
// (node.cost = RouteResultDto.totalCost, node.cycleTimeMin =
// cycleTimes.totalMin, node.feasible = isFeasible). Nothing here invents,
// weights, or blends a score.
//
// In particular 'recommended' is NOT a synthetic ranking of all routes:
// computeRouteScore (page.tsx) only has real, hand-authored engineering
// judgment for the 3 cutting methods in CUTTING_ROUTE_IDS, so this mode does
// exactly two honest things — pin that one CAD-optimal route to the top, and
// keep every other route in the order the backend returned it. Iterating the
// rest through a neutral default score would be exactly the fabricated
// confidence the routing registry redesign was meant to prevent.

export type RouteSortMode = 'recommended' | 'cost' | 'time';

export const ROUTE_SORT_MODES: { id: RouteSortMode; label: string }[] = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'cost', label: 'Cost' },
  { id: 'time', label: 'Cycle time' },
];

export interface RouteGroup {
  family: 'cutting' | 'forming';
  title: string;
  /** Why these routes are structurally one set — sourced from
   *  RouteResultDto.processFamily's own contract, not marketing copy. */
  description: string;
  nodes: RouteNode[];
}

/** Ascending, with genuinely-absent values pushed last rather than coerced to 0. */
function ascWithNullsLast(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/**
 * Orders routes for display. Infeasible routes always sink to the bottom of
 * their group (they stay visible — a route the machine genuinely cannot run
 * is real information, not noise to hide), but never outrank a route that
 * can actually make the part.
 */
export function sortRouteNodes(
  nodes: RouteNode[],
  mode: RouteSortMode,
  recommendedId: string | null,
): RouteNode[] {
  const indexOf = new Map(nodes.map((n, i) => [n.id, i] as const));
  return [...nodes].sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;

    if (mode === 'cost') {
      const byCost = ascWithNullsLast(a.cost, b.cost);
      if (byCost !== 0) return byCost;
    } else if (mode === 'time') {
      const byTime = ascWithNullsLast(a.cycleTimeMin, b.cycleTimeMin);
      if (byTime !== 0) return byTime;
    } else if (recommendedId) {
      if (a.id === recommendedId) return -1;
      if (b.id === recommendedId) return 1;
    }

    // Stable fallback: whatever order the backend returned.
    return (indexOf.get(a.id) ?? 0) - (indexOf.get(b.id) ?? 0);
  });
}

/**
 * Splits the list into the two structurally different alternative sets the
 * backend already distinguishes. They are NOT interchangeable rows in one
 * ranking: a cutting route is one choice of cutting method for a shared
 * cut → bend → finish chain, while a forming route produces the finished part
 * in a single press/roll operation with no separate bending step at all.
 * Presenting them as one flat list invited exactly the wrong comparison
 * ("$0.30 forming beats $0.47 laser") between two different scopes of work.
 *
 * Empty groups are dropped, and group order follows the first occurrence in
 * the input so a backend that returns only forming routes still reads right.
 */
export function groupRouteNodes(nodes: RouteNode[]): RouteGroup[] {
  const meta: Record<RouteGroup['family'], { title: string; description: string }> = {
    cutting: {
      title: 'Cut, then form and finish',
      description: 'Alternative cutting methods for the same downstream chain. Pick one.',
    },
    forming: {
      title: 'Single-operation forming',
      description: 'Produces the finished part in one press or roll — bending happens in-process, so there is no separate Press Brake step.',
    },
  };

  const groups: RouteGroup[] = [];
  for (const node of nodes) {
    let group = groups.find((g) => g.family === node.processFamily);
    if (!group) {
      group = { family: node.processFamily, ...meta[node.processFamily], nodes: [] };
      groups.push(group);
    }
    group.nodes.push(node);
  }
  return groups;
}

/**
 * Largest real cost across the given routes — drives the relative cost bar in
 * the comparison list. `null` when no route has a cost at all, so the bar is
 * omitted rather than drawn against a made-up scale.
 */
export function maxRouteCost(nodes: RouteNode[]): number | null {
  const costs = nodes.map((n) => n.cost).filter((c): c is number => c !== null && Number.isFinite(c));
  return costs.length > 0 ? Math.max(...costs) : null;
}
