import { buildDesignGuidance, FEW_FEATURE_SETUP_LIMIT, type DesignGuidanceInput, type GuidanceFeature, type ReviewItem } from '../../../../../modules/bom-items/costing/shared/design-guidance';

const RULE = { perpendicularCountFor3AM: 4, maxOblique4AMSetups: 0, allowedAngleDeviationDeg: 0 };
const hole = (id: string, d: number, axes: number[][]): GuidanceFeature => ({
  id, feature_type: 'SimpleHole', variant: 'blind', diameter_mm: d,
  occurrences: axes.map((tool_axis, i) => ({ face_ids: [i], tool_axis, tool_axis_bidirectional: false })),
});
const round = (id: string, radii: number[]): GuidanceFeature => ({ id, feature_type: 'Edge', variant: 'round', occurrences: radii.map((radius_mm, i) => ({ face_ids: [100 + i], radius_mm })) });
const Z = [0, 0, 1];
const X = [1, 0, 0];

const base = (over: Partial<DesignGuidanceInput> = {}): DesignGuidanceInput => ({
  family: 'milled', processGroup: 'Machining', machined: true,
  features: [hole('h4', 4, [Z, Z, Z, Z, Z, Z]), hole('h6', 6, [X]), hole('h4b', 4, [Z]), round('r', [2, 2, 3])],
  findings: [], findingsReason: null,
  material: {
    name: 'Aluminum, ANSI 6061', currency: 'USD', row: { pricePerKg: 6, densityKgM3: 2700 }, volumeMm3: 10000,
    comparables: [{ pricePerKg: 1, densityKgM3: 7850 }, { pricePerKg: 6, densityKgM3: 2700 }, { pricePerKg: 40, densityKgM3: 4500 }, { pricePerKg: null, densityKgM3: 1000 }],
    comparedGroups: ['Machining'],
  },
  thickness: { partMinMm: 1, partMaxMm: 4, recommendedMinMm: 0.8, recommendedMaxMm: null, source: 'tblMachiningMinWall (aluminum)', reasons: { max: 'no maximum' }, items: [] },
  moldTooling: null, routing: ['3 Axis Mill', 'Deburring'], utilizationPct: 25,
  secondaryMachining: null, secondaryMachiningReason: null, toleranced: [], setupRule: RULE, nonStandardHoles: 'none',
  ...over,
});

