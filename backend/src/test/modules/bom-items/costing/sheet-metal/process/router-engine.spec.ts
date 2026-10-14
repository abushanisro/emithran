import { computeRouterCost, type RouterInput, RouterEngine } from '../../../../../../modules/bom-items/costing/sheet-metal/process/router-engine';
import { findRouteDataGaps } from '../../../../../../modules/bom-items/costing/shared/core/engine-kernel';

function baseInput(overrides: Partial<RouterInput> = {}): RouterInput {
  return {
    cutLengthMm: 1000,
    pierceCount: 2,
    batchSize: 10,
    // A linear feed along the cut, mm/min. The engine only divides length by it;
    // the value here is illustrative, since no feed rate is on file (see below).
    cuttingSpeedMmPerMin: 2000,
    ...overrides,
  };
}

describe('computeRouterCost — real material-family cutting speed', () => {
  it('computes cutting time as cutLengthMm / cuttingSpeedMmPerMin with no fabricated plunge/pierce time', () => {
    const input = baseInput();
    const result = computeRouterCost(input);

    const expectedCuttingMin = input.cutLengthMm / input.cuttingSpeedMmPerMin!;
    expect(result.cuttingMin).toBeCloseTo(expectedCuttingMin, 5);
  });

  it('warns (does not fabricate) that plunge/pierce time is unmodeled when pierceCount > 0', () => {
    const result = computeRouterCost(baseInput({ pierceCount: 3 }));
    expect(result.warnings.some((w) => w.includes('plunge/pierce time is not modeled'))).toBe(true);
  });

  it('does not warn about plunge/pierce time when there are no pierces', () => {
    const result = computeRouterCost(baseInput({ pierceCount: 0 }));
    expect(result.warnings.some((w) => w.includes('plunge/pierce time is not modeled'))).toBe(false);
  });

  // Reported live on Rtp2 Mag2 Backframe: sm_lookup_router_cut's 350.52 m/min is the
  // cutter's SURFACE speed, and was used as the linear feed, pricing 5018 mm of cut at
  // 0.014 min. With no feed rate on file the cutting is a data gap, not a $0 line.
  it('raises a data gap (no guess, no $0 line passed off as costed) when no linear feed was resolved', () => {
    const result = computeRouterCost(baseInput({ cuttingSpeedMmPerMin: undefined, cutLengthMm: 5018 }));
    const line = result.processLines[0]!;
    const gap = line.physicsGap as { reason?: string } | undefined;

    expect(result.cuttingMin).toBe(0);
    expect(line.physicsGap?.gapType).toBe('unsupported_operation');
    expect(gap?.reason).toContain('5018 mm');
    expect(findRouteDataGaps(result.processLines)).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes('no linear feed rate on file'))).toBe(true);
  });

  it('raises no gap when a linear feed was resolved and nothing plunges', () => {
    expect(computeRouterCost(baseInput({ pierceCount: 0 })).processLines[0]!.physicsGap).toBeUndefined();
  });

  // Plunging is unpriced (no plunge time in any source): left out silently it made the router
  // the cheapest route for a 124-hole part.
  it('raises a data gap for plunges even when the feed is on file', () => {
    const result = computeRouterCost(baseInput({ pierceCount: 124 }));
    const gap = result.processLines[0]!.physicsGap as { reason?: string } | undefined;
    expect(gap?.reason).toContain('124 plunges');
    expect(findRouteDataGaps(result.processLines)).toHaveLength(1);
  });

  it('does not cost setup, and says so, when no real setup time resolved', () => {
    const result = computeRouterCost(baseInput({ setupMin: undefined }));
    const line = result.processLines[0]!;

    expect(line.setupTimeMin).toBe(0);
    expect(line.setupCost).toBe(0);
    expect(result.warnings.some((w) => w.includes('setup not costed'))).toBe(true);
    expect(line.setupTimeSource).toBe('none');
  });

  it('uses a real resolved setup time without warning when provided', () => {
    const result = computeRouterCost(baseInput({ setupMin: 45 }));
    expect(result.warnings.some((w) => w.includes('setup not costed'))).toBe(false);
    expect(result.processLines[0]!.setupTimeMin).toBeCloseTo(45, 5);
    expect(result.processLines[0]!.setupTimeSource).toBe('operation_lookup');
  });
});

