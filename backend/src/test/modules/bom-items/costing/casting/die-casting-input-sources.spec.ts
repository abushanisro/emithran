import { join } from 'path';
import { CASTING_LOOKUP_KEYS, resolveCastingMaterial, resolveCastingReference, type CastingReferenceRows } from '../../../../../modules/bom-items/costing/casting/casting-reference';
import type { HpdcMachine } from '../../../../../modules/bom-items/costing/casting/hpdc-machine';
import { computeHpdc } from '../../../../../modules/bom-items/costing/casting/hpdc-engine';
import { computeGdc } from '../../../../../modules/bom-items/costing/casting/gdc-engine';
import { cleaningLine, meltingLine, visualInspectionLine, type FinishingMachine } from '../../../../../modules/bom-items/costing/casting/casting-finishing';
import { DIE_TOOLING_LOOKUP_KEYS, computeDieTooling, pressDieBorders, resolveDieToolingReference } from '../../../../../modules/bom-items/costing/casting/die-tooling';
import { dieCastingSpecAsCalculators } from '../../../../../modules/bom-items/costing/casting/calculators/die-casting-calculator-spec';
import { castingSeed } from '../../../../../modules/bom-items/costing/casting/casting-calculator-seeds';
import { runReferenceCalculator } from '../../../../../modules/bom-items/costing/shared/calculators/reference-calculator';
import type { CalculationTraceStep, SourceRef } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';

// Every die-casting calculator input says where it was read (its SourceRef), so the calculator dialog's eye opens that record or
// table with the row marked. A real aluminium part through the HPDC and GDC lines, finishing and die tooling, with the real
// calculators and memory/Die Casting (no mocks).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const MEM = join(__dirname, '../../../../../../../memory');
const csvFile = (rel: string) => readCsv(join(MEM, rel)) as { headers?: string[]; rows: Array<Record<string, any>> };
const csv = (rel: string): Array<Record<string, any>> => csvFile(rel).rows;
const DC = (rel: string) => csv(`Die Casting/${rel}`);

const calculators = dieCastingSpecAsCalculators();
const ctx = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
const refRows: CastingReferenceRows = {
  variables: DC('Die casting_variables.csv').map((r) => ({ key: String(r['Variable Name']), value: r['String Value'] })),
  lookups: Object.fromEntries(CASTING_LOOKUP_KEYS.map((k) => [k, DC(`Lookup/${k}.csv`)])),
};
const ref = resolveCastingReference(refRows).reference!;
const toolingRef = resolveDieToolingReference({
  variables: refRows.variables,
  lookups: Object.fromEntries(DIE_TOOLING_LOOKUP_KEYS.map((k) => [k, DC(`Lookup/${k}.csv`)])),
  toolShop: {
    digital_factory_settings_usa: csv('plastic modeling/process/digital_factory_settings_usa.csv'),
    digital_factory_tool_materials_usa: csv('plastic modeling/process/digital_factory_tool_materials_usa.csv'),
  },
}).reference!;

const PROPS: Record<string, string> = {
  chamber_type: 'Chamber Type', clamping_pressure: 'Clamping Pressure (MPa)', cooling_factor: 'Cooling Factor (s/mm)',
  injection_temp: 'Injection Temp (C)', liquidus_temp: 'Liquidus Temp (C)', solidus_temp: 'Solidus Temp (C)',
  mold_temp: 'Mold Temp (C)', die_life: 'Die Life (cycles)', yield_loss_factor: 'Yield Loss Factor', shear_strength: 'Shear Strength (MPa)',
};
const ALLOY_ID = 'raw-material-al380';
const alloyRow = DC('Raw Material/materials_master.csv').find((m) => m['Name'] === 'Aluminum, AA 380.0')!;
const alloy = resolveCastingMaterial({
  row: { id: ALLOY_ID, name: alloyRow['Name'], material_type: alloyRow['Material Type'], density_kg_m3: alloyRow['Density (kg/m^3)'], cost_usa: alloyRow['Unit Cost (USD/kg)'], cut_code: alloyRow['Cut Code'] },
  properties: Object.fromEntries(Object.entries(PROPS).map(([k, h]) => [k, alloyRow[h] === '' ? null : Number(alloyRow[h])])),
});

