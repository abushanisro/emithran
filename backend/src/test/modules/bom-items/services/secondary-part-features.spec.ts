import { partFeatures } from '../../../../modules/bom-items/services/secondary-process.service';

// The features a feature-counting secondary operation (CMM probe touches) reads, for a molded part and for any other.

const plasticGraph = {
  summary: {
    plasticFeatureGraph: {
      items: [
        { id: 'hole-1', feature_type: 'SimpleHole', occurrences: [{ face_ids: [4, 5] }] },
        { id: 'planarface-all', feature_type: 'PlanarFace', occurrences: [{ face_ids: [10, 11, 12] }] },
        { id: 'curvedwall-all', feature_type: 'CurvedWall', occurrences: [{ face_ids: [20, 21] }] },
        { id: 'parting-line', feature_type: 'PartingLine', occurrences: [] },
      ],
    },
  },
  feature_graph_v2: { features: [{ id: 'im_undrafted', feature_type: 'im_undrafted', occurrences: [{ face_ids: [1] }] }] },
};

describe('partFeatures', () => {
  it('a molded part reads its recognised features, not the draft finding of feature_graph_v2', () => {
    const f = partFeatures(plasticGraph, 'plastic_molded');
    expect(f.map((x) => x.feature_type)).toEqual(['SimpleHole', 'PlanarFace', 'CurvedWall', 'PartingLine']);
    expect(f.some((x) => x.feature_type === 'im_undrafted')).toBe(false);
  });

  it('a surface type kept as one aggregate item is one feature per face (the touch table counts touches per feature)', () => {
    const f = partFeatures(plasticGraph, 'plastic_molded');
    expect(f.find((x) => x.feature_type === 'PlanarFace')!.occurrences).toHaveLength(3);
    expect(f.find((x) => x.feature_type === 'CurvedWall')!.occurrences).toHaveLength(2);
  });

  it('a hole is one feature however many faces it has, and an item with no occurrences stays empty', () => {
    const f = partFeatures(plasticGraph, 'plastic_molded');
    expect(f.find((x) => x.feature_type === 'SimpleHole')!.occurrences).toHaveLength(1);
    expect(f.find((x) => x.feature_type === 'PartingLine')!.occurrences).toHaveLength(0);
  });

  it('every other family reads feature_graph_v2 as before (its occurrences are already one per feature)', () => {
    const fg = { feature_graph_v2: { features: [{ id: 'a', feature_type: 'PocketV2', occurrences: [{}, {}] }, { id: 'b', feature_type: 'SimpleHole' }, { feature_type: 'x', occurrences: [] }] } };
    expect(partFeatures(fg, 'milled').map((x) => x.id)).toEqual(['a']);
    expect(partFeatures(fg, 'milled')[0]!.occurrences).toHaveLength(2);
    expect(partFeatures({}, 'milled')).toEqual([]);
    expect(partFeatures({ summary: {} }, 'plastic_molded')).toEqual([]);
  });

  it('a molded part with no plastic feature graph reads nothing rather than the draft finding', () => {
    expect(partFeatures({ feature_graph_v2: plasticGraph.feature_graph_v2 }, 'plastic_molded').map((x) => x.feature_type)).toEqual(['im_undrafted']);
  });
});
