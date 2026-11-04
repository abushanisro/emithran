import { loadSandCastingCalculatorSpec, sandCastingCalculatorsByName } from '../../../../../modules/bom-items/costing/casting/sand/calculators/sand-casting-calculator-spec';
import { NO_REFRACTORY, refractorySettingsProblems, type RefractorySettings } from '../../../../../modules/bom-items/costing/casting/sand/sand-refractory';
import { buildSandRoute, type SandRouteInput } from '../../../../../modules/bom-items/costing/casting/sand/sand-route';
import { sandScenario } from '../../../../../modules/bom-items/costing/casting/sand/sand-cost';
import { allSandMachines, realSandReference, sandMaterial, HOT_BOX } from './sand-test-data';

const ref = realSandReference();
const iron = sandMaterial('ASTM Grade 20 Gray Iron');
const costContext = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };

/** Illustrative settings for tests only: no dataset holds a drying time or a coating price, and the application assumes none (they are set in the Cost Guide). */
const OVEN: RefractorySettings = { coat: 'mould', dryMethod: 'oven', dryMinutes: 20, pricePerKg: null };

const core = (areaMm2: number | null) => ({ volumeMm3: 4e5, areaMm2, sizeMm: [120, 80, 50] as const });
const inputWith = (refractory: RefractorySettings | undefined, cores: SandRouteInput['part']['cores'] = [core(30000), core(20000)]): SandRouteInput => ({
  ref, spec: loadSandCastingCalculatorSpec(), calculators: sandCastingCalculatorsByName(), material: iron,
  part: {
    volumeMm3: (8 / iron.columns['density_kg_m3']!) * 1e9, surfaceAreaMm2: 250000, dimsMm: [300, 200, 100], wallNominalMm: 12, partingLineMm: 900, abovePartingMm: 50, cores,
  },
  machinesByClass: allSandMachines(),
  scenario: { batchSize: 250, cavities: null, mouldingClass: null, chosenCoreProcess: null, energyPricePerKwh: 0.1, hotBox: HOT_BOX, lifetimeVolume: 10000, ...(refractory ? { refractory } : {}) },
  costContext,
});
const names = (r: NonNullable<ReturnType<typeof buildSandRoute>['route']>) => r.lines.map((l) => l.process);
const line = (r: NonNullable<ReturnType<typeof buildSandRoute>['route']>, process: string) => r.lines.find((l) => l.process === process);

describe('nothing is coated unless the user chose it', () => {
  it('a scenario with no coating has no coating, drying or (with one core) assembly line, and is the same route as before', () => {
    const none = buildSandRoute(inputWith(undefined, [core(30000)])).route!;
    expect(names(none).filter((n) => /Refractory|assembly/.test(n))).toEqual([]);
    expect(buildSandRoute(inputWith(NO_REFRACTORY, [core(30000)])).route!.totalUsd).toBe(none.totalUsd);
  });

  it('the scenario keys give the settings: a choice from the list, a method, positive numbers; anything else is not chosen', () => {
    const settings = (o: Record<string, unknown>) => sandScenario({ overrides: o, batchSize: 1, annualVolume: null, productionLifeYears: null }).scenario.refractory;
    expect(settings({ sandRefractoryCoat: 'both', sandRefractoryDryMethod: 'air', sandRefractoryDryMinutes: 30, refractoryCoatingUsdPerKg: 4.5 })).toEqual({ coat: 'both', dryMethod: 'air', dryMinutes: 30, pricePerKg: 4.5 });
    expect(settings({})).toEqual(NO_REFRACTORY);
    expect(settings({ sandRefractoryCoat: 'everything', sandRefractoryDryMethod: 'sun', sandRefractoryDryMinutes: -5, refractoryCoatingUsdPerKg: 0 })).toEqual(NO_REFRACTORY);
  });

  it('a coating needs its drying method and time, and says which is missing', () => {
    expect(refractorySettingsProblems(NO_REFRACTORY)).toEqual([]);
    expect(refractorySettingsProblems({ coat: 'mould', dryMethod: null, dryMinutes: null, pricePerKg: null })).toHaveLength(2);
    expect(refractorySettingsProblems(OVEN)).toEqual([]);
  });
});