const crew = (r: Record<string, any>) => ({
  machineRatePerHr: Number(r['Direct Overhead Rate (USD/hr)']) + Number(r['Indirect Overhead Rate (USD/hr)']),
  labourRatePerHr: Number(r['Labor Rate (USD/hr)']), operators: Number(r['Number of Operators']), setupTimeHr: Number(r['Setup Time (hr)']),
});
const hpdcMachines: HpdcMachine[] = DC('Machine/high_pressure_die_casting_machines.csv').map((r, i) => ({
  id: `h${i}`, name: String(r['Name']), ...crew(r), clampingForceKn: Number(r['Clamping Force (kN)']),
  tieBarHorMm: Number(r['Tie Bar Distance Hor (mm)']), tieBarVertMm: Number(r['Tie Bar Distance Vert (mm)']),
  maxMoldHeightMm: Number(r['Max Mold Height (mm)']), dryCycleTimeS: Number(r['Dry Cycle Time (s)']),
}));
const gdcMachines: HpdcMachine[] = DC('Machine/gravity_die_casting_machines.csv').map((r, i) => ({
  id: `g${i}`, name: String(r['Name']), ...crew(r), clampingForceKn: null,
  tieBarHorMm: Number(r['Tie Bar Distance Hor (mm)']), tieBarVertMm: Number(r['Tie Bar Distance Vert (mm)']),
  maxMoldHeightMm: Number(r['Max Mold Height (mm)']), dryCycleTimeS: Number(r['Dry Cycle Time (s)']), moldEfficiency: Number(r['Mold Efficiency']),
}));
const fin = (file: string, specs: (r: Record<string, any>) => Record<string, unknown>): FinishingMachine[] =>
  DC(`Machine/${file}`).map((r, i) => ({ id: `${file}${i}`, name: String(r['Name']), ...crew(r), specs: specs(r) }));
const cleaners = fin('cleaning_machines_shot_blast.csv', (r) => ({ time_per_load_min: r['Time per Load (min)'], weight_capacity_kg: r['Weight Capacity (kg)'], max_height_mm: r['Max Height (mm)'], max_width_mm: r['Max Width (mm)'], max_batch_size: r['Max Batch Size'] }));
const inspectors = fin('visual_inspection.csv', () => ({}));
const furnaces = DC('Machine/melting_furnaces.csv').map((r, i): FinishingMachine => ({
  id: `f${i}`, name: String(r['Name']), machineRatePerHr: null, labourRatePerHr: Number(r['Labor Rate (USD/hr)']), operators: Number(r['Number of Operators']),
  setupTimeHr: Number(r['Setup Time (hr)']), specs: { furnace_capacity_m3: r['Furnace Capacity (m^3)'], max_temperature_c: r['Max Temperature (C)'] },
}));
const diConversion = Number(csv('Casting/Machine/pmmelting_machines.csv').find((r) => r['Name'] === 'Induction - DI')!['Conversion Cost (USD/kg)']);

const part = {
  volumeMm3: 120_000, surfaceAreaMm2: 60_000, projectedAreaMm2: 14_000, footprintMm: [160, 110] as [number, number],
  wallNominalMm: 3, wallMaxMm: 8, pullExtentMm: 40, lengthMm: 160, featureCount: 300,
};
const geometry = {
  projectedAreaMm2: part.projectedAreaMm2, footprintMm: part.footprintMm, wallNominalMm: part.wallNominalMm, wallMaxMm: part.wallMaxMm,
  partVolumeMm3: part.volumeMm3, partLengthMm: part.lengthMm,
};

const hpdc = computeHpdc({ reference: ref, referenceMissing: [], calculators, material: alloy, materialGrade: alloy.name, geometry, machines: hpdcMachines, batchSize: 1000, costContext: ctx });
const gdc = computeGdc({ reference: ref, referenceMissing: [], calculators, material: alloy, materialGrade: alloy.name, geometry, machines: gdcMachines, batchSize: 1000, coreCount: 0, costContext: ctx });

/** The input step of a trace by field name. */
const input = (trace: readonly CalculationTraceStep[] | undefined, field: string) => {
  const step = (trace ?? []).find((s) => s.kind === 'input' && s.fieldName === field);
  if (!step) throw new Error(`no input ${field} in the trace`);
  return step;
};

