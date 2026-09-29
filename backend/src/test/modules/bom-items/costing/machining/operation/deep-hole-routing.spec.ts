import {
  splitDeepHoleOccurrences,
  resolveDeepHoleRules,
} from '../../../../../../modules/bom-items/costing/machining/operation/deep-hole-routing';

// Pure functions, zero DB dependency — no mocking needed or used.
//
// Routing limits come from memory/Machining/lookup/tblOperationSizeRanges.csv
// (staged by migration 748). These are its real rows for the limits the router
// reads, copied verbatim from that file:
//   Gun Drilling       LowerBound 10    Ratio of L/D
//   Deep Boring        LowerBound 38.1  Minimum diameter
//   Deep Boring Ratio  LowerBound 4     Ratio of L/D
const REFERENCE_ROWS = [
  { OperationName: 'Deep Boring', LowerBound: 38.1, UpperBound: -1, Comment: 'Minimum diameter', ScaleSystem: 'literal' },
  { OperationName: 'Deep Boring Ratio', LowerBound: 4, UpperBound: -1, Comment: 'Ratio of L/D', ScaleSystem: 'literal' },
  { OperationName: 'Deep Drilling', LowerBound: 3, UpperBound: -1, Comment: 'Ratio of L/D', ScaleSystem: 'literal' },
  { OperationName: 'Gun Drilling', LowerBound: 10, UpperBound: -1, Comment: 'Ratio of L/D', ScaleSystem: 'literal' },
];
const RULES = resolveDeepHoleRules(REFERENCE_ROWS).rules!;

function holeFeature(diameterMm: number, depths: number[]) {
  return {
    feature_type: 'SimpleHole', variant: 'through',
    diameter_mm: diameterMm,
    occurrences: depths.map((depth_mm) => ({ depth_mm })),
  };
}

describe('resolveDeepHoleRules', () => {
  it('reads the three limits from the reference rows', () => {
    expect(RULES).toEqual({ gunDrillMinLd: 10, deepBoreMinLd: 4, deepBoreMinDiameterMm: 38.1 });
  });

  it('returns no rules, naming what is missing, when the table is absent', () => {
    const r = resolveDeepHoleRules(null);
    expect(r.rules).toBeNull();
    expect(r.missing).toEqual(['Gun Drilling L/D', 'Deep Boring Ratio L/D', 'Deep Boring minimum diameter']);
  });
});

