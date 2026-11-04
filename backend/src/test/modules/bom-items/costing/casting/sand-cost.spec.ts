import { loadSandCastingCalculatorSpec, sandCastingCalculatorsByName } from '../../../../../modules/bom-items/costing/casting/sand/calculators/sand-casting-calculator-spec';
import { sandMaterialFromRow, sandPart, sandRouteToLocal, sandScenario } from '../../../../../modules/bom-items/costing/casting/sand/sand-cost';
import { SandCostService, type SandCostRequest } from '../../../../../modules/bom-items/costing/casting/sand/sand-cost.service';
import { SandMachineService } from '../../../../../modules/bom-items/costing/casting/sand/sand-machine.service';
import { buildSandRoute } from '../../../../../modules/bom-items/costing/casting/sand/sand-route';
import { buildCastingCostSummary } from '../../../../../modules/bom-items/costing/casting/casting-cost-summary';
import { readFileSync } from 'fs';
import { join } from 'path';
import { allSandMachines, realSandReference, sandMaterial } from './sand-test-data';

// The casting worker's own result for a synthetic hollow box (backend/test/fixtures/casting/README.md).
const hollowBox = JSON.parse(readFileSync(join(__dirname, '../../../../../../test/fixtures/casting/hollow-box.result.json'), 'utf8'));

const iron = sandMaterial('ASTM Grade 20 Gray Iron');

describe('sandScenario', () => {
  const base = { overrides: null, batchSize: 250, annualVolume: 2000, productionLifeYears: 5 };
  it('the lifetime volume is annual volume x production life, and unset (not assumed) when either is missing', () => {
    expect(sandScenario(base).scenario.lifetimeVolume).toBe(10000);
    expect(sandScenario({ ...base, annualVolume: null }).scenario.lifetimeVolume).toBeNull();
    expect(sandScenario({ ...base, productionLifeYears: 0 }).scenario.lifetimeVolume).toBeNull();
  });
  it('reads the user\'s choices, and says when a chosen moulding process is not a sand one', () => {
    const ok = sandScenario({ ...base, overrides: { sandMouldingProcess: 'Manual Pit Moldmaking', sandCoreProcess: 'Shell', energyPriceUsdPerKwh: 0.12, cavityCount: 2 } });
    expect(ok.scenario).toMatchObject({ mouldingClass: 'sand_casting_manual_pit_moldmaking', chosenCoreProcess: 'Shell', energyPricePerKwh: 0.12, cavities: 2 });
    const bad = sandScenario({ ...base, overrides: { sandMouldingProcess: 'Lost Foam', energyPriceUsdPerKwh: 0, cavityCount: 1.5 } });
    expect(bad.scenario.mouldingClass).toBeNull();
    expect(bad.scenario.energyPricePerKwh).toBeNull(); // 0 is "not set": no energy price is assumed
    expect(bad.scenario.cavities).toBeNull();
    expect(bad.warnings).toEqual([expect.stringContaining('Lost Foam')]);
  });
});

describe('sandPart', () => {
  const measured = { volumeMm3: 1e6, surfaceAreaMm2: 5e4, bboxMm: [300, 200, 100], footprintMm: [280, 180] as const, drawDepthMm: 90, wallNominalMm: 12, partingPerimeterMm: 900, rawCores: [{ volume_mm3: 1e5, box_mm: [30, 100, 60], area_mm2: 1 }] };
  it('uses the measured footprint and draw depth, and the cores sorted largest first', () => {
    const r = sandPart(measured);
    expect(r.missing).toEqual([]);
    expect(r.part!.dimsMm).toEqual([280, 180, 90]);
    expect(r.part!.cores).toEqual([{ volumeMm3: 1e5, sizeMm: [100, 60, 30] }]);
    expect(r.warnings).toEqual([]);
  });
  it('without a measured draw depth the box sorted by size is used, and it is said', () => {
    const r = sandPart({ ...measured, footprintMm: null, drawDepthMm: null, bboxMm: [100, 300, 200] });
    expect(r.part!.dimsMm).toEqual([300, 200, 100]);
    expect(r.warnings.join(' ')).toMatch(/not measured/);
  });
  it('cores not measured are not guessed: no core, and it is said', () => {
    const r = sandPart({ ...measured, rawCores: null });
    expect(r.part!.cores).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/Cores not measured/);
  });
  it('names a missing volume or surface', () => {
    expect(sandPart({ ...measured, volumeMm3: null, surfaceAreaMm2: 0 }).missing).toEqual(['the part volume', 'the part surface area']);
  });
});

