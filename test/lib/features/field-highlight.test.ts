import { describe, expect, it } from 'vitest';

import { cachedFeaturesHighlight, checkAgainstInput, featuresHighlight, highlightableGraph, resolveFieldHighlight } from '@/lib/features/field-highlight';
import type { FeatureGraphV2 } from '@/lib/types/manufacturing';

const graph: FeatureGraphV2 = {
  metadata: { face_map: [] },
  features: [
    {
      id: 'cut_profile', feature_type: 'Blank',
      occurrences: [
        { centroid: [0, 0, 0], face_ids: [0, 1], cut_category: 'outer_profile', length_mm: 300 },
        { centroid: [0, 0, 0], face_ids: [6], cut_category: 'circular_holes', length_mm: 31.4 },
      ],
    },
    { id: 'bend_r1', feature_type: 'StraightBend', occurrences: [{ centroid: [1, 1, 1], face_ids: [8, 9] }] },
    // Real Rtp2 shape: one node per diameter, one occurrence per hole.
    { id: 'hole_d2.5', feature_type: 'SimpleHole', variant: 'through', diameter_mm: 2.5, occurrences: [
      { centroid: [0, 0, 0], face_ids: [20, 21] }, { centroid: [0, 0, 0], face_ids: [22, 23] }, { centroid: [0, 0, 0], face_ids: [24, 25] } ] },
    { id: 'hole_d4.0', feature_type: 'SimpleHole', variant: 'through', diameter_mm: 4, occurrences: [{ centroid: [0, 0, 0], face_ids: [30, 31] }] },
  ],
  measurements: {
    pierce_count: {
      value: 3, unit: 'count', reconciles: false,
      occurrences: [{ kind: 'hole', face_ids: [6] }, { kind: 'initial_pierce', face_ids: [0, 1] }],
    },
    flat_pattern_area: { value: 5000, unit: 'mm2', reconciles: true, occurrences: [{ face_ids: [2, 3, 8, 9] }] },
    wall_thickness: { value: 2.5, unit: 'mm', reconciles: true, occurrences: [{ face_ids: [4, 5], length_mm: 2.5 }, { face_ids: [10, 11], length_mm: 2.5 }] },
    part_volume: { value: 28962.5, unit: 'mm3', reconciles: true, occurrences: [{ face_ids: [0, 1, 2, 3, 4, 5] }] },
  },
};

const faces = (n: { occurrences: { face_ids: number[] }[] }) => n.occurrences.flatMap((o) => o.face_ids);

describe('resolveFieldHighlight', () => {
  it('Cutting Length highlights the cut faces and reports the measured sum', () => {
    const h = resolveFieldHighlight('cut_length', graph);
    expect(faces(h!.node)).toEqual([0, 1, 6]);
    expect(h!.measured.value).toBeCloseTo(331.4);
  });

  it('pierces highlight the recorded pierce faces and surface a failed reconciliation', () => {
    const h = resolveFieldHighlight('pierce_count', graph);
    expect(faces(h!.node)).toEqual([6, 0, 1]);
    expect(h!.reconciles).toBe(false);
  });

  it('flat pattern area and bends resolve to their own faces', () => {
    expect(faces(resolveFieldHighlight('flat_pattern_area', graph)!.node)).toEqual([2, 3, 8, 9]);
    expect(faces(resolveFieldHighlight('bend_count', graph)!.node)).toEqual([8, 9]);
  });

  it('bending line length highlights only the longest bend', () => {
    const bends: FeatureGraphV2 = {
      ...graph,
      measurements: { bend_line_length: { value: 90, unit: 'mm', reconciles: true, occurrences: [
        { kind: 'bend', face_ids: [8, 9], length_mm: 90 }, { kind: 'bend', face_ids: [10, 11], length_mm: 40 } ] } },
    };
    const h = resolveFieldHighlight('bend_line_length', bends)!;
    expect(faces(h.node)).toEqual([8, 9]);
  });

  it('a part analysed before the engine recorded a set gets no highlight, not a guess', () => {
    const legacy: FeatureGraphV2 = { metadata: { face_map: [] }, features: [] };
    expect(resolveFieldHighlight('pierce_count', legacy)).toBeNull();
    expect(resolveFieldHighlight('bend_line_length', graph)).toBeNull();
    expect(resolveFieldHighlight('cut_length', legacy)).toBeNull();
  });

  it('tool changes highlight only the first hole of each diameter', () => {
    const h = resolveFieldHighlight('hole_diameters', graph)!;
    expect(faces(h.node)).toEqual([20, 21, 30, 31]);
    expect(h.measured).toMatchObject({ value: 2, unit: 'count' });
  });

  it('resolves a (graph, key) once and returns the same object after that', () => {
    expect(resolveFieldHighlight('cut_length', graph)).toBe(resolveFieldHighlight('cut_length', graph));
    expect(resolveFieldHighlight('pierce_count', graph)).toBe(resolveFieldHighlight('pierce_count', graph));
  });

  it('no evidence key, or an unknown one, gives no highlight', () => {
    expect(resolveFieldHighlight(undefined, graph)).toBeNull();
    expect(resolveFieldHighlight('cutting_speed', graph)).toBeNull();
  });
});

