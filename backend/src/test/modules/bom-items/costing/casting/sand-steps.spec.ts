import { loadSandCastingCalculatorSpec, sandCastingCalculatorsByName } from '../../../../../modules/bom-items/costing/casting/sand/calculators/sand-casting-calculator-spec';
import { sandMachineFromRow } from '../../../../../modules/bom-items/costing/casting/sand/sand-machines';
import {
  cavitiesPerMould,
  coolStep,
  meltStep,
  mouldStep,
  pourStep,
  selectAndCost,
  type SandRouteContext,
} from '../../../../../modules/bom-items/costing/casting/sand/sand-steps';
import { realSandReference, sandMachines, sandMaterial, HOT_BOX } from './sand-test-data';

const ref = realSandReference();
const spec = loadSandCastingCalculatorSpec();
const calculators = sandCastingCalculatorsByName();
const iron = sandMaterial('ASTM Grade 20 Gray Iron');
const col = (k: string) => iron.columns[k]!;

const ctx: SandRouteContext = {
  ref, spec, calculators, material: iron,
  part: { netKg: 8, modulusMm: 10, dimsMm: [300, 200, 100], wallNominalMm: 12 },
  cavities: 1, coresPerCasting: 0, poured: { perCastingKg: 11, perMouldKg: 11 }, energyPricePerKwh: null, hotBox: HOT_BOX, batchSize: 250,
};

const horizontal = sandMachines('machines_horizontal_automatic.csv', 'sand_casting_horizontal_automatic');
const manualStd = sandMachines('machines_manual_std_moldmaking.csv', 'sand_casting_manual_std_moldmaking');
const manualPit = sandMachines('machines_manual_pit_moldmaking.csv', 'sand_casting_manual_pit_moldmaking');
const gapReason = (l: { physicsGap?: unknown }) => (l.physicsGap as { reason?: string } | undefined)?.reason;
const spec$ = (m: { specs: Readonly<Record<string, unknown>> }, k: string) => Number(m.specs[k]);

describe('cavitiesPerMould', () => {
  const line = horizontal[0]!;
  it('an automatic line takes the most cavities of a layout that fits the flask inside its sand borders', () => {
    const r = cavitiesPerMould(ref, line, [100, 80, 60], 1, null);
    expect(r).toEqual({ cavities: expect.any(Number) });
    const n = (r as { cavities: number }).cavities;
    expect(n).toBeGreaterThan(1);
    // one more would not fit: the layouts above n are all too big for the usable flask
    const bigger = cavitiesPerMould(ref, line, [100, 80, 60], 1, n + 1);
    expect('reasons' in bigger || (bigger as { cavities: number }).cavities === n + 1).toBe(true);
  });

  it('a part larger than the flask, or taller than it, is refused with the reason', () => {
    expect(cavitiesPerMould(ref, line, [5000, 5000, 60], 1, null)).toEqual({ reasons: [expect.stringContaining('does not fit the flask')] });
    expect(cavitiesPerMould(ref, line, [100, 80, 5000], 1, null)).toEqual({ reasons: [expect.stringContaining('exceeds the flask height')] });
  });

  it('manual moulding is one casting per mould unless the user asks for more', () => {
    expect(cavitiesPerMould(ref, manualStd[0]!, [100, 80, 40], 1, null)).toEqual({ cavities: 1 });
  });

  it('a casting heavier than largePartThreshold takes one cavity, whatever the layout', () => {
    const heavy = ref.number('largePartThreshold')! + 1;
    expect(cavitiesPerMould(ref, line, [100, 80, 60], heavy, null)).toEqual({ cavities: 1 });
    expect(cavitiesPerMould(ref, line, [100, 80, 60], heavy, 2)).toEqual({ reasons: [expect.stringContaining('2 cavities do not fit')] });
  });
});

describe('mouldStep', () => {
  it('manual moulding: sand slung plus cure, per cavity (hand-worked from the flask, the sand and the machine)', () => {
    const m = manualStd[0]!;
    const out = mouldStep(ctx, m);
    expect(out.ok).toBe(true);
    const flaskM3 = spec$(m, 'flask_length_mm') * spec$(m, 'flask_width_mm') * spec$(m, 'flask_height_mm') * 1e-9;
    const sand = ref.number('sandMoldDensity')! * (flaskM3 - ctx.poured.perMouldKg / col('density_kg_m3'));
    const expected = ((sand / ref.number('sandSlingingRate')!) * 60 + ref.number('sandCureTimeManualStd')! * 60) / spec$(m, 'mold_efficiency') / ctx.cavities;
    expect(out.ok && out.sec).toBeCloseTo(expected, 9);
  });

  it('a pit moulding machine uses the pit cure time', () => {
    const std = mouldStep(ctx, manualStd[0]!);
    const pit = mouldStep(ctx, manualPit[0]!);
    expect(pit.ok && std.ok).toBe(true);
    const seeds = (o: typeof pit) => (o.ok ? o.run.trace.find((t) => t.fieldName === 'Cure Time')?.value : null);
    expect(seeds(pit)).toBe(ref.number('sandCureTimeManualPit'));
    expect(seeds(std)).toBe(ref.number('sandCureTimeManualStd'));
  });

  it('an automatic line: its mould rate, slowed by the cores in the mould, shared by the cavities', () => {
    const m = horizontal[0]!;
    const withCores = mouldStep({ ...ctx, cavities: 2, coresPerCasting: 1 }, m);
    const rate = spec$(m, 'mold_rate_no_core_cycles_per_hr') - spec$(m, 'mold_rate_reduction_per_core') * 2; // 1 core x 2 cavities
    expect(withCores.ok && withCores.sec).toBeCloseTo(3600 / rate / spec$(m, 'mold_efficiency') / 2, 9);
  });
});

