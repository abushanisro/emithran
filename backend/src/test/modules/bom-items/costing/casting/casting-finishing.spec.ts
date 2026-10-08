import { join } from 'path';
import { cleaningLine, meltingLine, partingLineGrindingLine, trimLine, visualInspectionLine, type FinishingMachine } from '../../../../../modules/bom-items/costing/casting/casting-finishing';
import { dieCastingSpecAsCalculators } from '../../../../../modules/bom-items/costing/casting/calculators/die-casting-calculator-spec';
import { castingSeed } from '../../../../../modules/bom-items/costing/casting/casting-calculator-seeds';

// The die-casting calculators exactly as migration 893 stores them.
const calculators = dieCastingSpecAsCalculators();
const weight = (kg: number) => castingSeed.calculator(kg, 'Net Material Usage');

// Real data: memory/Die Casting cleaning machines (shaped as migration 845
// stores them: MHR = Direct + Indirect OH, LHR = Labor Rate, specs snake_case)
// and tblVisualInspection.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const DIR = join(__dirname, '../../../../../../../memory/Die Casting');
const csv = (rel: string): Array<Record<string, any>> => readCsv(join(DIR, rel)).rows;

const cleaners: FinishingMachine[] = csv('Machine/cleaning_machines_shot_blast.csv').map((r, i) => ({
  id: `c${i}`, name: String(r['Name']),
  machineRatePerHr: Number(r['Direct Overhead Rate (USD/hr)']) + Number(r['Indirect Overhead Rate (USD/hr)']),
  labourRatePerHr: Number(r['Labor Rate (USD/hr)']), operators: Number(r['Number of Operators']), setupTimeHr: Number(r['Setup Time (hr)']),
  specs: {
    time_per_load_min: r['Time per Load (min)'], weight_capacity_kg: r['Weight Capacity (kg)'],
    max_height_mm: r['Max Height (mm)'], max_width_mm: r['Max Width (mm)'], max_batch_size: r['Max Batch Size'],
  },
}));
const rows = csv('Lookup/tblVisualInspection.csv').map((r) => ({
  maxWeightKg: Number(r['Max Weight (kg)']), internalMinPerM2: Number(r['Internal Inspection Rate (min / m^2)']), externalMinPerM2: Number(r['External Inspection Rate (min / m^2)']),
}));
const ctx = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
const inspector: FinishingMachine = { id: 'v', name: 'Default', machineRatePerHr: 14.15, labourRatePerHr: 57.19, operators: 1, setupTimeHr: 0.5, specs: {} };

describe('cleaning (machine load model)', () => {
  const r = cleaningLine({ machines: cleaners, calculators, partWeight: weight(0.39), partDimsMm: [107.1, 49.6, 107.1], batchSize: 250, processGroup: 'Die Casting', machineClass: 'die_casting_cleaning', costContext: ctx });

  it('per part = the chosen machine time per load / parts per load (capacity and max batch)', () => {
    const m = cleaners.find((c) => c.name === r.line.machineName)!;
    const parts = Math.min(Math.floor(Number(m.specs['weight_capacity_kg']) / 0.39), Number(m.specs['max_batch_size']));
    expect(r.line.featureBreakdown![0]!.timeSec).toBeCloseTo((Number(m.specs['time_per_load_min']) * 60) / parts, 2);
    expect(r.line.physicsGap).toBeUndefined();
    expect(r.line.calculatorId).toBe('Die Casting - Cleaning');
  });

  it('a part too heavy or too large for every machine is a named gap', () => {
    const big = cleaningLine({ machines: cleaners, calculators, partWeight: weight(1e6), partDimsMm: [1, 1, 1], batchSize: 250, processGroup: 'Die Casting', machineClass: 'die_casting_cleaning', costContext: ctx });
    expect(big.line.totalCost).toBe(0);
    expect(big.line.physicsGap).toBeDefined();
  });
});

describe('visual inspection (tblVisualInspection)', () => {
  it('surface area x the external rate of the first weight band at or above the part weight', () => {
    const r = visualInspectionLine({ machines: [inspector], calculators, rows, partMassKg: 0.39, surfaceAreaMm2: 43516.34, batchSize: 250, processGroup: 'Die Casting', machineClass: 'die_casting_visual_inspection', costContext: ctx });
    const band = [...rows].sort((a, b) => a.maxWeightKg - b.maxWeightKg).find((x) => x.maxWeightKg >= 0.39)!;
    expect(r.line.featureBreakdown![0]!.timeSec).toBeCloseTo((43516.34 / 1e6) * band.externalMinPerM2 * 60, 2);
  });
  it('no surface area: a named gap', () => {
    const r = visualInspectionLine({ machines: [inspector], calculators, rows, partMassKg: 0.39, surfaceAreaMm2: null, batchSize: 250, processGroup: 'Die Casting', machineClass: 'die_casting_visual_inspection', costContext: ctx });
    expect(r.line.physicsGap).toBeDefined();
  });
});

