// Phase 1 (real thermal + cure-time data) regression tests.
//
// Scope: lookupResinProps / computeCycleTime's real-per-grade-data threading
// (RealResinInputs) over the pre-existing, UNCHANGED RESIN_THERMAL_TABLE
// fallback and Menges formula. Proves: (a) the formula is untouched — same
// output as before when no real data is supplied, (b) real inputs are
// actually consumed field-by-field, not all-or-nothing, (c) alpha is only
// derived from real data when all three physics inputs are present, never a
// partial/guessed derivation, (d) vFront is never overridden (out of Phase 1
// scope by design).
//
// Run: npm run test -- cycle-time

import {
  lookupResinProps,
  computeCycleTime,
  computeFillTimeSec,
  RESIN_THERMAL_TABLE,
  type RealResinInputs,
} from '../../../../../../modules/bom-items/costing/plastic-molding/process/cycle-time';

describe('lookupResinProps — fallback table (unchanged, no real data)', () => {
  it('known grade, no real data → exact fallback table row', () => {
    const props = lookupResinProps('ABS');
    expect(props).toEqual(RESIN_THERMAL_TABLE.ABS);
  });

  it('unresolved / null grade → __default__ row', () => {
    const props = lookupResinProps(null);
    expect(props).toEqual(RESIN_THERMAL_TABLE.__default__);
  });

  it('unrecognized grade string → __default__ row', () => {
    const props = lookupResinProps('Some Exotic Unlisted Resin XYZ');
    expect(props).toEqual(RESIN_THERMAL_TABLE.__default__);
  });

  it('real=null is equivalent to omitting real entirely', () => {
    expect(lookupResinProps('PC', null)).toEqual(lookupResinProps('PC'));
  });
});

describe('lookupResinProps — real per-grade data override', () => {
  it('all three thermal fields real → Tm/Tw/Te all overridden, alpha derived from physics identity', () => {
    const real: RealResinInputs = {
      meltingTempC: 250,
      moldTempC: 55,
      ejectionTempC: 90,
      specificHeatMeltJgC: 2.1,          // J/(g·K)
      thermalConductivityMeltWMK: 0.19,  // W/(m·K)
      densityKgM3: 1050,
    };
    const props = lookupResinProps('ABS', real);
    expect(props.Tm).toBe(250);
    expect(props.Tw).toBe(55);
    expect(props.Te).toBe(90);
    // alpha = k / (rho * cp), cp converted J/g.K -> J/kg.K, result m^2/s -> mm^2/s
    const expectedAlpha = (0.19 / (1050 * (2.1 * 1000))) * 1e6;
    expect(props.alpha).toBeCloseTo(expectedAlpha, 6);
    expect(props.alpha).not.toBeCloseTo(RESIN_THERMAL_TABLE.ABS.alpha, 3);
    // vFront is deliberately never overridden by real data (out of Phase 1 scope).
    expect(props.vFront).toBe(RESIN_THERMAL_TABLE.ABS.vFront);
  });

  it('grade with a DIFFERENT real value set produces a DIFFERENT result than the fallback and than another grade\'s real set', () => {
    const realA: RealResinInputs = {
      meltingTempC: 300, moldTempC: 100, ejectionTempC: 140,
      specificHeatMeltJgC: 1.7, thermalConductivityMeltWMK: 0.24, densityKgM3: 1200,
    };
    const realB: RealResinInputs = {
      meltingTempC: 210, moldTempC: 35, ejectionTempC: 80,
      specificHeatMeltJgC: 2.5, thermalConductivityMeltWMK: 0.15, densityKgM3: 900,
    };
    const propsA = lookupResinProps('PC', realA);
    const propsB = lookupResinProps('PC', realB);
    expect(propsA.Tm).not.toBe(propsB.Tm);
    expect(propsA.alpha).not.toBeCloseTo(propsB.alpha, 6);
  });

  it('partial real data (only Tm present) → only Tm overridden, alpha stays the cited fallback (never a partial derivation)', () => {
    const real: RealResinInputs = {
      meltingTempC: 245,
      moldTempC: null,
      ejectionTempC: null,
      specificHeatMeltJgC: null,
      thermalConductivityMeltWMK: null,
      densityKgM3: null,
    };
    const props = lookupResinProps('PP', real);
    expect(props.Tm).toBe(245);
    expect(props.Tw).toBe(RESIN_THERMAL_TABLE.PP.Tw);
    expect(props.Te).toBe(RESIN_THERMAL_TABLE.PP.Te);
    expect(props.alpha).toBe(RESIN_THERMAL_TABLE.PP.alpha);
  });

  it('all-null real object behaves exactly like no real data at all', () => {
    const allNull: RealResinInputs = {
      meltingTempC: null, moldTempC: null, ejectionTempC: null,
      specificHeatMeltJgC: null, thermalConductivityMeltWMK: null, densityKgM3: null,
    };
    expect(lookupResinProps('POM', allNull)).toEqual(lookupResinProps('POM'));
  });

  it('density present but conductivity/specific-heat missing → alpha NOT derived (all three required)', () => {
    const real: RealResinInputs = {
      meltingTempC: null, moldTempC: null, ejectionTempC: null,
      specificHeatMeltJgC: null, thermalConductivityMeltWMK: 0.2, densityKgM3: 1000,
    };
    const props = lookupResinProps('PC', real);
    expect(props.alpha).toBe(RESIN_THERMAL_TABLE.PC.alpha);
  });
});

