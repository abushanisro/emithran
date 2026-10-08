import { join } from 'path';
import {
  CORE_LOOKUP_KEYS,
  priceCoreRoute,
  resolveCoreReference,
  type CastingCore,
} from '../../../../../modules/bom-items/costing/casting/coremaking';
import type { FinishingMachine } from '../../../../../modules/bom-items/costing/casting/casting-finishing';
import { dieCastingSpecAsCalculators } from '../../../../../modules/bom-items/costing/casting/calculators/die-casting-calculator-spec';

// Real data only: memory/Die Casting variables, lookups and machines, shaped
// as migration 845 stores them (MHR = Direct + Indirect OH, LHR = Labor Rate,
// specs snake_case).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const DIR = join(__dirname, '../../../../../../../memory/Die Casting');
const csv = (rel: string): Array<Record<string, any>> => readCsv(join(DIR, rel)).rows;
const vars = csv('Die casting_variables.csv').map((r) => ({ key: String(r['Variable Name']), value: r['String Value'] }));
const variable = (k: string) => vars.find((v) => v.key === k)!.value;
const { reference, missing } = resolveCoreReference({
  variables: vars,
  lookups: Object.fromEntries(CORE_LOOKUP_KEYS.map((k) => [k, csv(`Lookup/${k}.csv`)])),
});
const ref = reference!;

const snake = (h: string) => h.replace(/\s*\(.*?\)\s*/g, ' ').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
const machinesOf = (file: string): FinishingMachine[] => csv(`Machine/${file}`).map((r, i) => {
  const units: Record<string, string> = {};
  for (const [h, val] of Object.entries(r)) {
    const unit = /\(mm\)/.test(h) ? '_mm' : /\(s\)/.test(h) ? '_s' : '';
    units[`${snake(h)}${unit}`] = val;
  }
  return {
    id: `${file}${i}`, name: String(r['Name']),
    machineRatePerHr: Number(r['Direct Overhead Rate (USD/hr)']) + Number(r['Indirect Overhead Rate (USD/hr)']),
    labourRatePerHr: Number(r['Labor Rate (USD/hr)']), operators: Number(r['Number of Operators']), setupTimeHr: Number(r['Setup Time (hr)']),
    specs: units,
  };
});
const coremakers = machinesOf('core_making_machines.csv');
const coaters = machinesOf('core_refractory_coat.csv');
const airDryers = machinesOf('refractory_coat_air_dry.csv');
const ovens = machinesOf('refractory_coat_oven_dry.csv');
const ctx = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
// One 10 x 60 x 10 mm tunnel core (cad-engine core_geometry output shape).
const tunnel: CastingCore = { volumeMm3: 6000, boxMm: [60, 10, 10], areaMm2: 2 * (600 + 600 + 100) };
const base = { reference: ref, calculators: dieCastingSpecAsCalculators(), coremakers, coaters, airDryers, ovens, batchSize: 250, usdToLocal: 1, annualVolume: 100_000, productionLifeYears: 5, costContext: ctx };

describe('core reference (memory/Die Casting)', () => {
  it('resolves every variable and table the core route reads', () => {
    expect(missing).toEqual([]);
    expect(ref.coat).toBe(String(variable('defaultCoreRefractoryCoatingInclusion')).toLowerCase() === 'true');
    expect(ref.coatMethod.name).toBe(variable('defaultCoreRefractoryCoatingMethod'));
  });
});