describe('trim (press cycle time, press force)', () => {
  const presses: FinishingMachine[] = csv('Machine/trim_presses.csv').map((r, i) => ({
    id: `t${i}`, name: String(r['Name']),
    machineRatePerHr: Number(r['Direct Overhead Rate (USD/hr)']) + Number(r['Indirect Overhead Rate (USD/hr)']),
    labourRatePerHr: Number(r['Labor Rate (USD/hr)']), operators: Number(r['Number of Operators']), setupTimeHr: Number(r['Setup Time (hr)']),
    specs: { cycle_time_s: r['Cycle Time (s)'], press_force_kn: r['Press Force (kN)'] },
  }));
  const parts = Number(csv('Die casting_variables.csv').find((r) => r['Variable Name'] === 'defaultNumberOfTrimmedParts')!['String Value']);
  const dims = csv('Lookup/tblGrindingDimensions.csv').map((r) => ({
    maxWeightKg: Number(r['Max Weight (kg)']), partingLineThicknessMm: Number(r['Parting Line Thickness (mm)']),
  }));
  const shear = Number(csv('Raw Material/materials_master.csv').find((r) => r['Name'] === 'Aluminum, AA 3105')!['Shear Strength (MPa)']);
  const base = { machines: presses, calculators, alloyName: 'Aluminum, AA 3105', partsPerStroke: parts, dimensions: dims, batchSize: 250, processGroup: 'Die Casting', machineClass: 'die_casting_trim', costContext: ctx };

  it('per part = the cheapest capable press cycle time / parts per stroke; force = perimeter x flash x shear', () => {
    const r = trimLine({ ...base, partingPerimeterMm: 336.36, partMassKg: 0.404, shearStrengthMpa: shear });
    const p = presses.find((m) => m.name === r.line.machineName)!;
    expect(r.line.featureBreakdown![0]!.timeSec).toBeCloseTo(Number(p.specs['cycle_time_s']) / parts, 2);
    const kn = (336.36 * dims.find((d) => d.maxWeightKg >= 0.404)!.partingLineThicknessMm * shear) / 1000;
    expect(Number(p.specs['press_force_kn'])).toBeGreaterThanOrEqual(kn);
    expect(r.line.machineChoice!.criteria.join(' ')).toContain('kN');
    expect(r.warnings.join(' ')).not.toMatch(/press force not checked/);
    expect(r.forceRun!.value).toBeCloseTo(kn, 4);
    expect(r.forceRun!.lookupMatches['Flash Thickness']!.table).toBe('tblGrindingDimensions');
  });
  it('a press below the trim force is not capable', () => {
    // A perimeter needing just over the middle press force, so the weaker half cannot trim it.
    const forces = [...new Set(presses.map((m) => Number(m.specs['press_force_kn'])))].sort((a, b) => a - b);
    const flashMm = dims.find((d) => d.maxWeightKg >= 0.404)!.partingLineThicknessMm;
    const perimeter = ((forces[Math.floor(forces.length / 2)]! + 1) * 1000) / (flashMm * shear);
    const r = trimLine({ ...base, partingPerimeterMm: perimeter, partMassKg: 0.404, shearStrengthMpa: shear });
    const required = (perimeter * flashMm * shear) / 1000;
    expect(Number(presses.find((m) => m.name === r.line.machineName)!.specs['press_force_kn'])).toBeGreaterThanOrEqual(required);
    const rejected = r.line.machineChoice!.candidates.filter((c) => c.status === 'rejected');
    expect(rejected.some((c) => c.reasons.some((x) => /below the .* kN trim force/.test(x)))).toBe(true);
  });
  it('no perimeter: the force check is named as not done', () => {
    const r = trimLine({ ...base, partingPerimeterMm: null, partMassKg: 0.404, shearStrengthMpa: shear });
    expect(r.warnings.join(' ')).toMatch(/press force not checked.*perimeter not measured/);
  });
});