describe('computeCycleTime — real data threaded end to end, formula untouched', () => {
  const baseInput = {
    wallMm: 3,
    longestBboxMm: 150,
    bboxMidMm: 80,
    volumeMm3: 40_000,
    projectedAreaMm2: 9000,
    grade: 'ABS',
  };

  it('no realResinInputs → identical result to the pre-Phase-1 call shape', () => {
    const withUndefined = computeCycleTime(baseInput);
    const withNull = computeCycleTime({ ...baseInput, realResinInputs: null });
    expect(withNull).toEqual(withUndefined);
  });

  it('real thermal data changes cooling time relative to the fallback table', () => {
    const fallback = computeCycleTime(baseInput);
    const real: RealResinInputs = {
      meltingTempC: 260, moldTempC: 70, ejectionTempC: 100,
      specificHeatMeltJgC: 1.9, thermalConductivityMeltWMK: 0.21, densityKgM3: 1040,
    };
    const withReal = computeCycleTime({ ...baseInput, realResinInputs: real });
    expect(withReal.coolSec).not.toBe(fallback.coolSec);
    expect(withReal.resinProps.Tm).toBe(260);
    // Fill time model is untouched by Phase 1 (vFront never overridden).
    expect(withReal.fillSec).toBe(fallback.fillSec);
  });
});

// Real cavity-count/gate-count fill-time adjustment factors (migration 663,
// injectionTimeAdjustmentFactors.json). Values below are the real source
// table's own numbers, not invented test fixtures.
describe('computeFillTimeSec — real cavity-count/gate-count adjustment factors (migration 663)', () => {
  const props = RESIN_THERMAL_TABLE.ABS;
  // Large enough that the base (pre-adjustment) fill time clears
  // IM_FILL_MIN_SEC (0.5 s) even after the smallest real adjustment factor
  // (0.25) is applied — otherwise the floor would mask the factors being tested.
  const bboxMm = 1000;
  const rawFillSec = () => {
    // Reproduce the pre-factor base model directly (flow-length / vFront)
    // to compute the expected pre-adjustment baseline independently of the
    // function under test.
    const lFlow = bboxMm * 0.60;
    const tFill = lFlow / Math.max(props.vFront, 10);
    return Math.max(0.5, Math.round(tFill * 10) / 10);
  };

  it('defaults (no cavityCount/gatesPerCavity args) apply cavityFactor=1.00 (≤3) and gateFactor=0.60 (1 gate)', () => {
    const base = rawFillSec();
    const result = computeFillTimeSec(bboxMm, props);
    expect(result).toBeCloseTo(Math.max(0.5, Math.round(base * 1.00 * 0.60 * 10) / 10), 5);
  });

  it('8 cavities lands in the ≤8 bucket (factor 1.05), scaling fill time up vs. 1 cavity', () => {
    const base = rawFillSec();
    const oneCavity = computeFillTimeSec(bboxMm, props, 1, 1);
    const eightCavities = computeFillTimeSec(bboxMm, props, 8, 1);
    expect(oneCavity).toBeCloseTo(Math.round(base * 1.00 * 0.60 * 10) / 10, 5);
    expect(eightCavities).toBeCloseTo(Math.round(base * 1.05 * 0.60 * 10) / 10, 5);
    expect(eightCavities).toBeGreaterThan(oneCavity);
  });

  it('4 gates per cavity lands in the ≤4 bucket (factor 0.25), scaling fill time down vs. 1 gate', () => {
    const base = rawFillSec();
    const oneGate = computeFillTimeSec(bboxMm, props, 1, 1);
    const fourGates = computeFillTimeSec(bboxMm, props, 1, 4);
    expect(oneGate).toBeCloseTo(Math.round(base * 1.00 * 0.60 * 10) / 10, 5);
    expect(fourGates).toBeCloseTo(Math.round(base * 1.00 * 0.25 * 10) / 10, 5);
    expect(fourGates).toBeLessThan(oneGate);
  });

  it('cavity counts beyond the last real breakpoint (999,999) use the ceiling bucket (factor 1.10), not a guessed extrapolation', () => {
    const atCeiling = computeFillTimeSec(bboxMm, props, 50, 1);
    const wayBeyond = computeFillTimeSec(bboxMm, props, 10_000, 1);
    expect(wayBeyond).toBe(atCeiling);
  });
});
