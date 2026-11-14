import { featuresRef, occurrenceByFace, occurrencesOfFaces } from '../../../../../modules/bom-items/costing/machining/feature-occurrences';

// The Cannula Holder bottom's shape: the machining recogniser lists one feature per hole (bore_0 ...), feature_graph_v2 groups them by
// diameter with one occurrence per hole; both name the CAD faces, which is the link.
const v2 = [
  { id: 'SimpleHole-threaded_d1.6_c4', occurrences: [{ face_ids: [17] }, { face_ids: [18] }, { face_ids: [19] }, { face_ids: [20] }] },
  { id: 'SimpleHole-blind_d4.0_c4', occurrences: [{ face_ids: [30, 31] }, { face_ids: [32, 33] }, { face_ids: [34, 35] }, { face_ids: [36, 37] }] },
];

describe('occurrenceByFace / occurrencesOfFaces', () => {
  const byFace = occurrenceByFace(v2);

  it('finds the feature_graph_v2 occurrence a recognised hole is, by the faces they share', () => {
    expect(occurrencesOfFaces([18], byFace)).toEqual([{ featureId: 'SimpleHole-threaded_d1.6_c4', occurrenceIndex: 1 }]);
    expect(occurrencesOfFaces([33, 32], byFace)).toEqual([{ featureId: 'SimpleHole-blind_d4.0_c4', occurrenceIndex: 1 }]);
  });

  it('names nothing for faces no occurrence has (a re-analysed or older graph): never a guess', () => {
    expect(occurrencesOfFaces([99], byFace)).toEqual([]);
    expect(occurrencesOfFaces(undefined, byFace)).toEqual([]);
  });

  it('a ref only when there are occurrences', () => {
    expect(featuresRef('Ø4 holes', [{ featureId: 'a', occurrenceIndex: 0 }])).toEqual({ kind: 'features', label: 'Ø4 holes', features: [{ featureId: 'a', occurrenceIndex: 0 }] });
    expect(featuresRef('Ø4 holes', [])).toBeUndefined();
  });
});
