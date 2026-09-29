/**
 * machiningFeatureCounts reads the cad-engine's reference-type summaries
 * (MachiningFeatureTree.to_dict: feature_summary keyed "PocketV2",
 * variant_summary keyed "SimpleHole:through"). Every consumer used to read the
 * pre-vocabulary keys "pockets"/"through_hole"/"blind_hole", which no longer
 * exist — so pocket and hole counts were 0 for every machining part.
 */
import { machiningFeatureCounts } from '../../../../../../modules/bom-items/costing/machining/operation/machining-feature-counts';

// Shape exactly as cad-engine/machining/feature_models.py to_dict() emits it.
const milledPart = {
  family: 'milled',
  feature_summary: { SimpleHole: 9, PocketV2: 14, PlanarFace: 6 },
  variant_summary: {
    'SimpleHole:through': 4, 'SimpleHole:blind': 2, 'SimpleHole:threaded': 3,
    'PocketV2:default': 14, 'PlanarFace:default': 6,
  },
};

describe('machiningFeatureCounts', () => {
  it('counts plain through + blind bores, not threaded ones', () => {
    expect(machiningFeatureCounts(milledPart)?.drilledHoles).toBe(6);
  });

  it('counts PocketV2 features as pockets', () => {
    expect(machiningFeatureCounts(milledPart)?.pockets).toBe(14);
  });

  it('returns null when the part has no machining_features', () => {
    expect(machiningFeatureCounts(undefined)).toBeNull();
  });
});
