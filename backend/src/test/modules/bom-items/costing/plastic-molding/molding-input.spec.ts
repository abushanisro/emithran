import { buildMoldingCommonInput, moldingSignals, partBboxLongestFirst } from '../../../../../modules/bom-items/costing/plastic-molding/molding-input';

const rate = (machineClass: string) => ({ rate: 10, source: 'mhr_database', machineClass }) as never;

describe('partBboxLongestFirst', () => {
  it('orders the three sides longest first, and reads a side CAD did not measure as 0', () => {
    expect(partBboxLongestFirst({ maxLength: 50, maxWidth: 170, maxHeight: 90 })).toEqual([170, 90, 50]);
    expect(partBboxLongestFirst({ maxLength: 120 })).toEqual([120, 0, 0]);
    expect(partBboxLongestFirst({})).toEqual([0, 0, 0]);
  });
});

describe('moldingSignals', () => {
  it('the footprint is the two longest sides, only when CAD measured both', () => {
    expect(moldingSignals({}, [100, 50, 20]).projectedAreaMm2).toBe(5000);
    expect(moldingSignals({}, [100, 0, 0]).projectedAreaMm2).toBeNull();
  });

  it('a signal CAD did not produce is null, never 0 or a guess', () => {
    const s = moldingSignals({}, [0, 0, 0]);
    expect(s).toMatchObject({
      wallThicknessMinMm: null, wallThicknessMaxMm: null, ribCount: null, bossCount: null, insertCount: null, slideBundleCount: null, partingComplexity: null,
    });
    expect(moldingSignals({ wallThicknessMinMm: 0, ribCount: 0, blindFeatureCount: 0 }, [0, 0, 0])).toMatchObject({ wallThicknessMinMm: null, ribCount: null, bossCount: null });
  });

  it('the real rib count wins; the pocket-floor proxy stands in only when there is none', () => {
    expect(moldingSignals({ ribCount: 6, ribCountProxy: 2 }, [1, 1, 1]).ribCount).toBe(6);
    expect(moldingSignals({ ribCount: 0, ribCountProxy: 2 }, [1, 1, 1]).ribCount).toBe(2);
  });

  it('measured values pass through', () => {
    expect(moldingSignals({ wallThicknessMinMm: 0.35, wallThicknessMaxMm: 6, blindFeatureCount: 4, insertCandidateCount: 1, partingComplexity: 50 }, [1, 1, 1]))
      .toMatchObject({ wallThicknessMinMm: 0.35, wallThicknessMaxMm: 6, bossCount: 4, insertCount: 1, partingComplexity: 50 });
  });
});

describe('buildMoldingCommonInput', () => {
  const facts = {
    item: { volume: 18673.86, surfaceArea: 25670.66, maxLength: 48.3, maxWidth: 170.5, maxHeight: 93.6 },
    summary: { wallThicknessNominalMm: 1.5, ribCount: 3 },
    grade: 'Generic ABS, 30% Glass', family: 'plastic_molded', location: 'USA', batchSize: 250, annualVolume: 1000, productionLifeYears: 5,
    material: { materialCostPerKg: 3.9, materialDensityKgM3: 1280, materialSource: 'db' as const, materialType: 'ABS', materialStockForm: null, materialMatlState: null },
    plasticReference: { plasticReference: null, plasticReferenceMissing: [] },
    currencySymbol: '$', usdToLocal: 1, deburrRate: rate('deburring'), inspectionRate: rate('cmm'), cavityCountOverride: null,
  };

  it('carries the part, its sorted box, the wall and the scenario, and leaves the press to the caller', () => {
    const input = buildMoldingCommonInput(facts);
    expect(input).toMatchObject({
      volume: 18673.86, surfaceArea: 25670.66, wallThicknessNominalMm: 1.5, materialGrade: 'Generic ABS, 30% Glass', batchSize: 250, annualVolume: 1000,
      productionLifeYears: 5, bboxMaxMm: 170.5, bboxMidMm: 93.6,
    });
    expect(input.signals?.projectedAreaMm2).toBeCloseTo(170.5 * 93.6, 6);
    for (const press of ['mhrRate', 'machineClampTonnes', 'machineShotCapacityG', 'pressTiming', 'goodPartYield']) expect(press in input).toBe(false);
  });

  it('a part with no CAD wall reads 0 (the engine reports the cycle time as not derivable), and a missing volume 0', () => {
    expect(buildMoldingCommonInput({ ...facts, summary: {}, item: {} })).toMatchObject({ wallThicknessNominalMm: 0, volume: 0, surfaceArea: 0, bboxMaxMm: 0 });
  });

  it('no annual volume is left undefined, not 0, so tooling amortisation sees it as unknown', () => {
    expect(buildMoldingCommonInput({ ...facts, annualVolume: null }).annualVolume).toBeUndefined();
  });
});