describe('die-casting calculator inputs carry where they were read (SourceRef)', () => {
  it('HPDC: the chosen machine\'s Dry Cycle Time names the machine record and its real spec key', () => {
    const line = hpdc.processLines[0]!;
    expect(line.physicsGap).toBeUndefined();
    expect(input(line.calculationTrace, 'Dry Cycle Time').ref).toEqual({
      kind: 'machine', machineId: hpdc.machine!.id, machineName: hpdc.machine!.name, column: 'dry_cycle_time_s',
    });
  });

  it('HPDC: an alloy property names the alloy\'s raw_materials record and its property_key', () => {
    const trace = hpdc.processLines[0]!.calculationTrace;
    expect(input(trace, 'Mold Temp').ref).toEqual({ kind: 'material', materialId: ALLOY_ID, materialName: alloy.name, column: 'mold_temp' });
    expect(input(trace, 'Cooling Factor').ref).toMatchObject({ kind: 'material', materialId: ALLOY_ID, column: 'cooling_factor' });
    expect(input(hpdc.calculatorRuns['Clamp Force']!.trace, 'Clamping Pressure').ref).toMatchObject({ kind: 'material', materialId: ALLOY_ID, column: 'clamping_pressure' });
  });

  it('HPDC: a variable names its die_casting variable; a lookup names its staged table, column and row', () => {
    const trace = hpdc.processLines[0]!.calculationTrace;
    expect(input(trace, 'Ladle Fill Time').ref).toEqual({ kind: 'variable', domain: 'die_casting', name: 'ladleFillTime' });
    expect(input(trace, 'Percent Solids').ref).toEqual({
      kind: 'lookup', domain: 'die_casting', table: 'tblPercentSolids', column: 'Percent Solids', row: { Index: ref.defaultSurfaceQuality!.index },
    });
    expect(input(trace, 'Latent Heat Constant').ref).toEqual({
      kind: 'lookup', domain: 'die_casting', table: 'tblLatentHeatConstant', column: 'Latent Heat Constant (°C)', row: { 'Material Name': alloy.materialType },
    });
  });

  it('GDC: Mold Efficiency names the machine\'s mold_efficiency; the part volume names its CAD faces', () => {
    const trace = gdc.processLines[0]!.calculationTrace;
    expect(input(trace, 'Mold Efficiency').ref).toEqual({ kind: 'machine', machineId: gdc.machine!.id, machineName: gdc.machine!.name, column: 'mold_efficiency' });
    const vol = input(trace, 'Part Volume');
    expect(vol.ref).toEqual({ kind: 'cad', evidence: 'part_volume' });
    expect(vol.evidence).toBe('part_volume');
    // A CAD value that is not a whole-part measurement names no faces.
    expect(input(trace, 'Projected Area').ref).toBeUndefined();
  });

  it('finishing: a machine spec, the part weight\'s calculation, a lookup row and the part surface', () => {
    const net = runReferenceCalculator(calculators, 'Net Material Usage', {
      'Part Volume': castingSeed.cad(part.volumeMm3, 'part volume (mm³)', 'part_volume'),
      Density: castingSeed.alloy(alloy, 'density_kg_m3', 'Density (kg/m^3)', alloy.densityKgM3!),
    }, 'Net Usage');
    expect(input(net.trace, 'Density').ref).toMatchObject({ kind: 'material', materialId: ALLOY_ID, column: 'density_kg_m3' });
    const common = { processGroup: 'Die Casting', costContext: ctx, batchSize: 1000, calculators };
    const cleaning = cleaningLine({
      ...common, machines: cleaners, partWeight: castingSeed.calculator(net.value!, 'Net Material Usage', net, 'part_volume'),
      partDimsMm: [160, 110, 40], machineClass: 'die_casting_cleaning',
    }).line;
    const perLoad = input(cleaning.calculationTrace, 'Time per Load');
    expect(perLoad.ref).toEqual({ kind: 'machine', machineId: cleaning.mhrId, machineName: cleaning.machineName, column: 'time_per_load_min' });
    expect(input(cleaning.calculationTrace, 'Part Weight').ref).toEqual({ kind: 'calculation', name: 'Net Material Usage', evidence: 'part_volume', steps: net.trace });

    const inspection = visualInspectionLine({
      ...common, machines: inspectors, rows: ref.visualInspection, partMassKg: net.value, surfaceAreaMm2: part.surfaceAreaMm2, machineClass: 'die_casting_visual_inspection',
    }).line;
    expect(input(inspection.calculationTrace, 'Surface Area').ref).toEqual({ kind: 'cad', evidence: 'part_surface' });
    expect(input(inspection.calculationTrace, 'External Inspection Rate').ref).toMatchObject({
      kind: 'lookup', domain: 'die_casting', table: 'tblVisualInspection', column: 'External Inspection Rate (min / m^2)',
    });
  });

  it('melting: the shot volume names the run that computed it; the melter\'s Conversion Cost its record', () => {
    const melt = meltingLine({
      furnaces, calculators, ductileIron: { id: 'induction-di', name: 'Induction - DI', costPerKg: diConversion },
      regionConvFactor: ref.variables.regionConvFactor, furnaceCapacitySafetyFactor: ref.variables.furnaceCapacitySafetyFactor,
      shotVolumeMm3: hpdc.shotVolumeMm3, shotVolumeRun: hpdc.shotVolumeRun, cavities: hpdc.cavities!.count,
      alloy, densityKgM3: alloy.densityKgM3, injectionTempC: alloy.injectionTempC, batchSize: 1000, processGroup: 'Die Casting', machineClass: 'die_casting_melting',
    }).line;
    expect(input(melt.calculationTrace, 'Shot Volume').ref).toEqual({ kind: 'calculation', name: 'Shot Volume', evidence: 'part_volume', steps: hpdc.shotVolumeRun!.trace });
    expect(input(melt.calculationTrace, 'Conversion Cost').ref).toMatchObject({ kind: 'machine', machineId: 'induction-di', column: 'conversion_cost_usd_per_kg' });
    expect(input(melt.calculationTrace, 'Density').ref).toMatchObject({ kind: 'material', materialId: ALLOY_ID, column: 'density_kg_m3' });
  });

  it('die tooling: a tool shop rate names its plastic-molding table; a calculator output the run behind it', () => {
    const borders = pressDieBorders(toolingRef, hpdc.machine!.clampingForceKn!);
    if (!('borders' in borders)) throw new Error(borders.reason);
    const die = computeDieTooling({
      reference: toolingRef, calculators, borders: borders.borders, pressForceKn: hpdc.machine!.clampingForceKn, cavities: hpdc.cavities!, footprintMm: part.footprintMm,
      pullExtentMm: part.pullExtentMm, projectedAreaMm2: part.projectedAreaMm2, surfaceAreaMm2: part.surfaceAreaMm2, featureCount: part.featureCount,
      slideCount: 0, slideWidthsMm: [], materialType: alloy.materialType, annualVolume: 50_000, productionLifeYears: 5, location: 'USA',
    });
    const cost = die.runs['Die Cost']!.trace;
    expect(input(cost, 'H13 Price').ref).toEqual({
      kind: 'lookup', domain: 'injection_molding', table: 'digital_factory_tool_materials_usa', column: 'materialCostUsdPerKg', row: { name: 'AISI H13' },
    });
    expect(input(cost, 'Total Steel Weight').ref).toMatchObject({ kind: 'calculation', name: 'Die Build', steps: die.runs['Die Build']!.trace });
    expect(input(die.runs['Die Build']!.trace, 'Die Length').ref).toMatchObject({ kind: 'calculation', name: 'Die Size', steps: die.runs['Die Size']!.trace });
  });

  it('every die_casting lookup ref names a real staged column and a row that exists; every variable ref a real variable', () => {
    const traces = [
      ...hpdc.processLines.map((l) => l.calculationTrace), ...Object.values(hpdc.calculatorRuns).map((r) => r.trace),
      ...gdc.processLines.map((l) => l.calculationTrace),
    ];
    const refs = traces.flatMap((t) => (t ?? []).map((s) => s.ref)).filter((r): r is SourceRef => !!r);
    const variables = new Set(refRows.variables.map((v) => v.key));
    const lookups = refs.filter((r): r is Extract<SourceRef, { kind: 'lookup' }> => r.kind === 'lookup');
    expect(lookups.length).toBeGreaterThan(0);
    for (const r of lookups) {
      const rows = DC(`Lookup/${r.table}.csv`);
      expect(Object.keys(rows[0]!)).toContain(r.column);
      expect(rows.some((row) => Object.entries(r.row ?? {}).every(([k, v]) => String(row[k]) === String(v)))).toBe(true);
    }
    for (const r of refs) if (r.kind === 'variable') expect(variables.has(r.name)).toBe(true);
  });
});
