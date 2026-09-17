import {
  splitDeepHoleOccurrences,
  DEEP_HOLE_LD_THRESHOLD,
  GUN_DRILL_MAX_DIAMETER_MM,
} from '../../../../../../modules/bom-items/costing/machining/operation/deep-hole-routing';

// Pure functions, zero DB dependency — no mocking needed or used, per this
// project's standing rule against mocked-Supabase spec files.
//
// Root-caused live (2026-09-18): the Machining Process page lists real "Gun
// Drill" and "Deep Bore Machine" categories (real machine fleets, real
// tblGunDrilling/deep_bore_drill_lookup physics already staged) but neither
// had a cost engine — every hole was routed through the regular CNC "Drill"
// op regardless of how deep it was. cad-engine's own cnc_feature_recognizer.py
// already documents the real threshold ("L/D > 5 needs parabolic-flute or
// gun drilling"); this module recomputes that ratio directly from the same
// real depth_mm/diameter_mm fields operation-sequencer.ts already trusts.

function holeFeature(diameterMm: number, depths: number[]) {
  return {
    feature_type: 'through_hole',
    diameter_mm: diameterMm,
    occurrences: depths.map((depth_mm) => ({ depth_mm })),
  };
}

describe('splitDeepHoleOccurrences', () => {
  it('returns everything unfiltered, with no candidates, for an empty or missing feature list', () => {
    expect(splitDeepHoleOccurrences(null)).toEqual({ filteredFeatures: [], gunDrillCandidates: [], deepBoreCandidates: [] });
    expect(splitDeepHoleOccurrences(undefined)).toEqual({ filteredFeatures: [], gunDrillCandidates: [], deepBoreCandidates: [] });
    expect(splitDeepHoleOccurrences([])).toEqual({ filteredFeatures: [], gunDrillCandidates: [], deepBoreCandidates: [] });
  });

  it('leaves an ordinary shallow hole (L/D well under the threshold) completely untouched', () => {
    const feature = holeFeature(10, [15]); // L/D = 1.5
    const result = splitDeepHoleOccurrences([feature]);
    expect(result.filteredFeatures).toEqual([feature]);
    expect(result.gunDrillCandidates).toEqual([]);
    expect(result.deepBoreCandidates).toEqual([]);
  });

  it(`routes a small-diameter deep hole (L/D > ${DEEP_HOLE_LD_THRESHOLD}, diameter <= ${GUN_DRILL_MAX_DIAMETER_MM}mm) to Gun Drilling`, () => {
    const feature = holeFeature(10, [60]); // L/D = 6 > 5, diameter 10mm <= 50mm
    const result = splitDeepHoleOccurrences([feature]);
    expect(result.gunDrillCandidates).toEqual([{ diameterMm: 10, depthMm: 60, count: 1 }]);
    expect(result.deepBoreCandidates).toEqual([]);
    // Every occurrence was deep -> the feature is dropped entirely, not
    // left behind for the regular "Drill" op to double-count.
    expect(result.filteredFeatures).toEqual([]);
  });

  it(`routes a large-diameter deep hole (diameter > ${GUN_DRILL_MAX_DIAMETER_MM}mm) to Deep Bore Machine instead`, () => {
    const feature = holeFeature(80, [500]); // L/D = 6.25 > 5, diameter 80mm > 50mm
    const result = splitDeepHoleOccurrences([feature]);
    expect(result.deepBoreCandidates).toEqual([{ diameterMm: 80, depthMm: 500, count: 1 }]);
    expect(result.gunDrillCandidates).toEqual([]);
  });

  it('splits a feature with BOTH shallow and deep occurrences of the same diameter — a part with one unusually deep hole among ordinary ones', () => {
    const feature = holeFeature(10, [15, 15, 60]); // two shallow (L/D 1.5), one deep (L/D 6)
    const result = splitDeepHoleOccurrences([feature]);
    expect(result.gunDrillCandidates).toEqual([{ diameterMm: 10, depthMm: 60, count: 1 }]);
    // The two shallow occurrences remain, still a real "through_hole" feature
    // for buildOperationSequence to emit its regular "Drill" op for.
    expect(result.filteredFeatures).toEqual([
      { ...feature, occurrences: [{ depth_mm: 15 }, { depth_mm: 15 }] },
    ]);
  });

  it('averages depth across multiple deep occurrences of the same diameter into one candidate', () => {
    const feature = holeFeature(10, [60, 100]); // both deep, avg depth 80
    const result = splitDeepHoleOccurrences([feature]);
    expect(result.gunDrillCandidates).toEqual([{ diameterMm: 10, depthMm: 80, count: 2 }]);
  });

  it('leaves non-plain-hole feature types (pocket, tapped_hole, counterbore) completely untouched, even with a deep depth_mm', () => {
    const pocket = { feature_type: 'pocket', diameter_mm: 0, occurrences: [{ depth_mm: 500 }] };
    const tapped = { feature_type: 'tapped_hole', diameter_mm: 10, occurrences: [{ depth_mm: 500 }] };
    const result = splitDeepHoleOccurrences([pocket, tapped]);
    expect(result.filteredFeatures).toEqual([pocket, tapped]);
    expect(result.gunDrillCandidates).toEqual([]);
    expect(result.deepBoreCandidates).toEqual([]);
  });

  it('exactly at the L/D threshold does not route to a deep-hole machine (strictly greater than, not >=)', () => {
    const feature = holeFeature(10, [50]); // L/D = 5.0 exactly
    const result = splitDeepHoleOccurrences([feature]);
    expect(result.filteredFeatures).toEqual([feature]);
    expect(result.gunDrillCandidates).toEqual([]);
  });

  it('handles multiple independent hole features in one pass, preserving unrelated features', () => {
    const shallow = holeFeature(6, [10]);
    const deepSmall = holeFeature(8, [60]);
    const deepLarge = holeFeature(100, [700]);
    const result = splitDeepHoleOccurrences([shallow, deepSmall, deepLarge]);
    expect(result.filteredFeatures).toEqual([shallow]);
    expect(result.gunDrillCandidates).toEqual([{ diameterMm: 8, depthMm: 60, count: 1 }]);
    expect(result.deepBoreCandidates).toEqual([{ diameterMm: 100, depthMm: 700, count: 1 }]);
  });

  it('skips a feature with no real diameter or no occurrences rather than guessing', () => {
    const noDiam = { feature_type: 'through_hole', diameter_mm: 0, occurrences: [{ depth_mm: 100 }] };
    const noOcc = { feature_type: 'through_hole', diameter_mm: 10, occurrences: [] };
    const result = splitDeepHoleOccurrences([noDiam, noOcc]);
    expect(result.filteredFeatures).toEqual([noDiam, noOcc]);
    expect(result.gunDrillCandidates).toEqual([]);
  });
});
