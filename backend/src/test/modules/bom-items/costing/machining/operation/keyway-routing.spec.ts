import { splitKeywayOccurrences } from '../../../../../../modules/bom-items/costing/machining/operation/keyway-routing';

// Pure function, zero DB dependency — no mocking needed or used, per this
// project's standing rule against mocked-Supabase spec files.
//
// Root-caused 2026-09-17: cnc_feature_recognizer.py already detects "keyway"
// as its own real, distinct feature type, but it was being deliberately
// collapsed into generic "slot" output because operation-sequencer.ts had no
// dedicated keyway case. That collapse is now removed on the CAD side
// (geo_v44); this module pulls real keyway occurrences out of what reaches
// buildOperationSequence entirely, so they are costed by a dedicated Keyway
// Broaching line instead of falling into the sequencer's generic
// volume-based default-case costing (the wrong physics for a broached slot).

function keywayFeature(occurrences: Array<{ length_mm?: number | null; width_mm?: number | null; depth_mm?: number | null }>) {
  return { feature_type: 'Keyway', variant: 'default', occurrences };
}

describe('splitKeywayOccurrences', () => {
  it('returns everything unfiltered, with no candidates, for an empty or missing feature list', () => {
    expect(splitKeywayOccurrences(null)).toEqual({ filteredFeatures: [], keywayCandidates: [] });
    expect(splitKeywayOccurrences(undefined)).toEqual({ filteredFeatures: [], keywayCandidates: [] });
    expect(splitKeywayOccurrences([])).toEqual({ filteredFeatures: [], keywayCandidates: [] });
  });

  it('leaves non-keyway features (pocket, slot, through_hole) completely untouched', () => {
    const pocket = { feature_type: 'PocketV2', variant: 'default', occurrences: [{ depth_mm: 5 }] };
    const slot = { feature_type: 'Slot', variant: 'straight', occurrences: [{ depth_mm: 3, width_mm: 6, length_mm: 25 }] };
    const result = splitKeywayOccurrences([pocket, slot]);
    expect(result.filteredFeatures).toEqual([pocket, slot]);
    expect(result.keywayCandidates).toEqual([]);
  });

  it('pulls a real keyway feature out entirely and produces one candidate', () => {
    const feature = keywayFeature([{ length_mm: 40, width_mm: 6, depth_mm: 4 }]);
    const result = splitKeywayOccurrences([feature]);
    expect(result.keywayCandidates).toEqual([{ lengthMm: 40, widthMm: 6, depthMm: 4, count: 1 }]);
    expect(result.filteredFeatures).toEqual([]);
  });

  it('groups multiple identical-dimension keyway occurrences into one candidate with count > 1', () => {
    const feature = keywayFeature([
      { length_mm: 40, width_mm: 6, depth_mm: 4 },
      { length_mm: 40, width_mm: 6, depth_mm: 4 },
    ]);
    const result = splitKeywayOccurrences([feature]);
    expect(result.keywayCandidates).toEqual([{ lengthMm: 40, widthMm: 6, depthMm: 4, count: 2 }]);
  });

  it('keeps distinct-dimension keyway occurrences as separate candidates', () => {
    const feature = keywayFeature([
      { length_mm: 40, width_mm: 6, depth_mm: 4 },
      { length_mm: 60, width_mm: 8, depth_mm: 5 },
    ]);
    const result = splitKeywayOccurrences([feature]);
    expect(result.keywayCandidates).toEqual([
      { lengthMm: 40, widthMm: 6, depthMm: 4, count: 1 },
      { lengthMm: 60, widthMm: 8, depthMm: 5, count: 1 },
    ]);
  });

  it('keeps an occurrence with real dims missing (e.g. a stale pre-geo_v44 cache) as a generic feature instead of silently dropping it', () => {
    const feature = keywayFeature([{ width_mm: 6, depth_mm: 4 }]); // no length_mm
    const result = splitKeywayOccurrences([feature]);
    expect(result.keywayCandidates).toEqual([]);
    expect(result.filteredFeatures).toEqual([{ feature_type: 'Keyway', variant: 'default', occurrences: [{ width_mm: 6, depth_mm: 4 }] }]);
  });

  it('splits a feature with BOTH resolvable and unresolvable occurrences correctly', () => {
    const feature = keywayFeature([
      { length_mm: 40, width_mm: 6, depth_mm: 4 },
      { width_mm: 6, depth_mm: 4 }, // missing length_mm
    ]);
    const result = splitKeywayOccurrences([feature]);
    expect(result.keywayCandidates).toEqual([{ lengthMm: 40, widthMm: 6, depthMm: 4, count: 1 }]);
    expect(result.filteredFeatures).toEqual([
      { feature_type: 'Keyway', variant: 'default', occurrences: [{ width_mm: 6, depth_mm: 4 }] },
    ]);
  });

  it('handles multiple independent features in one pass, preserving unrelated ones', () => {
    const keyway = keywayFeature([{ length_mm: 40, width_mm: 6, depth_mm: 4 }]);
    const pocket = { feature_type: 'PocketV2', variant: 'default', occurrences: [{ depth_mm: 5 }] };
    const secondKeyway = keywayFeature([{ length_mm: 20, width_mm: 4, depth_mm: 3 }]);
    const result = splitKeywayOccurrences([keyway, pocket, secondKeyway]);
    expect(result.filteredFeatures).toEqual([pocket]);
    expect(result.keywayCandidates).toEqual([
      { lengthMm: 40, widthMm: 6, depthMm: 4, count: 1 },
      { lengthMm: 20, widthMm: 4, depthMm: 3, count: 1 },
    ]);
  });

  it('matches only the exact reference feature type "Keyway" — no case-folding of off-vocabulary strings', () => {
    const offVocabulary = { feature_type: 'KEYWAY', occurrences: [{ length_mm: 20, width_mm: 4, depth_mm: 3 }] };
    const result = splitKeywayOccurrences([offVocabulary]);
    expect(result.keywayCandidates).toEqual([]);
    expect(result.filteredFeatures).toEqual([offVocabulary]);
  });
});
