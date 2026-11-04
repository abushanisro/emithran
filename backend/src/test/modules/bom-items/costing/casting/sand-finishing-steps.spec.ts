import { loadSandCastingCalculatorSpec, sandCastingCalculatorsByName } from '../../../../../modules/bom-items/costing/casting/sand/calculators/sand-casting-calculator-spec';
import {
  cleanStep,
  degateStep,
  finishStep,
  inspectStep,
  interpolate,
  shakeoutStep,
  type SandFinishContext,
} from '../../../../../modules/bom-items/costing/casting/sand/sand-finishing-steps';
import { realSandReference, sandMachines, sandMaterial, sandRows, HOT_BOX } from './sand-test-data';

const ref = realSandReference();
const iron = sandMaterial('ASTM Grade 20 Gray Iron');
const spec$ = (m: { specs: Readonly<Record<string, unknown>> }, k: string) => Number(m.specs[k]);

const ctx: SandFinishContext = {
  ref, spec: loadSandCastingCalculatorSpec(), calculators: sandCastingCalculatorsByName(), material: iron,
  part: { netKg: 8, modulusMm: 10, dimsMm: [300, 200, 100], wallNominalMm: 12 },
  cavities: 1, coresPerCasting: 0, poured: { perCastingKg: 11, perMouldKg: 11 }, energyPricePerKwh: null, hotBox: HOT_BOX, batchSize: 250,
  surfaceAreaMm2: 250000,
  gates: { ingateAreaMm2: 300, ingateWidthMm: 30, riserContactMm2: 900, riserDiameterMm: 45 },
  partingLine: { value: 900, source: 'measured parting line' },
  coreSandKgPerMould: 0, coresCount: 0,
};

describe('interpolate (linear between rows, flat beyond the ends)', () => {
  const t = [[10, 0.5], [25, 1.0], [50, 2.0]] as const;
  it('reads between rows and holds the end values', () => {
    expect(interpolate(t, 17.5)).toBeCloseTo(0.75, 12);
    expect(interpolate(t, 5)).toBe(0.5);
    expect(interpolate(t, 500)).toBe(2);
    expect(interpolate([], 1)).toBeNull();
  });
});

describe('shakeoutStep', () => {
  const machines = sandMachines('machines_shakeout.csv', 'sand_casting_shakeout');
  const manual = machines.find((m) => m.specs['shakeout_type'] === 'manual')!;
  const conveyor = machines.find((m) => spec$(m, 'weight_capacity_kg') >= 250 && m.specs['shakeout_type'] !== 'manual')!;
  const table = sandRows('Lookup/lookupTables_Component_tblShakeoutTime.csv').map((r) => [Number(r['Rough Mass (kg)']), Number(r['Shakeout Time (min)'])] as const);

  it('a machine shakeout reads the time for the mould\'s rough mass (metal + core sand) and shares it over the cavities', () => {
    const c = { ...ctx, cavities: 2, poured: { perCastingKg: 11, perMouldKg: 22 }, coreSandKgPerMould: 3 };
    const out = shakeoutStep(c, conveyor);
    expect(out.ok && out.sec).toBeCloseTo((interpolate(table, 25)! * 60) / 2, 9);
  });

  it('manual shakeout is by the part\'s mass and has no cavities share', () => {
    const manualTable = sandRows('Lookup/lookupTables_Component_tblManualShakeoutTime.csv').map((r) => [Number(r['Part Mass (kg)']), Number(r['Shakeout Time (min)'])] as const);
    const out = shakeoutStep(ctx, manual);
    expect(out.ok && out.sec).toBeCloseTo(interpolate(manualTable, 8)! * 60, 9);
  });

  it('an automatic shakeout refuses a part longer than maxAutoShakeoutLength; manual shakeout does not', () => {
    const max = ref.number('maxAutoShakeoutLength')!;
    const long = { ...ctx, part: { ...ctx.part, dimsMm: [max + 1, 200, 100] as const } };
    expect(shakeoutStep(long, conveyor)).toEqual({ ok: false, reasons: [expect.stringContaining(`up to ${max} mm automatically`)] });
    expect(shakeoutStep(long, manual).ok).toBe(true);
    const exactly = { ...ctx, part: { ...ctx.part, dimsMm: [max, 200, 100] as const } };
    expect(shakeoutStep(exactly, conveyor).ok).toBe(true);
  });

  it('refuses a machine that cannot take the mould', () => {
    const tooHeavy = { ...ctx, poured: { perCastingKg: 1e6, perMouldKg: 1e6 } };
    expect(shakeoutStep(tooHeavy, conveyor)).toEqual({ ok: false, reasons: [expect.stringContaining('one mould holds')] });
  });
});

describe('degateStep', () => {
  const cutters = sandMachines('machines_degating.csv', 'sand_casting_degating');
  const cutter = cutters.find((m) => spec$(m, 'feed_rate_mm2_per_s') > 0 && spec$(m, 'max_weight_kg') >= 8 && spec$(m, 'max_cut_diameter_mm') >= 45)!;

  it('time = the cut area (ingates + riser contacts) over the feed rate (hand-worked: (300 + 900) / feed)', () => {
    const out = degateStep(ctx, cutter);
    expect(out.ok && out.sec).toBeCloseTo(1200 / spec$(cutter, 'feed_rate_mm2_per_s'), 9);
  });

  it('refuses machines that only break gates off, that cannot cut a gate this wide, or cannot take the part', () => {
    const hammer = cutters.find((m) => !(spec$(m, 'feed_rate_mm2_per_s') > 0))!; // the data has 19 of them (PowerHammer ...)
    expect(degateStep(ctx, hammer)).toEqual({ ok: false, reasons: [expect.stringContaining('no feed rate')] });
    const wide = { ...ctx, gates: { ...ctx.gates, riserDiameterMm: 5000 } };
    expect(degateStep(wide, cutter)).toEqual({ ok: false, reasons: [expect.stringContaining('wide')] });
    expect(degateStep({ ...ctx, part: { ...ctx.part, netKg: 1e6 } }, cutter)).toEqual({ ok: false, reasons: [expect.stringContaining('takes parts up to')] });
  });
});