describe('the mould coated and dried', () => {
  const base = buildSandRoute(inputWith(undefined, [])).route!;
  const coated = buildSandRoute(inputWith(OVEN, [])).route!;

  it('adds the coat and the drying after the mould is made and before the metal is poured', () => {
    const n = names(coated);
    expect(n).toEqual(expect.arrayContaining(['Mold Refractory Coat', 'Refractory Coat Oven Dry (mould)']));
    expect(n.indexOf('Mold Refractory Coat')).toBe(n.indexOf(coated.mouldingProcess) + 1);
    expect(n.indexOf('Refractory Coat Oven Dry (mould)')).toBe(n.indexOf('Mold Refractory Coat') + 1);
    expect(n.indexOf('Refractory Coat Oven Dry (mould)')).toBeLessThan(n.indexOf('Pour'));
  });

  it('costs more than the uncoated route, by the two lines', () => {
    expect(coated.complete).toBe(true);
    expect(coated.totalUsd!).toBeGreaterThan(base.totalUsd!);
  });

  it('times the coat by hand: 0.25 m2 over the spraying rate of 5.13 m2/min, one coat, plus the 0.25 h slurry preparation shared by a batch of 250', () => {
    const l = line(coated, 'Mold Refractory Coat')!;
    // 0.25 * 1 / 5.13 * 60 = 2.9240 s, preparation 0.25 * 3600 / 250 = 3.6 s
    const trace = l.calculationTrace!;
    expect(trace.find((t) => t.fieldName === 'Coat Time')!.value as number).toBeCloseTo(2.924, 3);
    expect(trace.find((t) => t.fieldName === 'Cycle Time')!.value as number).toBeCloseTo(2.924 + 3.6, 3);
    expect(trace.find((t) => t.fieldName === 'Application Rate')).toMatchObject({ value: 5.13, source: expect.stringContaining('tblRefractoryCoating: Spraying') });
    expect(trace.find((t) => t.fieldName === 'Coating Density')).toMatchObject({ value: 3250, source: expect.stringContaining('Water-Based Refractory Coating') });
    // 0.25 m2 * 1 coat * (6 / 5.13 L/m2) = 0.2924 L; * 3250 kg/m3 / 1000 = 0.9503 kg
    expect(trace.find((t) => t.fieldName === 'Coating Mass')!.value as number).toBeCloseTo(0.9503, 3);
  });

  it('costs the people who coat: the plant\'s crew of the Default work centre, whose own row says none', () => {
    const l = line(coated, 'Mold Refractory Coat')!;
    expect(l.operators).toBe(ref.number('defaultMoldRefractoryCoatingNumOperators'));
    expect(l.operators).toBeGreaterThan(0);
  });

  it('shares the oven drying by the castings a load holds: a rack of 1 m3 less racking takes whole flasks, each a cavity-share of a casting', () => {
    const l = line(coated, 'Refractory Coat Oven Dry (mould)')!;
    expect(l.cycleTimeMin).toBeGreaterThan(0);
    const dry = l.calculationTrace!.find((t) => t.fieldName === 'Drying Time')!;
    expect(dry).toMatchObject({ value: 20, source: expect.stringContaining('Cost Guide') });
    const perLoad = l.calculationTrace!.find((t) => t.fieldName === 'Items per Load')!.value as number;
    expect(Number.isInteger(perLoad)).toBe(true);
    expect(perLoad).toBeGreaterThanOrEqual(1);
  });

  it('charges the coating at the user\'s price, linearly in the price; without a price it says it is not charged', () => {
    const at = (p: number | null) => buildSandRoute(inputWith({ ...OVEN, pricePerKg: p }, [])).route!;
    const [c0, c1, c2] = [at(null), at(1000), at(2000)].map((r) => line(r, 'Mold Refractory Coat')!.totalCost);
    expect(c1).toBeGreaterThan(c0!);
    expect(c2! - c1!).toBeCloseTo(c1! - c0!, 1);
    expect(at(null).warnings.join(' ')).toMatch(/not charged: its price is not set/);
    expect(at(1000).warnings.join(' ')).not.toMatch(/its price is not set/);
  });

  it('air drying is its own line on the air-dry area, and costs the labourers\' time only', () => {
    const air = buildSandRoute(inputWith({ ...OVEN, dryMethod: 'air' }, [])).route!;
    expect(names(air)).toContain('Refractory Coat Air Dry (mould)');
    expect(names(air)).not.toContain('Refractory Coat Oven Dry (mould)');
    expect(air.complete).toBe(true);
  });

  it('a coating chosen without a drying time is a named gap: the route is incomplete and says which setting is missing', () => {
    const gapped = buildSandRoute(inputWith({ coat: 'mould', dryMethod: 'oven', dryMinutes: null, pricePerKg: null }, [])).route!;
    const dry = line(gapped, 'Refractory Coat Oven Dry (mould)')!;
    expect(dry.physicsGap).toBeDefined();
    expect(gapped.complete).toBe(false);
    expect(gapped.totalUsd).toBeNull();
    expect(JSON.stringify(dry.machineChoice)).toMatch(/drying time is not set/);
  });
});

