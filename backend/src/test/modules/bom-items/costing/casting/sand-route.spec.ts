import { loadSandCastingCalculatorSpec, sandCastingCalculatorsByName } from '../../../../../modules/bom-items/costing/casting/sand/calculators/sand-casting-calculator-spec';
import { buildSandRoute, MOULDING_PROCESSES, type SandRouteInput } from '../../../../../modules/bom-items/costing/casting/sand/sand-route';
import { allSandMachines, realSandReference, sandMaterial, sandRows } from './sand-test-data';

const ref = realSandReference();
const iron = sandMaterial('ASTM Grade 20 Gray Iron');
const machines = allSandMachines();
const spec$ = (m: { specs: Readonly<Record<string, unknown>> }, k: string) => Number(m.specs[k]);
const costContext = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };

const input: SandRouteInput = {
  ref, spec: loadSandCastingCalculatorSpec(), calculators: sandCastingCalculatorsByName(), material: iron,
  part: {
    volumeMm3: (8 / iron.columns['density_kg_m3']!) * 1e9, surfaceAreaMm2: 250000, dimsMm: [300, 200, 100], wallNominalMm: 12,
    partingLineMm: 900, abovePartingMm: 50, cores: [{ volumeMm3: 1.2e6, sizeMm: [200, 100, 60] }],
  },
  machinesByClass: machines,
  scenario: { batchSize: 250, cavities: null, mouldingClass: null, chosenCoreProcess: null, energyPricePerKwh: 0.1, lifetimeVolume: 10000 },
  costContext,
};

const started = Date.now();
const { route, missing } = buildSandRoute(input);
const tookMs = Date.now() - started;

describe('buildSandRoute on a gray iron casting with one core (real sand data)', () => {
  it('builds a complete route', () => {
    expect(missing).toEqual([]);
    expect(route).not.toBeNull();
    expect(route!.complete).toBe(true);
    expect(route!.totalUsd).toBeGreaterThan(0);
  });

  it('is fast enough to run on a request (a whole route for every moulding machine)', () => {
    expect(tookMs).toBeLessThan(8000);
  });

  it('runs the steps in order: melt, the core, moulding, pour, cooling, shakeout, degating, cleaning, finishing, inspection', () => {
    const names = route!.lines.map((l) => l.process);
    expect(names).toEqual(['Melting', expect.stringMatching(/coremaking$/), route!.mouldingProcess, 'Pour', 'Cooling', 'Shakeout', 'Degating', 'Cleaning', 'Finishing', 'Visual Inspection']);
    expect(route!.lines.every((l) => l.physicsGap == null && l.totalCost > 0)).toBe(true);
    expect(route!.coresMade).toBe(1);
  });

  it('the metal poured is the casting plus its risers and gating, and the yield follows from it', () => {
    const g = route!.gating;
    expect(route!.material.pouredKg).toBeCloseTo(route!.material.netKg + g.risersKg + g.gatingKg, 3);
    expect(route!.material.yieldPct).toBeCloseTo((100 * route!.material.netKg) / route!.material.pouredKg, 1);
  });

  it('the metal bought is hand-worked: net + melt loss + the gates and risers not remelted, at the price, over the good-part yield', () => {
    const furnace = machines['sand_casting_melting']!.find((m) => m.name === route!.lines[0]!.machineName)!;
    const { netKg, pouredKg } = route!.material;
    const remelt = Math.min(Math.max(ref.number('defaultRemeltAllowanceSandCasting')!, 0), 1);
    const melt = pouredKg / spec$(furnace, 'yield_loss_factor') - pouredKg;
    const yieldOf = (name: string) => {
      const m = Object.values(machines).flat().find((x) => x.name === name && route!.lines.some((l) => l.machineName === name));
      return m ? Number(m.specs['good_part_yield'] ?? 1) : 1;
    };
    const finalYield = route!.lines.reduce((y, l) => y * yieldOf(l.machineName!), 1);
    const expected = ((netKg + melt + (pouredKg - netKg) * (1 - remelt)) * iron.columns['cost_usa']!) / finalYield;
    expect(route!.material.costUsd).toBeCloseTo(expected, 1);
  });

  it('the total is the metal, the process lines and the core-box tooling per part', () => {
    const lines = route!.lines.reduce((s, l) => s + l.totalCost, 0);
    expect(route!.totalUsd).toBeCloseTo(route!.material.costUsd! + lines + route!.tooling.perPartUsd, 1);
  });

  it('the tooling is the cheapest box material per part over the lifetime volume, for each core (hand-worked)', () => {
    const per = sandRows('Lookup/lookupTables_Component_tblCoreboxMaterial.csv').map((r) => {
      const boxes = Math.max(1, Math.ceil(10000 / (Number(r['Corebox Refurb Life']) * (Number(r['Corebox Refurbs Per Tool']) + 1))));
      return (boxes * Number(r['One Cavity Cost (USD)']) * ref.number('toolShopRegionMultiplier')!) / 10000;
    });
    expect(route!.tooling.perPartUsd).toBeCloseTo(Math.min(...per), 3);
  });

  it('the moulding machine chosen is the one with the cheapest complete route', () => {
    const byClass = MOULDING_PROCESSES.map((p) => buildSandRoute({ ...input, scenario: { ...input.scenario, mouldingClass: p.machineClass } }).route).filter((r) => r?.complete);
    expect(byClass.length).toBeGreaterThan(1);
    expect(route!.totalUsd).toBe(Math.min(...byClass.map((r) => r!.totalUsd!)));
  });
});