describe('molding calculator inputs', () => {
  it('the nominal wall highlights only the face pairs that voted for it', () => {
    const h = resolveFieldHighlight('wall_thickness', graph)!;
    expect(faces(h.node)).toEqual([4, 5, 10, 11]);
    expect(h.measured).toEqual({ value: 2.5, unit: 'mm', label: 'wall thickness' });
  });

  it('the part volume highlights the whole body, and a different input value is flagged, not hidden', () => {
    const h = resolveFieldHighlight('part_volume', graph)!;
    expect(faces(h.node)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(checkAgainstInput(h, 31000).reconciles).toBe(false);
    expect(checkAgainstInput(h, 28962.5).reconciles).toBe(true);
  });

  it('an analysis without those measurements stays plain', () => {
    const old = { ...graph, measurements: {} };
    expect(resolveFieldHighlight('wall_thickness', old)).toBeNull();
    expect(resolveFieldHighlight('part_volume', old)).toBeNull();
  });
});

describe('checkAgainstInput', () => {
  const base = resolveFieldHighlight('cut_length', graph)!; // measures 331.4 mm

  it('agrees when the input holds the measured value within rounding', () => {
    expect(checkAgainstInput(base, 331.4).reconciles).toBe(true);
    expect(checkAgainstInput(base, '331.6').reconciles).toBe(true);
  });

  it('flags an edited or stale input, saying what each side holds', () => {
    const r = checkAgainstInput(base, 400);
    expect(r.reconciles).toBe(false);
    expect(r.note).toBe('the input holds 400 but these faces measure 331.4 mm');
  });

  it('counts must match exactly', () => {
    const pierces = resolveFieldHighlight('pierce_count', { ...graph, measurements: { pierce_count: { value: 128, unit: 'count', reconciles: true, occurrences: [{ face_ids: [1] }] } } })!;
    expect(checkAgainstInput(pierces, 128).reconciles).toBe(true);
    expect(checkAgainstInput(pierces, 127).reconciles).toBe(false);
  });

  it('an empty or non-numeric input is not compared', () => {
    expect(checkAgainstInput(base, '')).toBe(base);
    expect(checkAgainstInput(base, undefined)).toBe(base);
  });
});

describe('bend line length', () => {
  const withBends: FeatureGraphV2 = {
    metadata: { face_map: [] },
    features: [],
    measurements: {
      bend_line_length: {
        value: 150, unit: 'mm', reconciles: true,
        occurrences: [
          { face_ids: [1, 2], length_mm: 30 },
          { face_ids: [3, 4], length_mm: 90 },
          { face_ids: [5, 6], length_mm: 30 },
        ],
      },
    },
  };

  it('highlights and measures the longest single bend, not the sum', () => {
    const h = resolveFieldHighlight('bend_line_length', withBends)!;
    expect(h.node.occurrences.flatMap((o) => o.face_ids)).toEqual([3, 4]);
    expect(h.measured).toEqual({ value: 90, unit: 'mm', label: 'longest of 3 bends' });
    expect(checkAgainstInput(h, 90).reconciles).toBe(true);
    expect(checkAgainstInput(h, 150).reconciles).toBe(false);
  });

  it('an analysis without the recorded set still resolves from its bend features', () => {
    const legacy: FeatureGraphV2 = {
      metadata: { face_map: [] },
      features: [{
        id: 'bend_r1', feature_type: 'StraightBend',
        occurrences: [
          { centroid: [0, 0, 0], face_ids: [1, 2], bend_length_mm: 30 },
          { centroid: [0, 0, 0], face_ids: [3, 4], bend_length_mm: 66 },
        ],
      }],
    };
    const h = resolveFieldHighlight('bend_line_length', legacy)!;
    expect(h.node.occurrences.flatMap((o) => o.face_ids)).toEqual([3, 4]);
    expect(h.measured.value).toBe(66);
    expect(resolveFieldHighlight('bend_line_length', { metadata: { face_map: [] }, features: [] })).toBeNull();
  });
});

describe('whole-part evidence (a casting\'s volume or surface on a graph without measurements)', () => {
  const casting: FeatureGraphV2 = {
    metadata: { face_map: [0, 1, 2].map((face_id) => ({ face_id, tri_start: face_id * 4, tri_count: 4 })) },
    features: [],
  };

  it('the part volume lights every face of the part, says so, and is never compared with the input', () => {
    const h = resolveFieldHighlight('part_volume', casting)!;
    expect(faces(h.node)).toEqual([0, 1, 2]);
    expect(h.measured).toBeNull();
    expect(h.wholePart).toEqual({ faces: 3, label: 'part volume' });
    expect(checkAgainstInput(h, 0.08)).toBe(h);
  });

  it('the part surface lights every face too', () => {
    expect(faces(resolveFieldHighlight('part_surface', casting)!.node)).toEqual([0, 1, 2]);
  });
});

describe('featuresHighlight (a SourceRef naming particular features)', () => {
  const part: FeatureGraphV2 = {
    metadata: { face_map: [] },
    features: [
      { id: 'hole_d4', feature_type: 'SimpleHole', diameter_mm: 4, occurrences: [{ centroid: [0, 0, 0], face_ids: [1, 2] }, { centroid: [1, 0, 0], face_ids: [3, 4] }] },
      { id: 'hole_d2', feature_type: 'SimpleHole', diameter_mm: 2, occurrences: [{ centroid: [2, 0, 0], face_ids: [5] }] },
      { id: 'pocket', feature_type: 'PocketV2', occurrences: [{ centroid: [3, 0, 0], face_ids: [9] }] },
    ],
  };

  it('lights every instance of the named features and nothing else, counting them', () => {
    const h = featuresHighlight({ label: 'holes', features: [{ featureId: 'hole_d4' }, { featureId: 'hole_d2' }] }, part)!;
    expect(faces(h.node)).toEqual([1, 2, 3, 4, 5]);
    expect(h.measured).toEqual({ value: 3, unit: 'count', label: 'holes' });
    expect(checkAgainstInput(h, 3).reconciles).toBe(true);
    expect(checkAgainstInput(h, 5).reconciles).toBe(false);
  });

  it('lights only the named instance when an occurrence is given', () => {
    expect(faces(featuresHighlight({ label: 'one hole', features: [{ featureId: 'hole_d4', occurrenceIndex: 1 }] }, part)!.node)).toEqual([3, 4]);
  });

  it('is null when none of the features is on this graph (re-analysed since): nothing is guessed', () => {
    expect(featuresHighlight({ label: 'gone', features: [{ featureId: 'hole_d9' }] }, part)).toBeNull();
  });

  it('returns the same object for the same graph and ref (memoized dialog rows)', () => {
    const ref = { label: 'holes', features: [{ featureId: 'hole_d2' }] };
    expect(cachedFeaturesHighlight(ref, part)).toBe(cachedFeaturesHighlight(ref, part));
  });
});

describe('featuresHighlight for named faces (a SourceRef of kind faces)', () => {
  const g: FeatureGraphV2 = { metadata: { face_map: [] }, features: [] };

  it('lights exactly those faces, says how many, and is not compared with the input (a length is not a face count)', () => {
    const h = featuresHighlight({ label: 'sharp edges', faceIds: [3, 5, 8] }, g)!;
    expect(faces(h.node)).toEqual([3, 5, 8]);
    expect(h.measured).toBeNull();
    expect(h.faceSet).toEqual({ faces: 3, label: 'sharp edges' });
    expect(checkAgainstInput(h, 1442.7)).toBe(h);
  });

  it('is null for an empty face list', () => {
    expect(featuresHighlight({ label: 'none', faceIds: [] }, g)).toBeNull();
  });
});

describe('highlightableGraph (feature_graph_v2 plus a plastic part\'s recognised features)', () => {
  it('a features ref can name a plastic bundle: its faces light like a feature_graph_v2 entry\'s', () => {
    const stored = {
      feature_graph_v2: { metadata: { face_map: [] }, features: [] } as FeatureGraphV2,
      summary: { plasticFeatureGraph: { items: [{ id: 'bundle-2', feature_type: 'LifterBundle', occurrences: [{ centroid: [1, 2, 3], face_ids: [40, 41] }] }] } },
    };
    const g = highlightableGraph(stored)!;
    expect(faces(featuresHighlight({ label: 'lifter bundles', features: [{ featureId: 'bundle-2' }] }, g)!.node)).toEqual([40, 41]);
    expect(highlightableGraph(stored)).toBe(g);
  });

  it('is null with no stored graph', () => {
    expect(highlightableGraph(null)).toBeNull();
  });
});