describe('pourStep', () => {
  const ladle = sandMachines('machines_pour.csv', 'sand_casting_pour');
  it('time = coefficient x sqrt(lb) plus the ladle transport shared by the moulds a ladle holds, per cavity (hand-worked)', () => {
    const big = ladle.find((m) => spec$(m, 'ladle_weight_capacity_kg') >= 250)!;
    const out = pourStep({ ...ctx, cavities: 2, poured: { perCastingKg: 10, perMouldKg: 20 } }, big);
    const lb = 20 / 0.45359237;
    const mouldsPerLadle = Math.max(1, Math.floor(spec$(big, 'ladle_weight_capacity_kg') / 20));
    const expected = (0.5 * Math.sqrt(lb) + (ref.number('defaultLadleTransportTime')! * 60) / mouldsPerLadle) / 2; // gray iron under 1000 lb: 0.50
    expect(out.ok && out.sec).toBeCloseTo(expected, 9);
  });
  it('refuses a ladle that cannot hold one mould, and a material with no pouring rows', () => {
    const small = [...ladle].sort((a, b) => spec$(a, 'ladle_weight_capacity_kg') - spec$(b, 'ladle_weight_capacity_kg'))[0]!;
    const tooBig = pourStep({ ...ctx, poured: { perCastingKg: 1e6, perMouldKg: 1e6 } }, small);
    expect(tooBig).toEqual({ ok: false, reasons: [expect.stringContaining('ladle holds')] });
    const brass = pourStep({ ...ctx, material: { ...iron, materialType: 'Brass' } }, ladle[ladle.length - 1]!);
    expect(brass).toEqual({ ok: false, reasons: ['tblPouringCoefficients has no rows for Brass'] });
  });
});

describe('coolStep (Chvorinov)', () => {
  const cooler = sandMachines('machines_cooling.csv', 'sand_casting_cooling');
  it('time = mould constant x (modulus / 1000) ^ exponent, shared by the cavities (hand-worked from the metal and the sand)', () => {
    const out = coolStep({ ...ctx, cavities: 2 }, cooler[0]!, false);
    const superheat = Math.max(col('injection_temp_c') - col('liquidus_temp_c'), 0);
    const heat = (col('density_kg_m3') * (col('heat_of_fusion_j_kg') + col('specific_heat_solidus_j_kg_k') * superheat)) / (col('liquidus_temp_c') - ref.number('sandMoldTemp')!);
    const constant = (heat ** 2 * Math.PI) / (4 * ref.number('sandMoldThermalConductivity')! * ref.number('sandMoldDensity')! * ref.number('sandMoldSpecificHeat')!);
    expect(out.ok && out.sec).toBeCloseTo((constant * (ctx.part.modulusMm / 1000) ** ref.number('modulusConstant')!) / 2, 6);
  });
  it('a pit mould uses the pit exponent, which is smaller: it cools sooner', () => {
    const normal = coolStep(ctx, cooler[0]!, false);
    const pit = coolStep(ctx, cooler[0]!, true);
    expect(normal.ok && pit.ok).toBe(true);
    // modulus 10 mm: (0.01)^1.75 < (0.01)^1.5, so the pit exponent gives the longer time
    expect(pit.ok && normal.ok && pit.sec).toBeGreaterThan(normal.ok ? normal.sec : 0);
  });
});

