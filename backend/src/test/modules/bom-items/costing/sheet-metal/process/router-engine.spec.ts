import { computeRouterCost, type RouterInput, RouterEngine } from '../../../../../../modules/bom-items/costing/sheet-metal/process/router-engine';

function baseInput(overrides: Partial<RouterInput> = {}): RouterInput {
  return {
    cutLengthMm: 1000,
    pierceCount: 2,
    batchSize: 10,
    // 350.52 m/min = the real, constant tblRouterUtilities.json value for
    // every Aluminum/Copper row (see migration 604) — expressed here in
    // mm/min, matching what SheetMetalLookupService.getRouterParams() returns.
    cuttingSpeedMmPerMin: 350.52 * 1000,
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

  it('stays honestly $0/0-min (no guess) when no real cuttingSpeedMmPerMin was resolved for this material family', () => {
    const result = computeRouterCost(baseInput({ cuttingSpeedMmPerMin: undefined }));

    expect(result.cuttingMin).toBe(0);
    expect(result.abrasiveCost).toBe(0);
    expect(result.warnings.some((w) => w.includes('no sm_lookup_router_cut entry'))).toBe(true);
  });

  it('falls back to ROUTER_SETUP_MIN and discloses it when no real op setup time was resolved', () => {
    const result = computeRouterCost(baseInput({ setupMin: undefined }));
    const line = result.processLines[0]!;

    expect(line.setupCost).toBeGreaterThanOrEqual(0);
    expect(result.warnings.some((w) => w.includes("seed sm_lookup_op_setup_time for 'router_2axis'"))).toBe(true);
  });

  it('uses a real resolved setup time without warning when provided', () => {
    const result = computeRouterCost(baseInput({ setupMin: 45 }));
    expect(result.warnings.some((w) => w.includes('seed sm_lookup_op_setup_time'))).toBe(false);
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
    expect(line.runCost).toBeCloseTo(Math.round((result.cuttingMin / 60) * 40 * 100) / 100, 5);
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

  it('ignores routerParams when dataFound is false, producing an honest $0 cutting line', () => {
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
    expect(result.warnings.some((w) => w.includes('no sm_lookup_router_cut entry'))).toBe(true);
  });
});