describe('sand core route', () => {
  const r = priceCoreRoute({ ...base, cores: [tunnel] });
  const byProcess = (p: string) => r.lines.find((l) => l.process === p);

  it('coremaking: one blow per core on the cheapest machine whose corebox fits', () => {
    const line = byProcess('Coremaking')!;
    expect(line.physicsGap).toBeUndefined();
    const m = coremakers.find((c) => c.name === line.machineName)!;
    expect(line.featureBreakdown![0]!.timeSec).toBeCloseTo(Number(m.specs['base_cycle_time_s']), 6);
    const box = csv('Lookup/coreboxMaterial.csv').find((b) => b['Type'] === m.specs['corebox_material'])!;
    const allow = Number(box['Corebox Length Allowance (mm)']);
    expect(60 + 2 * allow).toBeLessThanOrEqual(Math.max(Number(m.specs['max_corebox_length_mm']), Number(m.specs['max_corebox_width_mm']), Number(m.specs['max_corebox_height_mm'])));
  });

  it('core sand: volume x density x New Cost of the machine sand type', () => {
    const m = coremakers.find((c) => c.name === byProcess('Coremaking')!.machineName)!;
    const sand = csv('Lookup/sand.csv').find((s) => s['Name'] === m.specs['core_sand_type'])!;
    const cost = (6000 / 1e9) * Number(sand['Density (kg / m^3)']) * Number(sand['New Cost (USD / kg)']);
    expect(byProcess('Core Sand')!.totalCost).toBeCloseTo(cost, 2);
    expect(byProcess('Core Sand')!.rateSource).toBe('consumable_allowance');
  });

  it('refractory coat: core area / method rate x applications; coating reported, not charged', () => {
    const line = byProcess('Core Refractory Coat')!;
    const method = csv('Lookup/tblRefractoryCoating.csv').find((m) => m['Application Method'] === ref.coatMethod.name)!;
    const sec = ((tunnel.areaMm2 / 1e6) / Number(method['Application Rate (m^2 / min)'])) * Number(variable('defaultNumCoreRefractoryCoatingApplications')) * 60;
    expect(line.featureBreakdown![0]!.timeSec).toBeCloseTo(sec, 2);
    expect(r.warnings.join(' ')).toMatch(/coating used: .* not charged/);
  });

  it('drying: the cheaper of air and oven; loads by bed volume, at most the batch', () => {
    const dry = r.lines.find((l) => /Refractory Coat (Air|Oven) Dry/.test(l.process))!;
    expect(dry.physicsGap).toBeUndefined();
    expect(dry.featureBreakdown![0]!.name).toMatch(/load/);
  });

  it('corebox: One Cavity Cost amortised over Refurb Life x (refurbs + 1) cores', () => {
    const m = coremakers.find((c) => c.name === byProcess('Coremaking')!.machineName)!;
    const box = csv('Lookup/coreboxMaterial.csv').find((b) => b['Type'] === m.specs['corebox_material'])!;
    const life = Number(box['Corebox Refurb Life']) * (Number(box['Corebox Refurbs Per Tool']) + 1);
    const boxes = Math.max(1, Math.ceil(500_000 / life));
    expect(r.corebox!.boxes).toBe(boxes);
    expect(r.corebox!.perPartUsd!).toBeCloseTo((boxes * Number(box['One Cavity Cost (USD)'])) / 500_000, 9);
    expect(r.corebox!.run.lookupMatches['One Cavity Cost']!.row).toEqual({ Type: m.specs['corebox_material'] });
  });

  it('every core line carries the calculator that computed it', () => {
    for (const p of ['Coremaking', 'Core Sand', 'Core Refractory Coat']) expect(byProcess(p)!.calculatorId).toBe(`Die Casting - ${p}`);
  });

  it('no annual volume: the corebox is not costed, and says so', () => {
    const g = priceCoreRoute({ ...base, annualVolume: null, cores: [tunnel] });
    expect(g.corebox).toBeNull();
    expect(g.warnings.join(' ')).toMatch(/Corebox .* not costed: annual volume not set/);
  });

  it('no cores, no core route', () => {
    expect(priceCoreRoute({ ...base, cores: [] }).lines).toEqual([]);
  });

  it('a core larger than every corebox is a named gap', () => {
    const huge: CastingCore = { volumeMm3: 1e9, boxMm: [5000, 5000, 5000], areaMm2: 1e8 };
    const g = priceCoreRoute({ ...base, cores: [huge] });
    expect(g.lines[0]!.physicsGap).toBeDefined();
    expect(g.lines[0]!.totalCost).toBe(0);
  });
});