describe('sandMaterialFromRow (migration 865: name was material_grade, grade was material)', () => {
  it('reads the columns the calculators read, and the name', () => {
    const m = sandMaterialFromRow({ name: 'Generic Gray Iron', grade: 'ASTM 20', material_type: 'Gray Iron', density_kg_m3: '7100', cut_code: 8.1, cost_usa: 0.6, heat_of_fusion_j_kg: null });
    expect(m).toMatchObject({ name: 'Generic Gray Iron', materialType: 'Gray Iron', columns: { density_kg_m3: 7100, cut_code: 8.1, cost_usa: 0.6, heat_of_fusion_j_kg: null } });
  });
});

const machines = allSandMachines();
const calculators = sandCastingCalculatorsByName();
const costContext = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
const volume = (8 / iron.columns['density_kg_m3']!) * 1e9;
const request = (over: Partial<SandCostRequest> = {}): SandCostRequest => ({
  client: {} as never, accessToken: 't', location: 'USA', grade: 'ASTM Grade 20 Gray Iron', bomItemId: 'item-1', sourcePath: 'path/part.step',
  measurements: { volumeMm3: volume, surfaceAreaMm2: 250000, bboxMm: [300, 200, 100], footprintMm: [300, 200], drawDepthMm: 100, wallNominalMm: 12, partingPerimeterMm: 900, rawCores: [] },
  overrides: { sandMouldingProcess: 'Manual Std Moldmaking' }, batchSize: 250, annualVolume: 2000, productionLifeYears: 5, usdToLocal: 1, costContext, ...over,
});
function service(opts: { material?: Record<string, unknown> | null; calcs?: typeof calculators; ref?: ReturnType<typeof realSandReference> | null; analysis?: unknown } = {}) {
  const material = opts.material === undefined ? { name: 'ASTM Grade 20 Gray Iron', grade: 'x', material_type: 'Gray Iron', ...Object.fromEntries(Object.entries(iron.columns)) } : opts.material;
  const client = { from: () => { const c: any = { select: () => c, eq: () => c, or: () => c, limit: async () => ({ data: material ? [material] : [], error: null }) }; return c; } };
  const ref = opts.ref === undefined ? realSandReference() : opts.ref;
  const svc = new SandCostService(
    { get: async () => (ref ? { reference: ref, missing: [] } : { reference: null, missing: ['Sand casting reference data is not staged'] }) } as never,
    { getMachinesByClass: async () => machines } as unknown as SandMachineService,
    { loadSandCastingCalculators: async () => opts.calcs ?? calculators } as never,
    { latestResult: async () => (opts.analysis === undefined ? null : { result: opts.analysis, workerVersion: '0.12.0' }) } as never,
  );
  return { svc, client };
}

describe('SandCostService.price', () => {
  it('prices a part: a complete route in USD', async () => {
    const { svc, client } = service();
    const r = await svc.price(request({ client: client as never }));
    expect(r.missing).toEqual([]);
    expect(r.route!.complete).toBe(true);
    expect(r.route!.mouldingProcess).toBe('Manual Std Moldmaking');
  });

  it('returns the route in the location\'s currency: every cost scaled, the same route', async () => {
    const { svc, client } = service();
    const usd = (await svc.price(request({ client: client as never }))).route!;
    const eur = (await svc.price(request({ client: client as never, usdToLocal: 0.5 }))).route!;
    expect(eur.mouldingMachine).toBe(usd.mouldingMachine);
    expect(eur.totalUsd!).toBeCloseTo(usd.totalUsd! * 0.5, 0);
    expect(eur.lines[0]!.hourlyRate).toBeCloseTo(usd.lines[0]!.hourlyRate * 0.5, 1);
    expect(eur.cavities).toBe(usd.cavities);
  });

  it('names why it cannot: a grade that is not a sand material, calculators not in the database, no reference data, no part volume', async () => {
    const run = (opts: Parameters<typeof service>[0], over: Partial<SandCostRequest> = {}) => {
      const { svc, client } = service(opts);
      return svc.price(request({ client: client as never, ...over }));
    };
    expect((await run({ material: null })).missing[0]).toMatch(/not a sand-casting material/);
    expect((await run({ calcs: {} })).missing[0]).toMatch(/run migration 956/);
    expect((await run({ ref: null })).missing[0]).toMatch(/not staged/);
    expect((await run({}, { measurements: { ...request().measurements, volumeMm3: null } })).missing).toEqual(['the part volume']);
  });
});

