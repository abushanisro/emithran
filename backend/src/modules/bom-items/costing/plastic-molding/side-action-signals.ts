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
  /**
   * The bundles by the size class the CAD engine gave each (by the lifter or slide bundle width thresholds): what sizes the block steel. A LifterBundle
   * is counted as a lifter (the cheaper of the two it could be). `unsized`: bundles with no size class, which cannot be priced.
   */
  blocks: { slide: BlockSizes; lifter: BlockSizes; unsized: number };
  /** The longest stroke of a slide bundle (mm): the slides move out and back each shot. Null when no slide bundle has one. Lifters ride on the ejection. */
  maxSlideStrokeMm: number | null;
  /** Which bundle that stroke is (its plastic feature graph id): what the Slide Stroke input lights. */
  maxSlideStrokeBundleId: string | null;
  /** The sized bundles counted in `blocks`, by kind (plastic feature graph ids): what the block volumes light. */
  blockBundleIds: { slide: string[]; lifter: string[] };
}

export type BlockSize = 'small' | 'medium' | 'large';
export type BlockSizes = Record<BlockSize, number>;
const SIZES: ReadonlySet<string> = new Set(['small', 'medium', 'large']);

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
  const blocks = { slide: { small: 0, medium: 0, large: 0 }, lifter: { small: 0, medium: 0, large: 0 }, unsized: 0 };
  let maxSlideStrokeMm: number | null = null;
  let maxSlideStrokeBundleId: string | null = null;
  const blockBundleIds = { slide: [] as string[], lifter: [] as string[] };
  const sized = (kind: 'slide' | 'lifter', size: unknown, id: unknown) => {
    if (typeof size === 'string' && SIZES.has(size)) {
      blocks[kind][size as BlockSize] += 1;
      if (typeof id === 'string') blockBundleIds[kind].push(id);
    }
    else blocks.unsized += 1;
  };
  for (const f of graph.items) {
    if (f.feature_type === 'Void' || f.feature_type === 'ComboVoid') undercutFeatures += 1;
    else if (HOLES.has(f.feature_type) && (f.attributes?.angle_to_pull_deg ?? 0) > ALONG_PULL_MAX_DEG) undercutFeatures += 1;
    else if (f.feature_type === 'SlideBundle') {
      slideBundles += 1;
      sized('slide', f.attributes?.size_class, f.id);
      const stroke = f.attributes?.stroke_mm;
      if (typeof stroke === 'number' && stroke > 0 && stroke > (maxSlideStrokeMm ?? 0)) {
        maxSlideStrokeMm = stroke;
        maxSlideStrokeBundleId = typeof f.id === 'string' ? f.id : null;
      }
    }
    else if (f.feature_type === 'LifterBundle') { slideOrLifterBundles += 1; sized('lifter', f.attributes?.size_class, f.id); }
  }
  return { undercutFeatures, slideBundles, slideOrLifterBundles, blocks, maxSlideStrokeMm, maxSlideStrokeBundleId, blockBundleIds };
}