describe('finishing (parting-line grinding)', () => {
  const grinders: FinishingMachine[] = csv('Machine/finishing_machines.csv').map((r, i) => ({
    id: `g${i}`, name: String(r['Name']),
    machineRatePerHr: Number(r['Direct Overhead Rate (USD/hr)']) + Number(r['Indirect Overhead Rate (USD/hr)']),
    labourRatePerHr: Number(r['Labor Rate (USD/hr)']), operators: Number(r['Number of Operators']), setupTimeHr: Number(r['Setup Time (hr)']),
    specs: {
      grinding_speed_parting_line_mm3_per_s: r['Grinding Speed Parting Line (mm^3/s)'],
      grinding_speed_gating_mm3_per_s: r['Grinding Speed Gating (mm^3/s)'], max_weight_kg: r['Max Weight (kg)'],
    },
  }));
  const dims = csv('Lookup/tblGrindingDimensions.csv').map((r) => ({
    maxWeightKg: Number(r['Max Weight (kg)']), partingLineThicknessMm: Number(r['Parting Line Thickness (mm)']), partingLineHeightMm: Number(r['Parting Line Height (mm)']),
    ingateHeightMm: Number(r['Ingate Height (mm)']),
  }));
  const varOf = (k: string) => Number(csv('Die casting_variables.csv').find((r) => r['Variable Name'] === k)!['String Value']);
  const gateVars = {
    additionalRunnerThickness: varOf('additionalRunnerThickness'), runnerAspectRatio: varOf('runnerAspectRatio'),
    ingateAreaToRunnerArea: varOf('ingateAreaToRunnerArea'), ingateGap: varOf('ingateGap'),
  };
  const al380 = csv('Raw Material/materials_master.csv').find((r) => r['Name'] === 'Aluminum, AA 380.0')!;
  const cutCode = Number(al380['Cut Code']);
  const factor = Number(csv('Lookup/tblGrindingSpeedMaterialFactor.csv')
    .find((r) => Number(r['Material Cut Code']) === Number(al380['Cut Code']))!['Grinding Speed Material Factor']);
  // LMH08715: thickest wall 12.357 mm, 107.08 mm long.
  const base = {
    machines: grinders, calculators, dimensions: dims, cutCode, speedFactorNote: 'n/a', gates: { ground: false as const, reason: 'not sized' },
    wallMaxMm: 12.357, partLengthMm: 107.08, variables: gateVars, batchSize: 250, processGroup: 'Die Casting', machineClass: 'die_casting_finishing', costContext: ctx,
  };

  it('flash = perimeter x tblGrindingDimensions thickness x height; time = volume / (speed x Cut Code factor), cheapest machine', () => {
    const r = partingLineGrindingLine({ ...base, partMassKg: 0.39, partingPerimeterMm: 300, speedFactor: factor });
    expect(r.line.physicsGap).toBeUndefined();
    const row = dims.find((d) => d.maxWeightKg >= 0.39)!;
    const vol = 300 * row.partingLineThicknessMm * row.partingLineHeightMm;
    const perPart = grinders.filter((m) => Number(m.specs['max_weight_kg']) >= 0.39).map((m) => {
      const sec = vol / (Number(m.specs['grinding_speed_parting_line_mm3_per_s']) * factor);
      return { m, sec, cost: (m.machineRatePerHr! + m.labourRatePerHr! * m.operators!) * sec / 3600 };
    }).sort((a, b) => a.cost - b.cost)[0]!;
    expect(r.line.machineName).toBe(perPart.m.name);
    expect(r.line.featureBreakdown![0]!.timeSec).toBeCloseTo(perPart.sec, 2);
    expect(r.warnings.join(' ')).toMatch(/gate stubs are not ground/);
  });

  it('HPDC ingate stubs: runner (thickest wall + additionalRunnerThickness) x runnerAspectRatio x ingateAreaToRunnerArea x Ingate Height, one per ingateGap', () => {
    const r = partingLineGrindingLine({ ...base, partMassKg: 0.404, partingPerimeterMm: 336.36, speedFactor: factor, gates: { ground: true } });
    expect(r.warnings.join(' ')).not.toMatch(/gate stubs are not ground/);
    const h = 12.357 + gateVars.additionalRunnerThickness;
    const area = h * h * gateVars.runnerAspectRatio * gateVars.ingateAreaToRunnerArea;
    const stub = dims.find((d) => d.maxWeightKg >= 0.404)!.ingateHeightMm;
    const count = Math.max(1, Math.ceil(107.08 / gateVars.ingateGap));
    expect(r.line.featureBreakdown![1]!.count).toBe(count);
    const m = grinders.find((x) => x.name === r.line.machineName)!;
    const gateSec = (count * area * stub) / (Number(m.specs['grinding_speed_gating_mm3_per_s']) * factor);
    expect(r.line.featureBreakdown![1]!.timeSec).toBeCloseTo(gateSec, 2);
    expect(r.line.calculatorId).toBe('Die Casting - Finishing');
  });

  it('no thickest wall: the finishing line is a named gap, not ground without its gate stubs', () => {
    const r = partingLineGrindingLine({ ...base, partMassKg: 0.404, partingPerimeterMm: 336.36, speedFactor: factor, gates: { ground: true }, wallMaxMm: null });
    expect(JSON.stringify(r.line.physicsGap)).toMatch(/thickest wall not measured/);
  });

  it('a part heavier than a machine carries is not ground on it', () => {
    const r = partingLineGrindingLine({ ...base, partMassKg: 30, partingPerimeterMm: 300, speedFactor: factor });
    const m = grinders.find((g) => g.name === r.line.machineName)!;
    expect(Number(m.specs['max_weight_kg'])).toBeGreaterThanOrEqual(30);
  });

  it('an alloy with no Cut Code factor or no measured parting line is a named gap', () => {
    const noFactor = partingLineGrindingLine({ ...base, partMassKg: 0.39, partingPerimeterMm: 300, speedFactor: null, speedFactorNote: 'no Cut Code' });
    expect(noFactor.line.physicsGap).toBeDefined();
    const noPerim = partingLineGrindingLine({ ...base, partMassKg: 0.39, partingPerimeterMm: null, speedFactor: factor });
    expect(noPerim.line.totalCost).toBe(0);
    expect(noPerim.line.physicsGap).toBeDefined();
  });
});

