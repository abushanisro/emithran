import { plasticCostDrivers, type PlasticCostDriverFacts } from '../../../../../modules/bom-items/costing/plastic-molding/plastic-cost-drivers';

// The Cost Drivers panel of a molded part: the CAD quantities the molding cost model reads, and what it does with each. The part is the Back cover (18,673.86 mm3, 170.5 x
// 93.6 x 48.3 mm, 1.5 mm nominal wall) as its analysis reported it.

const graph = (items: Array<{ feature_type: string }>) => ({ schema: 'plastic_feature_graph_v1', items, not_yet_recognized: ['SharpEdge'] }) as never;
const facts = (over: Partial<PlasticCostDriverFacts['summary']> = {}): PlasticCostDriverFacts => ({
  volumeMm3: 18_673.86, surfaceAreaMm2: 25_670.66, boundingBox: { length: 93.6, width: 170.5, height: 48.3 },
  summary: {
    wallThicknessNominalMm: 1.5, wallThicknessMinMm: 0.35, wallThicknessMaxMm: 6, ribCount: 0, ribCountProxy: 129, blindFeatureCount: 0, insertCandidateCount: 0, partingComplexity: 0.5,
    holeCount: 28, holeDiameters: [1.8, 1.8, 2, 2, 2.3, 3.3], filletCount: 10, undraftedFaceCount: 15, draftedFaceCount: 0, avgDraftAngleDeg: 0, undercutFaceCount: 21,
    plasticFeatureGraph: graph([{ feature_type: 'Void' }, { feature_type: 'Void' }, { feature_type: 'LifterBundle' }, { feature_type: 'LifterBundle' }, { feature_type: 'SimpleHole' }]),
    ...over,
  },
});
const by = (d: ReturnType<typeof plasticCostDrivers>) => Object.fromEntries(d.map((x) => [x.name, x]));

describe('plasticCostDrivers', () => {
  it('lists the CAD quantities the cost model reads, with the values the analysis measured', () => {
    const d = by(plasticCostDrivers(facts()));
    expect(d['Part volume']).toMatchObject({ value: 18_673.86, unit: 'mm³', use: 'priced', evidence: 'part_volume', group: 'Material and shot' });
    expect(d['Nominal wall thickness']).toMatchObject({ value: 1.5, use: 'priced', evidence: 'wall_thickness', group: 'Cycle time' });
    // the footprint of the two longest sides, whichever way the box is given
    expect(d['Footprint (two longest sides)']).toMatchObject({ value: 170.5 * 93.6, use: 'priced', group: 'Press and mold' });
    expect(d['Parting complexity']).toMatchObject({ value: 0.5, use: 'priced' });
  });

  it('counts side-action features from the recognised graph and says slides and lifters are not priced', () => {
    const d = by(plasticCostDrivers(facts()));
    expect(d['Undercut features']).toMatchObject({ value: 2, use: 'priced' });
    expect(d['Slide-or-lifter bundles']).toMatchObject({ value: 2, use: 'not_priced' });
    expect(d['Slide bundles']).toBeUndefined();
  });

  it('says what is not read: holes and finishing are not priced, the findings are findings', () => {
    const d = by(plasticCostDrivers(facts()));
    expect(d['Holes']).toMatchObject({ value: 28, use: 'dfm' });
    expect(d['Distinct hole sizes']).toMatchObject({ value: 4, use: 'dfm' });
    expect(d['Surface area']).toMatchObject({ use: 'not_priced' });
    expect(d['Undrafted faces']).toMatchObject({ value: 15, use: 'dfm' });
    expect(d['Average draft angle']).toMatchObject({ value: 0, use: 'dfm' });
  });

  it('falls back to the draft analysis face count when the graph cannot count features (an engine that did not look for voids)', () => {
    const d = by(plasticCostDrivers(facts({ plasticFeatureGraph: { schema: 'plastic_feature_graph_v1', items: [], not_yet_recognized: ['Void'] } as never })));
    expect(d['Undercut faces']).toMatchObject({ value: 21 });
    expect(d['Undercut features']).toBeUndefined();
  });

  it('leaves out what the analysis did not measure (never a 0)', () => {
    const d = by(plasticCostDrivers({ volumeMm3: null, surfaceAreaMm2: undefined, boundingBox: null, summary: { wallThicknessNominalMm: 0, partingComplexity: null } }));
    expect(Object.keys(d)).toEqual([]);
  });

  it('every driver says what the cost model does with it and is in a section', () => {
    for (const d of plasticCostDrivers(facts())) {
      expect(d.feeds.length).toBeGreaterThan(10);
      expect(['priced', 'not_priced', 'dfm']).toContain(d.use);
      expect(d.group).toBeTruthy();
      expect(d.quantity).toBe(d.value);
    }
  });
});
