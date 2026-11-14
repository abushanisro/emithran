import { describe, expect, it } from 'vitest';

import { featuresOfHighlight, treePathForFeature } from '@/lib/features/tree-feature-path';

// Manufacturing Process tree of a milled part: the mill groups its features by type, each type holding its entries.
const tree = {
  id: 'root',
  children: [{
    id: 'grp_0',
    children: [{
      id: 'op_0',
      children: [
        { id: 'pockets', v2FeatureIds: ['PocketV2-default_c16'], children: [{ id: 'pocket_entry', v2FeatureId: 'PocketV2-default_c16' }] },
        { id: 'holes', v2Occurrences: [{ featureId: 'SimpleHole-blind_d4.0_c4', occurrenceIndex: 0 }] },
      ],
    }, { id: 'op_1' }],
  }],
};

describe('treePathForFeature: the tree row of a feature selected elsewhere', () => {
  it('finds the row of the entry itself, with every ancestor to expand', () => {
    expect(treePathForFeature(tree, 'PocketV2-default_c16')).toEqual(['root', 'grp_0', 'op_0', 'pockets', 'pocket_entry']);
  });

  it('falls back to the row that groups the feature when no row is the entry itself', () => {
    expect(treePathForFeature(tree, 'SimpleHole-blind_d4.0_c4')).toEqual(['root', 'grp_0', 'op_0', 'holes']);
  });

  it('is null when no row stands for the feature, or nothing is selected', () => {
    expect(treePathForFeature(tree, 'Slot-groove_d8.0_c2')).toBeNull();
    expect(treePathForFeature(tree, null)).toBeNull();
    expect(treePathForFeature(null, 'PocketV2-default_c16')).toBeNull();
  });
});

describe('featuresOfHighlight: which features a card\'s highlight shows', () => {
  const features = [
    { id: 'PocketV2-default_c16', occurrences: [{ face_ids: [10, 11] }, { face_ids: [12, 13] }] },
    { id: 'SimpleHole-blind_d4.0_c4', occurrences: [{ face_ids: [30] }, { face_ids: [31] }] },
  ];

  it('a highlight under the feature\'s own id is that feature', () => {
    expect(featuresOfHighlight({ id: 'PocketV2-default_c16', occurrences: [] }, features)).toEqual(['PocketV2-default_c16']);
  });

  it('a card\'s own id ("detected_pocket", one instance) is matched by the faces it lights, so the tree selects the pockets row', () => {
    const ids = featuresOfHighlight({ id: 'detected_pocket', occurrences: [{ face_ids: [12, 13] }] }, features);
    expect(ids).toEqual(['PocketV2-default_c16']);
    expect(treePathForFeature(tree, ids)).toEqual(['root', 'grp_0', 'op_0', 'pockets', 'pocket_entry']);
  });

  it('several features: the one sharing the most faces first', () => {
    expect(featuresOfHighlight({ id: 'hl-op', occurrences: [{ face_ids: [30, 10, 11] }] }, features)).toEqual(['PocketV2-default_c16', 'SimpleHole-blind_d4.0_c4']);
  });

  it('nothing shown, or faces no feature has: no row', () => {
    expect(featuresOfHighlight(null, features)).toEqual([]);
    expect(featuresOfHighlight({ id: 'x', occurrences: [{ face_ids: [99] }] }, features)).toEqual([]);
  });
});