describe('the cores coated, dried and glued', () => {
  const route = (refractory: RefractorySettings, cores?: SandRouteInput['part']['cores']) => buildSandRoute(inputWith(refractory, cores)).route!;

  it('coats the cores\' measured surface: 30000 + 20000 mm2 = 0.05 m2, and dries them as one set', () => {
    const r = route({ ...OVEN, coat: 'cores' });
    const l = line(r, 'Core Refractory Coat')!;
    expect(l.calculationTrace!.find((t) => t.fieldName === 'Coated Area')!.value).toBe(50000);
    expect(names(r)).toContain('Refractory Coat Oven Dry (cores)');
    expect(names(r)).not.toContain('Mold Refractory Coat');
    // the cores' side comes before the mould is made
    expect(names(r).indexOf('Refractory Coat Oven Dry (cores)')).toBeLessThan(names(r).indexOf(r.mouldingProcess));
  });

  it('a core with no measured surface cannot be coated: a named gap that says to re-run the analysis', () => {
    const r = route({ ...OVEN, coat: 'cores' }, [core(30000), core(null)]);
    expect(line(r, 'Core Refractory Coat')!.physicsGap).toBeDefined();
    expect(JSON.stringify(line(r, 'Core Refractory Coat')!.machineChoice)).toMatch(/re-run the casting analysis/);
    expect(r.complete).toBe(false);
  });

  it('glues the cores of a casting: one glue of singleCoreAssemblyTime (60 s) between two cores, none for one', () => {
    const two = route(NO_REFRACTORY);
    const glue = line(two, 'Core assembly')!;
    expect(glue.cycleTimeMin * 60).toBeCloseTo(ref.number('singleCoreAssemblyTime')! * 1, 6);
    expect(names(two).indexOf('Core assembly')).toBeLessThan(names(two).indexOf(two.mouldingProcess));
    expect(names(route(NO_REFRACTORY, [core(30000)]))).not.toContain('Core assembly');
    const three = route(NO_REFRACTORY, [core(1), core(1), core(1)]);
    expect(line(three, 'Core assembly')!.cycleTimeMin * 60).toBeCloseTo(2 * ref.number('singleCoreAssemblyTime')!, 6);
  });

  it('both: the cores and the mould are coated, each dried, and the route is whole', () => {
    const r = route({ ...OVEN, coat: 'both' });
    expect(names(r).filter((n) => /Refractory/.test(n))).toEqual(['Core Refractory Coat', 'Refractory Coat Oven Dry (cores)', 'Mold Refractory Coat', 'Refractory Coat Oven Dry (mould)']);
    expect(r.complete).toBe(true);
  });
});
