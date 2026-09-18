import { splitWireEdmOccurrences, isRealHeatTreatmentCallout } from '../../../../../../modules/bom-items/costing/machining/operation/wire-edm-routing';

// Pure functions, zero DB dependency — no mocking needed or used, per this
// project's standing rule against mocked-Supabase spec files.
//
// Root-caused 2026-09-18: "Wire EDM" is a real, staged machine category
// (migrations 737/738/753, 6 real machines) with real material cutting
// physics (tblWireEDMing) but had ZERO cost engine. Real, disclosed trigger:
// the same heat-treat-callout signal Jig Grind already uses (a hardened
// slot cannot be conventionally milled any more than a hardened bore can be
// conventionally bored).

function slotFeature(occurrences: Array<{ length_mm?: number | null }>) {
  return { feature_type: 'slot', occurrences };
}

describe('isRealHeatTreatmentCallout', () => {
  it.each([null, undefined, '', 'None', 'none', 'N/A', 'as required', 'Not Required', 'No'])(
    'treats %p as no real callout',
    (v) => {
      expect(isRealHeatTreatmentCallout(v as any)).toBe(false);
    },
  );

  it.each(['Harden and temper to Rc 58-62', 'Case harden 0.5mm deep', 'Anneal'])(
    'treats %p as a real callout',
    (v) => {
      expect(isRealHeatTreatmentCallout(v)).toBe(true);
    },
  );
});

describe('splitWireEdmOccurrences', () => {
  it('returns everything unfiltered, with no candidates, for an empty or missing feature list', () => {
    expect(splitWireEdmOccurrences(null, 'Harden to Rc60')).toEqual({ filteredFeatures: [], wireEdmCandidates: [] });
    expect(splitWireEdmOccurrences(undefined, 'Harden to Rc60')).toEqual({ filteredFeatures: [], wireEdmCandidates: [] });
    expect(splitWireEdmOccurrences([], 'Harden to Rc60')).toEqual({ filteredFeatures: [], wireEdmCandidates: [] });
  });

  it('leaves every slot completely untouched when there is no real heat-treat callout', () => {
    const feature = slotFeature([{ length_mm: 40 }]);
    const result = splitWireEdmOccurrences([feature], 'None');
    expect(result.filteredFeatures).toEqual([feature]);
    expect(result.wireEdmCandidates).toEqual([]);
  });

  it('leaves non-slot features (pocket, keyway, through_hole) completely untouched even with a real callout', () => {
    const pocket = { feature_type: 'pocket', occurrences: [{ length_mm: 40 }] };
    const keyway = { feature_type: 'keyway', occurrences: [{ length_mm: 40, width_mm: 6, depth_mm: 4 }] };
    const result = splitWireEdmOccurrences([pocket, keyway], 'Harden to Rc60');
    expect(result.filteredFeatures).toEqual([pocket, keyway]);
    expect(result.wireEdmCandidates).toEqual([]);
  });

  it('pulls a real slot out entirely and produces one candidate when a real heat-treat callout is present', () => {
    const feature = slotFeature([{ length_mm: 40 }]);
    const result = splitWireEdmOccurrences([feature], 'Harden to Rc60');
    expect(result.wireEdmCandidates).toEqual([{ lengthMm: 40, count: 1 }]);
    expect(result.filteredFeatures).toEqual([]);
  });

  it('groups multiple identical-length slot occurrences into one candidate with count > 1', () => {
    const feature = slotFeature([{ length_mm: 40 }, { length_mm: 40 }]);
    const result = splitWireEdmOccurrences([feature], 'Harden to Rc60');
    expect(result.wireEdmCandidates).toEqual([{ lengthMm: 40, count: 2 }]);
  });

  it('keeps an occurrence with a missing or zero length_mm as a generic slot instead of silently dropping it', () => {
    const feature = slotFeature([{ length_mm: null }, { length_mm: 0 }]);
    const result = splitWireEdmOccurrences([feature], 'Harden to Rc60');
    expect(result.wireEdmCandidates).toEqual([]);
    expect(result.filteredFeatures).toEqual([{ feature_type: 'slot', occurrences: [{ length_mm: null }, { length_mm: 0 }] }]);
  });

  it('splits a feature with BOTH resolvable and unresolvable occurrences correctly', () => {
    const feature = slotFeature([{ length_mm: 40 }, { length_mm: null }]);
    const result = splitWireEdmOccurrences([feature], 'Harden to Rc60');
    expect(result.wireEdmCandidates).toEqual([{ lengthMm: 40, count: 1 }]);
    expect(result.filteredFeatures).toEqual([{ feature_type: 'slot', occurrences: [{ length_mm: null }] }]);
  });
});