describe('computeRouterCost — direct labour cost', () => {
  it('charges labour cost for both setup and run time when a differentiated labour rate is resolved', () => {
    const input = baseInput({
      // Slower speed than the default (real router speed is fast enough
      // that a 1000mm cut takes a fraction of a second — too small to
      // survive buildCuttingProcessLine's r2() rounding at batchSize=10).
      cuttingSpeedMmPerMin: 500,
      routerRate: { rate: 40, source: 'mhr_database', machineClass: 'router_2axis', machineName: 'Test Router', commodityCode: null, labourRate: 36.3 },
      setupMin: 30,
    });
    const result = computeRouterCost(input);
    const line = result.processLines[0]!;

    const dlrMin = 36.3 / 60;
    const expectedSetupCost = (30 / 60) * 40 / input.batchSize + dlrMin * 30 / input.batchSize;

    expect(line.setupCost).toBeCloseTo(expectedSetupCost, 2);
    const machineOnlyRunCost = (result.cuttingMin / 60) * 40;
    expect(line.runCost).toBeGreaterThan(machineOnlyRunCost);
    expect(result.warnings.some((w) => w.includes('no direct labor rate'))).toBe(false);
  });

  it('charges $0 labour (not a guess) when no differentiated rate was resolved', () => {
    const input = baseInput({
      routerRate: { rate: 40, source: 'mhr_database', machineClass: 'router_2axis', machineName: 'Test Router', commodityCode: null, labourRate: null },
    });
    const result = computeRouterCost(input);
    const line = result.processLines[0]!;

    expect(line.labourRate).toBeNull();
    expect(line.runCost).toBeCloseTo((result.cuttingMin / 60) * 40, 5);
  });

  it('falls back to a no_db_rate machine rate (not a guessed number) when no rate is resolved at all', () => {
    const result = computeRouterCost(baseInput({ routerRate: undefined }));
    const line = result.processLines[0]!;

    expect(line.hourlyRate).toBe(0);
    expect(line.rateSource).toBe('no_db_rate');
  });
});

describe('RouterEngine — ManufacturingProcessEngine wrapper', () => {
  it('reports the correct machineClass/processFamily and delegates computeCost to computeRouterCost', () => {
    const engine = new RouterEngine();
    expect(engine.machineClass).toBe('router_2axis');
    expect(engine.processFamily).toBe('sheet_metal_cutting');

    const result = engine.computeCost({
      sheetThicknessMm: 3,
      cutLengthMm: 500,
      pierceCount: 1,
      holeCount: 1,
      batchSize: 5,
      grade: 'AL6061',
      rate: { rate: 40, source: 'mhr_database', machineClass: 'router_2axis', machineName: 'Test Router', commodityCode: null, labourRate: null },
      routerParams: { cuttingSpeedMmPerMin: 350.52 * 1000, dataFound: true },
    });

    expect(result.processLines[0]!.process).toBe('Router Cutting');
    expect(result.cuttingMin).toBeCloseTo(500 / (350.52 * 1000), 5);
  });

  it('ignores routerParams when dataFound is false: no cutting time, and a data gap on the line', () => {
    const engine = new RouterEngine();
    const result = engine.computeCost({
      sheetThicknessMm: 3,
      cutLengthMm: 500,
      pierceCount: 0,
      holeCount: 0,
      batchSize: 5,
      grade: 'SS304', // stainless — no real router data exists for this family
      rate: { rate: 40, source: 'mhr_database', machineClass: 'router_2axis', machineName: 'Test Router', commodityCode: null, labourRate: null },
      routerParams: { cuttingSpeedMmPerMin: 0, dataFound: false },
    });

    expect(result.cuttingMin).toBe(0);
    expect(result.warnings.some((w) => w.includes('no linear feed rate on file'))).toBe(true);
    expect(result.processLines[0]!.physicsGap?.gapType).toBe('unsupported_operation');
  });
});