describe('splitDeepHoleOccurrences', () => {
  it('returns everything unfiltered, with no candidates, for an empty or missing feature list', () => {
    expect(splitDeepHoleOccurrences(null, RULES)).toEqual({ filteredFeatures: [], gunDrillCandidates: [], deepBoreCandidates: [] });
    expect(splitDeepHoleOccurrences(undefined, RULES)).toEqual({ filteredFeatures: [], gunDrillCandidates: [], deepBoreCandidates: [] });
    expect(splitDeepHoleOccurrences([], RULES)).toEqual({ filteredFeatures: [], gunDrillCandidates: [], deepBoreCandidates: [] });
  });

  it('applies no routing at all when the reference limits are unavailable', () => {
    const feature = holeFeature(10, [200]); // L/D 20
    expect(splitDeepHoleOccurrences([feature], null)).toEqual({ filteredFeatures: [feature], gunDrillCandidates: [], deepBoreCandidates: [] });
  });

  it('leaves an ordinary shallow hole completely untouched', () => {
    const feature = holeFeature(10, [15]); // L/D = 1.5
    const result = splitDeepHoleOccurrences([feature], RULES);
    expect(result.filteredFeatures).toEqual([feature]);
    expect(result.gunDrillCandidates).toEqual([]);
    expect(result.deepBoreCandidates).toEqual([]);
  });

  it('keeps a "Deep Drilling" hole (L/D 3-10, under 38.1mm) as ordinary drilling on the part machine', () => {
    const feature = holeFeature(10, [60]); // L/D = 6
    const result = splitDeepHoleOccurrences([feature], RULES);
    expect(result.filteredFeatures).toEqual([feature]);
    expect(result.gunDrillCandidates).toEqual([]);
    expect(result.deepBoreCandidates).toEqual([]);
  });

  it('routes a small hole at the Gun Drilling L/D (>= 10) to Gun Drilling', () => {
    const feature = holeFeature(10, [100]); // L/D = 10
    const result = splitDeepHoleOccurrences([feature], RULES);
    expect(result.gunDrillCandidates).toEqual([{ diameterMm: 10, depthMm: 100, count: 1 }]);
    expect(result.deepBoreCandidates).toEqual([]);
    // Every occurrence was deep -> the feature is dropped entirely, not left
    // behind for the regular "Drill" op to double-count.
    expect(result.filteredFeatures).toEqual([]);
  });

  it('routes a hole in the Deep Boring range (>= 38.1mm, L/D >= 4) to Deep Bore Machine', () => {
    const feature = holeFeature(80, [500]); // L/D = 6.25
    const result = splitDeepHoleOccurrences([feature], RULES);
    expect(result.deepBoreCandidates).toEqual([{ diameterMm: 80, depthMm: 500, count: 1 }]);
    expect(result.gunDrillCandidates).toEqual([]);
  });

  it('prefers Deep Boring when a large hole is in both ranges', () => {
    const feature = holeFeature(40, [500]); // 40mm >= 38.1; L/D 12.5 meets both
    const result = splitDeepHoleOccurrences([feature], RULES);
    expect(result.deepBoreCandidates).toEqual([{ diameterMm: 40, depthMm: 500, count: 1 }]);
    expect(result.gunDrillCandidates).toEqual([]);
  });

  it('splits a feature with BOTH shallow and deep occurrences of the same diameter', () => {
    const feature = holeFeature(10, [15, 15, 120]); // two shallow (L/D 1.5), one gun-drill (L/D 12)
    const result = splitDeepHoleOccurrences([feature], RULES);
    expect(result.gunDrillCandidates).toEqual([{ diameterMm: 10, depthMm: 120, count: 1 }]);
    expect(result.filteredFeatures).toEqual([
      { ...feature, occurrences: [{ depth_mm: 15 }, { depth_mm: 15 }] },
    ]);
  });

  it('averages depth across multiple deep occurrences of the same diameter into one candidate', () => {
    const feature = holeFeature(10, [100, 140]); // both L/D >= 10, avg depth 120
    const result = splitDeepHoleOccurrences([feature], RULES);
    expect(result.gunDrillCandidates).toEqual([{ diameterMm: 10, depthMm: 120, count: 2 }]);
  });

  it('leaves non-plain-hole feature types completely untouched, even with a deep depth_mm', () => {
    const pocket = { feature_type: 'PocketV2', variant: 'default', diameter_mm: 0, occurrences: [{ depth_mm: 500 }] };
    const tapped = { feature_type: 'SimpleHole', variant: 'threaded', diameter_mm: 10, occurrences: [{ depth_mm: 500 }] };
    const result = splitDeepHoleOccurrences([pocket, tapped], RULES);
    expect(result.filteredFeatures).toEqual([pocket, tapped]);
    expect(result.gunDrillCandidates).toEqual([]);
    expect(result.deepBoreCandidates).toEqual([]);
  });

  it('just under the Gun Drilling L/D stays ordinary drilling', () => {
    const feature = holeFeature(10, [99]); // L/D = 9.9
    const result = splitDeepHoleOccurrences([feature], RULES);
    expect(result.filteredFeatures).toEqual([feature]);
    expect(result.gunDrillCandidates).toEqual([]);
  });

  it('handles multiple independent hole features in one pass, preserving unrelated features', () => {
    const shallow = holeFeature(6, [10]);
    const deepSmall = holeFeature(8, [100]);   // L/D 12.5
    const deepLarge = holeFeature(100, [700]); // 100mm, L/D 7
    const result = splitDeepHoleOccurrences([shallow, deepSmall, deepLarge], RULES);
    expect(result.filteredFeatures).toEqual([shallow]);
    expect(result.gunDrillCandidates).toEqual([{ diameterMm: 8, depthMm: 100, count: 1 }]);
    expect(result.deepBoreCandidates).toEqual([{ diameterMm: 100, depthMm: 700, count: 1 }]);
  });

  it('skips a feature with no real diameter or no occurrences rather than guessing', () => {
    const noDiam = { feature_type: 'SimpleHole', variant: 'through', diameter_mm: 0, occurrences: [{ depth_mm: 100 }] };
    const noOcc = { feature_type: 'SimpleHole', variant: 'through', diameter_mm: 10, occurrences: [] };
    const result = splitDeepHoleOccurrences([noDiam, noOcc], RULES);
    expect(result.filteredFeatures).toEqual([noDiam, noOcc]);
    expect(result.gunDrillCandidates).toEqual([]);
  });
});