describe('buildDesignGuidance', () => {
  it('prices a unit of volume as price x density and places it among the comparable materials', () => {
    const g = buildDesignGuidance(base());
    // 6 USD/kg x 2700 kg/m3 = 16200 USD/m3 = 0.0162 USD/cm3; the range is over the rows that have both a price and a density.
    expect(g.material.costPerCm3).toEqual({ value: 0.0162, min: 0.0079, max: 0.18 });
    // 10 cm3: 0.027 kg in this material, 0.01 kg in the lightest (the row with no price still has a density), 0.0785 kg in the heaviest.
    expect(g.material.massKg).toEqual({ value: 0.027, min: 0.01, max: 0.0785 });
    expect(g.material.comparedWith).toBe(4);
  });

  it('says why when the material is not a library row, and still gives the range', () => {
    const g = buildDesignGuidance(base({ material: { ...base().material, row: null } }));
    expect(g.material.costPerCm3.value).toBeNull();
    expect(g.material.costPerCm3.max).toBe(0.18);
    expect(g.notModelled.materialValue).toMatch(/not one row/);
  });

  it('groups the features into setups by their tool axis and counts the ones that reach few features', () => {
    const g = buildDesignGuidance(base());
    expect(g.setups).toMatchObject({ count: 2, perpendicular: 2, oblique: 0, fewFeatureSetups: 1, fewFeatureLimit: FEW_FEATURE_SETUP_LIMIT });
    expect(g.setups!.items.map((i) => i.label)).toEqual(['Setup 1: +Z · 7 features', 'Setup 2: +X · 1 feature']);
    expect(g.setups!.items[1]!.occurrences).toEqual([{ featureId: 'h6', occurrenceIndex: 0 }]);
  });

  it('lists each distinct hole diameter and fillet radius once, with its instances', () => {
    const g = buildDesignGuidance(base());
    expect(g.holesAndFillets!.holeDiametersMm).toEqual([4, 6]);
    expect(g.holesAndFillets!.holeItems.map((i) => i.label)).toEqual(['Ø4 mm × 7', 'Ø6 mm × 1']);
    expect(g.holesAndFillets!.filletRadiiMm).toEqual([2, 3]);
    expect(g.holesAndFillets!.filletItems[0]).toMatchObject({ label: 'R2 mm × 2', faces: [100, 101] });
    expect(g.holesAndFillets!.nonStandardTools).toBe(0);
  });

  it('counts the non-standard tools as the distinct diameters the drill check flagged', () => {
    const flagged: ReviewItem = { label: '1 hole is not a standard drill size', detail: null, severity: 'minor', occurrences: [{ featureId: 'h6', occurrenceIndex: 0 }], faces: [0] };
    const g = buildDesignGuidance(base({ nonStandardHoles: flagged }));
    expect(g.holesAndFillets!.nonStandardTools).toBe(1);
    expect(buildDesignGuidance(base({ nonStandardHoles: null })).notModelled.nonStandardTools).toBeDefined();
  });

  it('reports the machined part: every feature is machined and the scrap is what the stock loses', () => {
    const g = buildDesignGuidance(base());
    expect(g.machining).toMatchObject({ routing: '3 Axis Mill → Deburring', scrapPct: 75, machinedFeatures: 11 });
    expect(g.moldTooling).toBeNull();
    expect(g.notModelled.drivingMachining).toMatch(/Every feature of a machined part/);
  });

  it('without an applied cost the routing and the scrap are null with the reason, never zero', () => {
    const g = buildDesignGuidance(base({ routing: null, utilizationPct: null }));
    expect(g.machining).toMatchObject({ routing: null, scrapPct: null });
    expect(g.notModelled.routing).toMatch(/apply the scenario/);
    expect(g.notModelled.machiningScrap).toBeDefined();
  });

  it('on a cast part reads the setups and hole sizes from the features left to machining only', () => {
    const needs: ReviewItem = { label: 'SimpleHole:1', detail: 'position 0.05 not held', severity: null, occurrences: [{ featureId: 'h6', occurrenceIndex: 0 }], faces: [0] };
    const g = buildDesignGuidance(base({
      family: 'die_cast', processGroup: 'Die Casting', machined: false, utilizationPct: 90,
      secondaryMachining: { items: [needs], finishingItems: [] }, moldTooling: { slides: 2, lifters: null, cores: 1, liftersReason: 'no lifters', items: [] },
    }));
    expect(g.machining).toMatchObject({ machinedFeatures: 1, scrapPct: null });
    expect(g.setups).toMatchObject({ count: 1, fewFeatureSetups: 1 });
    expect(g.holesAndFillets!.holeDiametersMm).toEqual([6]);
    expect(g.holesAndFillets!.filletRadiiMm).toEqual([]);
    expect(g.tolerances).toMatchObject({ drivingMachining: 1, drivingFinishing: 0 });
    expect(g.moldTooling).toMatchObject({ slides: 2, cores: 1, lifters: null });
    expect(g.notModelled.lifters).toBe('no lifters');
  });

  it('a molded part with nothing left to machining has no machining, setup or hole panel', () => {
    const g = buildDesignGuidance(base({ family: 'plastic_molded', processGroup: 'Plastic Molding', machined: false, secondaryMachining: null, secondaryMachiningReason: 'not assessed', routing: [] }));
    expect(g.machining).toBeNull();
    expect(g.setups).toBeNull();
    expect(g.holesAndFillets).toBeNull();
    expect(g.notModelled.drivingMachining).toBe('not assessed');
  });

  it('gives the wall ratio and the reason for a limit that is not staged', () => {
    const g = buildDesignGuidance(base());
    expect(g.thickness).toMatchObject({ partMinMm: 1, partMaxMm: 4, maxMinRatio: 4, recommendedMinMm: 0.8, recommendedMaxMm: null });
    expect(g.notModelled.thicknessRecommendedMax).toBe('no maximum');
    expect(g.notModelled.thicknessRecommendedMin).toBeUndefined();
  });

  it('with no DFM engine for the process the cost drivers are unknown, not zero', () => {
    const g = buildDesignGuidance(base({ findings: null, findingsReason: 'not modelled yet' }));
    expect(g.costDrivers.count).toBeNull();
    expect(g.notModelled.costDrivers).toBe('not modelled yet');
  });
});