describe('what the user can choose, and what the data cannot do', () => {
  it('a chosen moulding class restricts the route to it, and a chosen cavity count is used', () => {
    const r = buildSandRoute({ ...input, scenario: { ...input.scenario, mouldingClass: 'sand_casting_manual_std_moldmaking', cavities: 1 } }).route!;
    expect(r.mouldingProcess).toBe('Manual Std Moldmaking');
    expect(r.cavities).toBe(1);
  });

  it('a chosen core process makes the core', () => {
    const r = buildSandRoute({ ...input, scenario: { ...input.scenario, mouldingClass: 'sand_casting_manual_std_moldmaking', chosenCoreProcess: 'CO2 Cured' } }).route!;
    expect(r.lines[1]!.process).toBe('CO2 Cured coremaking');
  });

  it('with no energy price set the melting energy is not charged, and the route says so', () => {
    const r = buildSandRoute({ ...input, scenario: { ...input.scenario, mouldingClass: 'sand_casting_manual_std_moldmaking', energyPricePerKwh: null } }).route!;
    expect(r.warnings.join(' ')).toMatch(/energy price/);
    const priced = buildSandRoute({ ...input, scenario: { ...input.scenario, mouldingClass: 'sand_casting_manual_std_moldmaking', energyPricePerKwh: 0.1 } }).route!;
    expect(priced.lines[0]!.totalCost).toBeGreaterThan(r.lines[0]!.totalCost);
  });

  it('a step no machine can do is a named gap and the route has no total', () => {
    const r = buildSandRoute({ ...input, machinesByClass: { ...machines, sand_casting_pour: [] }, scenario: { ...input.scenario, mouldingClass: 'sand_casting_manual_std_moldmaking' } }).route!;
    expect(r.complete).toBe(false);
    expect(r.totalUsd).toBeNull();
    const pour = r.lines.find((l) => l.process === 'Pour')!;
    expect(pour.physicsGap).toBeDefined();
    expect(pour.totalCost).toBe(0);
  });

  it('a part too large for every flask names why, and gives no route', () => {
    const huge = buildSandRoute({ ...input, part: { ...input.part, dimsMm: [9000, 9000, 9000] } });
    expect(huge.route).toBeNull();
    expect(huge.missing.length).toBeGreaterThan(0);
    expect(huge.missing.join(' ')).toMatch(/does not fit the flask|exceeds the flask height/);
  });

  it('estimates are said to be estimates: no measured wall, parting line or height above the parting line', () => {
    const r = buildSandRoute({ ...input, part: { ...input.part, wallNominalMm: null, partingLineMm: null, abovePartingMm: null }, scenario: { ...input.scenario, mouldingClass: 'sand_casting_manual_std_moldmaking' } }).route!;
    expect(r.warnings.join(' ')).toMatch(/Wall thickness not measured/);
    expect(r.warnings.join(' ')).toMatch(/Parting line not measured/);
    expect(r.warnings.join(' ')).toMatch(/Height above the parting line not measured/);
  });

  it('says what is not costed: patterns, core coating, sand', () => {
    expect(route!.warnings.join(' ')).toMatch(/Patterns, core coating and core gluing are not costed/);
  });
});