describe('melting (per kg, ductile-iron basis)', () => {
  const furnaces: FinishingMachine[] = csv('Machine/melting_furnaces.csv').map((r, i) => ({
    id: `f${i}`, name: String(r['Name']), machineRatePerHr: null, labourRatePerHr: Number(r['Labor Rate (USD/hr)']),
    operators: Number(r['Number of Operators']), setupTimeHr: Number(r['Setup Time (hr)']),
    specs: { furnace_capacity_m3: r['Furnace Capacity (m^3)'], max_temperature_c: r['Max Temperature (C)'] },
  }));
  // memory/Casting/Machine/pmmelting_machines.csv (HR Rates class casting_pm_melting).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const casting = (rel: string) => readCsv(join(__dirname, '../../../../../../../memory/Casting', rel)).rows as Array<Record<string, any>>;
  const di = Number(casting('Machine/pmmelting_machines.csv').find((r) => r['Name'] === 'Induction - DI')!['Conversion Cost (USD/kg)']);
  const v = (k: string) => Number(csv('Die casting_variables.csv').find((r) => r['Variable Name'] === k)!['String Value']);
  const base = {
    furnaces, calculators, ductileIron: { name: 'Induction - DI', costPerKg: di }, regionConvFactor: v('regionConvFactor'),
    furnaceCapacitySafetyFactor: v('furnaceCapacitySafetyFactor'), alloyName: 'Aluminum, AA 380.0', densityKgM3: 0.42 / 155_000 * 1e9,
    shotVolumeMm3: 310_000, cavities: 2, batchSize: 250, processGroup: 'Die Casting', machineClass: 'die_casting_melting',
  };

  it('cost = melted kg x regionConvFactor x the Induction - DI Conversion Cost', () => {
    const r = meltingLine({ ...base, injectionTempC: 650 });
    expect(r.line.physicsGap).toBeUndefined();
    expect(r.meltedKg!).toBeCloseTo(0.42, 9);
    expect(r.line.totalCost).toBeCloseTo(0.42 * v('regionConvFactor') * di, 2);
    expect(r.line.calculatorId).toBe('Die Casting - Melting');
  });

  it('the furnace reaches the alloy temperature and holds the batch with the safety factor', () => {
    const r = meltingLine({ ...base, injectionTempC: 650 });
    const f = furnaces.find((x) => x.name === r.line.machineName)!;
    expect(Number(f.specs['max_temperature_c'])).toBeGreaterThanOrEqual(650);
    expect(Number(f.specs['furnace_capacity_m3'])).toBeGreaterThanOrEqual((155_000 * 250 / 1e9) * v('furnaceCapacitySafetyFactor'));
    // A copper alloy (1100 C) cannot go in a crucible furnace (700 C).
    const hot = meltingLine({ ...base, injectionTempC: 1100 });
    expect(Number(furnaces.find((x) => x.name === hot.line.machineName)!.specs['max_temperature_c'])).toBeGreaterThanOrEqual(1100);
  });

  it('no conversion cost on file for the location: a named gap', () => {
    const r = meltingLine({ ...base, ductileIron: null, injectionTempC: 650 });
    expect(r.line.physicsGap).toBeDefined();
    expect(r.line.totalCost).toBe(0);
  });
});