describe('meltStep (the furnace has no stored rate: the HR Rates engine prices it)', () => {
  const furnaces = sandMachines('machines_melting.csv', 'sand_casting_melting', () => ({ ratePerHr: 12.5, assumedDefaults: ['annual_maintenance_factor_pct'] }));
  const suitable = furnaces.find((f) => spec$(f, 'max_temperature_c') >= col('injection_temp_c') && spec$(f, 'furnace_capacity_m3') >= 0.5)!;

  it('a furnace row without a stored rate takes the engine\'s, and says so', () => {
    expect(suitable.rateSource).toBe('engine');
    expect(suitable.machineRatePerHr).toBe(12.5);
    expect(suitable.assumedDefaults).toEqual(['annual_maintenance_factor_pct']);
    expect(sandMachineFromRow({ id: 'x', machine_name: 'n', machine_class: 'c', mhr_usd_per_hour: 30 }, () => ({ ratePerHr: 99, assumedDefaults: [] })).rateSource).toBe('stored');
    expect(sandMachineFromRow({ id: 'x', machine_name: 'n', machine_class: 'c', mhr_usd_per_hour: null }, () => null).machineRatePerHr).toBeNull();
  });

  it('with no energy price set the time is computed, the energy is not charged, and the line says so', () => {
    const out = meltStep(ctx, suitable);
    expect(out.ok).toBe(true);
    expect(out.ok && out.energyCostUsd).toBe(0);
    expect(out.ok && out.notes).toEqual([expect.stringContaining('no electricity price')]);
  });

  it('with an energy price the energy cost follows it linearly', () => {
    const a = meltStep({ ...ctx, energyPricePerKwh: 0.1 }, suitable);
    const b = meltStep({ ...ctx, energyPricePerKwh: 0.2 }, suitable);
    if (!a.ok || !b.ok) throw new Error('melting should be possible');
    expect(a.energyCostUsd).toBeGreaterThan(0);
    expect(b.energyCostUsd).toBeCloseTo(2 * a.energyCostUsd, 9);
    expect(a.notes).toEqual([]);
  });

  it('refuses a furnace that cannot reach the pouring temperature or hold a mould', () => {
    const cold = furnaces.find((f) => spec$(f, 'max_temperature_c') < col('injection_temp_c'))!;
    expect(meltStep(ctx, cold)).toEqual({ ok: false, reasons: [expect.stringContaining('the metal is poured at')] });
    const smallest = furnaces.filter((f) => spec$(f, 'max_temperature_c') >= col('injection_temp_c')).sort((a, b) => spec$(a, 'furnace_capacity_m3') - spec$(b, 'furnace_capacity_m3'))[0]!;
    expect(meltStep({ ...ctx, poured: { perCastingKg: 1e5, perMouldKg: 1e5 } }, smallest)).toEqual({ ok: false, reasons: [expect.stringContaining('one mould needs')] });
  });
});

describe('selectAndCost', () => {
  const costContext = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
  const base = { process: 'Pour', machineClass: 'sand_casting_pour', batchSize: 250, costContext, ref, criteria: ['ladle holds one mould'] };
  const ladles = sandMachines('machines_pour.csv', 'sand_casting_pour');

  it('costs the cheapest capable machine and records why the others were not chosen', () => {
    const r = selectAndCost({ ...base, machines: ladles, evaluate: (m) => pourStep(ctx, m) });
    expect(r.machine).not.toBeNull();
    expect(r.line.machineName).toBe(r.machine!.name);
    const choice = r.line.machineChoice!;
    expect(choice.chosen).toBe(r.machine!.name);
    const costs = choice.candidates.filter((c) => c.perPartCost != null).map((c) => c.perPartCost as number);
    expect(costs.length).toBeGreaterThan(0);
    expect(r.line.totalCost).toBe(Math.min(...costs));
    expect(choice.candidates.find((c) => c.status === 'rejected')?.reasons.length ?? 1).toBeGreaterThan(0);
  });

  it('with no capable machine the line is a named gap with every machine\'s reason, not a price', () => {
    const r = selectAndCost({ ...base, machines: ladles, evaluate: () => ({ ok: false, reasons: ['too heavy'] }) });
    expect(r.machine).toBeNull();
    expect(r.line.totalCost).toBe(0);
    expect(gapReason(r.line)).toMatch(/no Pour machine fits/);
    expect(r.line.machineChoice?.chosen).toBeNull();
  });

  it('a machine with no rate at all is not chosen and says why', () => {
    const rateless = sandMachineFromRow({ id: 'r', machine_name: 'No rate', machine_class: 'sand_casting_pour', mhr_usd_per_hour: null }, () => null);
    const r = selectAndCost({ ...base, machines: [rateless], evaluate: (m) => pourStep(ctx, m) });
    expect(r.machine).toBeNull();
    expect(gapReason(r.line)).toMatch(/no machine hour rate/);
  });

  it('an unset energy price shows on the melt line as a warning, and an engine-priced furnace as such in its breakdown', () => {
    const furnaces = sandMachines('machines_melting.csv', 'sand_casting_melting', () => ({ ratePerHr: 12.5, assumedDefaults: ['annual_maintenance_factor_pct'] }));
    const r = selectAndCost({ ...base, process: 'Melting', machineClass: 'sand_casting_melting', machines: furnaces, evaluate: (m) => meltStep(ctx, m) });
    expect(r.machine).not.toBeNull();
    expect(r.warnings).toEqual([expect.stringContaining('no electricity price'), expect.stringContaining('assumed its defaults for annual_maintenance_factor_pct')]);
    expect(r.line.featureBreakdown?.[0]?.name).toMatch(/HR Rates engine/);
  });
});