describe('SandCostService.price measures the part by the casting analysis when there is one', () => {
  const run = (opts: Parameters<typeof service>[0], over: Partial<SandCostRequest> = {}) => {
    const { svc, client } = service(opts);
    return svc.price(request({ client: client as never, ...over }));
  };

  it('without an analysis the cad-engine measures, and the route says so', async () => {
    const r = await run({});
    expect(r.measuredBy).toBe('cad-engine');
    expect(r.warnings.join(' ')).toMatch(/Measured by the cad-engine; request a casting analysis/);
  });

  it("with the worker's result the exact solid is costed: its volume, its true core, its measured height above the parting line", async () => {
    const r = await run({ analysis: hollowBox });
    expect(r.missing).toEqual([]);
    expect(r.measuredBy).toBe('casting analysis');
    expect(r.warnings.join(' ')).toMatch(/Measured by the casting analysis \(worker 0\.12\.0\)/);
    expect(r.warnings.join(' ')).not.toMatch(/Height above the parting line not measured|Parting line not measured|Cores not measured/);
    // 216 000 mm³ of gray iron, not the 8 kg of the cad-engine's numbers in this test
    expect(r.route!.material.netKg).toBeCloseTo((216000 * 1e-9) * iron.columns['density_kg_m3']!, 3);
    expect(r.route!.coresMade).toBe(1);
    expect(r.route!.lines.map((l) => l.process).some((p) => /coremaking$/.test(p))).toBe(true);
  });

  it('an analysis that cannot be used (an assembly) falls back to the cad-engine and says why', async () => {
    const r = await run({ analysis: { ...hollowBox, parts: [hollowBox.parts[0], hollowBox.parts[0]] } });
    expect(r.measuredBy).toBe('cad-engine');
    expect(r.warnings.join(' ')).toMatch(/The casting analysis could not be used \(the analysis has 2 distinct parts/);
    expect(r.route).not.toBeNull();
  });
});

describe('SandCostService.dfm: the design-for-casting checks of the item\'s analysis', () => {
  const run = (opts: Parameters<typeof service>[0], grade: string | null = 'ASTM Grade 20 Gray Iron') => {
    const { svc, client } = service(opts);
    return svc.dfm({ bomItemId: 'item-1', sourcePath: 'path/part.step', grade, client: client as never, accessToken: 't' });
  };

  it("judges the worker's hollow box against the real published tables for gray iron: walls 10-100 mm are fine; its 12 sharp outer and 12 sharp inner edges have no radius (limits 0.3 mm and 3 mm)", async () => {
    const v = await run({ analysis: hollowBox });
    expect(v.status).toBe('ok');
    expect(v.reasons).toEqual([]);
    const r = v.result!;
    expect(r.rulesetVersion).toBe('2026-SandCasting');
    expect(r.materialType).toBe('Gray Iron');
    expect(r.passed).toEqual(expect.arrayContaining(['ThinSection', 'ThickSection']));
    expect(r.findings).toHaveLength(24);
    expect(r.findings.every((f) => f.severity === 'Major' && f.measured === 0)).toBe(true);
    expect(r.findings.filter((f) => f.rule === 'InsufficientExternalRadius')).toHaveLength(12);
    expect(r.findings.filter((f) => f.rule === 'InsufficientExternalRadius').every((f) => f.threshold === 0.3)).toBe(true);
    expect(r.findings.filter((f) => f.rule === 'InsufficientInternalRadius').every((f) => f.threshold === 3)).toBe(true);
    expect(r.notEvaluated.map((n) => n.rule)).toEqual(expect.arrayContaining(['InsufficientDraftAngle', 'ClosedVoid', 'TightToleranceFlatness']));
  });

  it('says so when there is no analysis of the current file, and does not show a pass', async () => {
    const v = await run({});
    expect(v).toEqual({ status: 'no_analysis', result: null, reasons: ['There is no casting analysis of the current file: request one.'] });
  });

  it('names a missing reference, and an analysis it cannot judge (an assembly)', async () => {
    expect((await run({ analysis: hollowBox, ref: null })).status).toBe('unavailable');
    const assembly = await run({ analysis: { ...hollowBox, parts: [hollowBox.parts[0], hollowBox.parts[0]] } });
    expect(assembly).toMatchObject({ status: 'unavailable', result: null });
    expect(assembly.reasons[0]).toMatch(/2 distinct parts/);
  });

  it('a grade that is not a sand material still gives the material-free checks, and says the others are not evaluated', async () => {
    const v = await run({ analysis: hollowBox, material: null }, 'Mystery');
    expect(v.status).toBe('ok');
    expect(v.reasons[0]).toMatch(/"Mystery" is not a sand-casting material/);
    expect(v.result!.materialType).toBeNull();
    expect(v.result!.notEvaluated).toContainEqual({ rule: 'ThinSection', reason: 'the rule has no row for a part with no material type' });
  });
});

describe('sandRouteToLocal', () => {
  it('leaves a USD route as it is', () => {
    const route = buildSandRoute({ ref: realSandReference(), spec: loadSandCastingCalculatorSpec(), calculators, material: iron, part: { volumeMm3: volume, surfaceAreaMm2: 250000, dimsMm: [300, 200, 100], wallNominalMm: 12, partingLineMm: 900, abovePartingMm: null, cores: [] }, machinesByClass: machines, scenario: { batchSize: 250, cavities: null, mouldingClass: 'sand_casting_manual_std_moldmaking', chosenCoreProcess: null, energyPricePerKwh: 0.1, lifetimeVolume: 1e4 }, costContext }).route!;
    expect(sandRouteToLocal(route, 1)).toBe(route);
  });
});

describe('the cost summary of a sand casting', () => {
  const route = buildSandRoute({ ref: realSandReference(), spec: loadSandCastingCalculatorSpec(), calculators, material: iron, part: { volumeMm3: volume, surfaceAreaMm2: 250000, dimsMm: [300, 200, 100], wallNominalMm: 12, partingLineMm: 900, abovePartingMm: null, cores: [{ volumeMm3: 1.2e6, sizeMm: [200, 100, 60] }] }, machinesByClass: machines, scenario: { batchSize: 250, cavities: null, mouldingClass: 'sand_casting_manual_std_moldmaking', chosenCoreProcess: null, energyPricePerKwh: 0.1, lifetimeVolume: 1e4 }, costContext }).route!;
  const base = { family: 'sand_cast', process: 'sand_casting' as const, hpdc: null, materialGrade: 'ASTM Grade 20 Gray Iron', materialCostPerKg: 0.6, materialDensityKgM3: 7100, materialSource: 'db' as const, partVolumeMm3: volume, batchSize: 250, warnings: [] as string[], ratesSource: 'test' };

  it('prices the route: its lines in order, its metal, no "no cost engine yet"', () => {
    const s = buildCastingCostSummary({ ...base, sand: { route, missing: [] } });
    expect(s.processLines.map((l) => l.process)).toEqual(route.lines.map((l) => l.process));
    expect(s.warnings.join(' ')).not.toMatch(/no cost engine yet/);
    expect(s.materialCost).toBe(route.material.costUsd);
    expect(s.grossWeightKg).toBeCloseTo(route.material.pouredKg, 3);
    expect(s.totalProcessCost).toBeCloseTo(route.lines.reduce((t, l) => t + l.totalCost, 0), 1);
    expect(s.totalCost).toBeCloseTo(s.materialCost + s.totalProcessCost, 1);
  });

  it('shows the core-box tooling beside the piece cost, as on a die-cast route, and the metal calculator runs', () => {
    const s = buildCastingCostSummary({ ...base, sand: { route, missing: [] } });
    expect(s.coreboxTooling).toMatchObject({ boxes: expect.any(Number), perPartUsd: route.tooling.perPartUsd });
    expect(Object.keys(s.calculatorRuns ?? {})).toEqual(expect.arrayContaining(['Sand metal per casting', 'Sand material cost']));
  });

  it('puts machining before the final visual inspection', () => {
    const machining = { process: 'Drilling', setupCost: 0, runCost: 1, totalCost: 1, cycleTimeMin: 1, hourlyRate: 1, rateSource: 'mhr_database' as const, machineClass: 'x', machineName: 'm', commodityCode: null, labourRate: null };
    const s = buildCastingCostSummary({ ...base, sand: { route, missing: [] }, secondaryMachining: { lines: [machining as never], warnings: [] } });
    const names = s.processLines.map((l) => l.process);
    expect(names.slice(-2)).toEqual(['Drilling', 'Visual Inspection']);
  });

  it('a route that cannot be built is one named gap line with the reasons, not a price', () => {
    const s = buildCastingCostSummary({ ...base, sand: { route: null, missing: ['"X" is not a sand-casting material'] } });
    expect(s.processLines).toHaveLength(1);
    expect((s.processLines[0]!.physicsGap as { reason: string }).reason).toBe('Sand Casting cannot be costed: "X" is not a sand-casting material');
    expect(s.totalProcessCost).toBe(0);
  });

  it('an incomplete route says so, and investment casting still has no engine', () => {
    const incomplete = { ...route, complete: false };
    expect(buildCastingCostSummary({ ...base, sand: { route: incomplete, missing: [] } }).warnings.join(' ')).toMatch(/route is incomplete/);
    expect(buildCastingCostSummary({ ...base, process: 'investment_casting' }).warnings.join(' ')).toMatch(/no cost engine yet/);
  });
});