describe('cleanStep', () => {
  const cleaners = sandMachines('machines_cleaning.csv', 'sand_casting_cleaning');
  const byLoads = cleaners.find((m) => spec$(m, 'time_per_load_min') > 0 && spec$(m, 'weight_capacity_kg') >= 100)!;
  const room = cleaners.find((m) => !(spec$(m, 'time_per_load_min') > 0) && spec$(m, 'external_surface_blast_rate_m2_per_min') > 0)!; // Room Blast

  it('by loads: time per load over the parts a load holds (weight capacity / part weight, at most the batch size)', () => {
    const perLoad = Math.min(Math.max(1, Math.floor(spec$(byLoads, 'weight_capacity_kg') / 8)), spec$(byLoads, 'max_batch_size') > 0 ? spec$(byLoads, 'max_batch_size') : Infinity);
    const out = cleanStep(ctx, byLoads);
    expect(out.ok && out.sec).toBeCloseTo((spec$(byLoads, 'time_per_load_min') * 60) / perLoad, 9);
  });

  it('in a blast room: the outer surface at the room\'s blast rate', () => {
    const out = cleanStep(ctx, room);
    expect(out.ok && out.sec).toBeCloseTo((250000 / 1e6 / spec$(room, 'external_surface_blast_rate_m2_per_min')) * 60, 9);
  });

  it('refuses a part heavier or wider than the machine takes', () => {
    expect(cleanStep({ ...ctx, part: { ...ctx.part, netKg: 1e7 } }, byLoads)).toEqual({ ok: false, reasons: [expect.stringContaining('a load')] });
    const limited = cleaners.find((m) => spec$(m, 'time_per_load_min') > 0 && spec$(m, 'max_height_mm') > 0 && spec$(m, 'weight_capacity_kg') >= 8)!;
    expect(cleanStep({ ...ctx, part: { ...ctx.part, dimsMm: [300, 200, 1e6] } }, limited)).toEqual({ ok: false, reasons: [expect.stringContaining('max_height_mm')] });
  });
});

describe('finishStep (grinding the gates and the parting line)', () => {
  const grinders = sandMachines('machines_finishing.csv', 'sand_casting_finishing');
  const g = grinders.find((m) => spec$(m, 'max_weight_kg') >= 8)!;
  const dims = sandRows('Lookup/lookupTables_Component_tblGrindingDimensions.csv').find((r) => Number(r['Max Weight (kg)']) >= 8)!;
  const factor = Number(sandRows('Lookup/lookupTables_Component_tblGrindingSpeedMaterialFactor.csv').find((r) => Math.abs(Number(r['Material Cut Code']) - iron.columns['cut_code']!) < 1e-9)!['Grinding Speed Material Factor']);

  it('time = the gate stubs at the gating grind speed plus the flash at the non-gating speed, both by the material factor (hand-worked)', () => {
    const stubs = 300 * Number(dims['Ingate Height (mm)']) + 900 * Number(dims['Riser Height (mm)']);
    const flash = 900 * Number(dims['Parting Line Thickness (mm)']) * Number(dims['Parting Line Height (mm)']);
    const expected = stubs / (spec$(g, 'grinding_speed_gating_mm3_per_s') * factor) + flash / (spec$(g, 'grinding_speed_non_gating_mm3_per_s') * factor);
    const out = finishStep(ctx, g);
    expect(out.ok && out.sec).toBeCloseTo(expected, 9);
  });

  it('names what is missing: a material with no cut code, or one the factor table has no row for', () => {
    expect(finishStep({ ...ctx, material: { ...iron, columns: { ...iron.columns, cut_code: null } } }, g)).toEqual({ ok: false, reasons: [expect.stringContaining('cut_code')] });
    expect(finishStep({ ...ctx, material: { ...iron, columns: { ...iron.columns, cut_code: 777.7 } } }, g)).toEqual({ ok: false, reasons: [expect.stringContaining('no row for cut code 777.7')] });
  });
});

describe('inspectStep', () => {
  const inspector = sandMachines('machines_visual_inspection.csv', 'sand_casting_visual_inspection')[0]!;
  const band = sandRows('Lookup/lookupTables_Component_tblVisualInspection.csv').find((r) => Number(r['Max Weight (kg)']) >= 8)!;
  const base = (250000 / 1e6) * Number(band['External Inspection Rate (min / m^2)']) * 60;

  it('time = surface x the rate for the part\'s weight, and cores raise it: none 1, one the single factor, three double + adder', () => {
    const at = (cores: number) => { const o = inspectStep({ ...ctx, coresCount: cores }, inspector); return o.ok ? o.sec : NaN; };
    expect(at(0)).toBeCloseTo(base, 9);
    expect(at(1)).toBeCloseTo(base * ref.number('singleCoreInspectionFactor')!, 9);
    expect(at(3)).toBeCloseTo(base * (ref.number('doubleCoreInspectionFactor')! + ref.number('multiCoreInspectionFactor')! * 1), 9);
  });
});
