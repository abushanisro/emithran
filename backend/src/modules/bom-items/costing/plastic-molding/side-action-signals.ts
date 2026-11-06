// What the recognised plastic features say about side actions, as the counts the molding router and the tooling cost read. Pure.
//
// `undercutCount` used to be the CAD engine's count of undercut FACES, while the cost view and the router read it as undercut FEATURES ("N undercut
// feature(s) - slide/lifter tooling required"). A part with one snap-fit window made of eight faces was eight undercuts, and the all-surface analysis made the
// face counts larger still. The features now stand on their own: a void, a combo of voids and holes, or a hole that is not along the pull is one feature that
// needs a side action, however many faces it has.
import { ALONG_PULL_MAX_DEG } from './operation/plastic-catalog-operation-resolver';
import type { PlasticFeatureGraph } from './operation/plastic-catalog-operations.service';

export interface SideActionSignals {
  /** Features that need a side action: voids, combo voids, and holes whose axis is not along the pull. */
  undercutFeatures: number;
  /** Bundles only a slide can serve (not square enough to the pull for a lifter): they take the slide hardware. */
  slideBundles: number;
  /** Bundles a lifter can serve and a slide can too: which is not decided (clearance beside the part), so no slide hardware is assumed. */
  slideOrLifterBundles: number;
}

const HOLES: ReadonlySet<string> = new Set(['SimpleHole', 'MultiStepHole']);

/**
 * Null when the graph cannot give the count: no graph, or one from an engine that did not look for voids (its `not_yet_recognized` still lists Void), where a
 * count would understate. The caller then keeps the face-based signal it had.
 */
export function sideActionSignals(graph: PlasticFeatureGraph | null | undefined): SideActionSignals | null {
  if (!graph || graph.schema !== 'plastic_feature_graph_v1' || !Array.isArray(graph.items)) return null;
  if (graph.not_yet_recognized.includes('Void')) return null;
  let undercutFeatures = 0;
  let slideBundles = 0;
  let slideOrLifterBundles = 0;
  for (const f of graph.items) {
    if (f.feature_type === 'Void' || f.feature_type === 'ComboVoid') undercutFeatures += 1;
    else if (HOLES.has(f.feature_type) && (f.attributes?.angle_to_pull_deg ?? 0) > ALONG_PULL_MAX_DEG) undercutFeatures += 1;
    else if (f.feature_type === 'SlideBundle') slideBundles += 1;
    else if (f.feature_type === 'LifterBundle') slideOrLifterBundles += 1;
  }
  return { undercutFeatures, slideBundles, slideOrLifterBundles };
}
