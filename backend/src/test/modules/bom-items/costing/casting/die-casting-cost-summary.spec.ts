import { join } from 'path';
import { expectSetupContract } from '../shared/setup-contract';
import { CASTING_LOOKUP_KEYS, resolveCastingMaterial, resolveCastingReference, type CastingReferenceRows } from '../../../../../modules/bom-items/costing/casting/casting-reference';
import type { HpdcMachine } from '../../../../../modules/bom-items/costing/casting/hpdc-machine';
import { computeHpdc } from '../../../../../modules/bom-items/costing/casting/hpdc-engine';
import { computeGdc } from '../../../../../modules/bom-items/costing/casting/gdc-engine';
import { buildCastingCostSummary } from '../../../../../modules/bom-items/costing/casting/casting-cost-summary';
import { cleaningLine, meltingLine, partingLineGrindingLine, trimLine, visualInspectionLine, type FinishingMachine } from '../../../../../modules/bom-items/costing/casting/casting-finishing';
import { DIE_TOOLING_LOOKUP_KEYS, computeDieTooling, pressDieBorders, resolveDieToolingReference } from '../../../../../modules/bom-items/costing/casting/die-tooling';
import { dieCastingSpecAsCalculators } from '../../../../../modules/bom-items/costing/casting/calculators/die-casting-calculator-spec';
import { castingSeed } from '../../../../../modules/bom-items/costing/casting/casting-calculator-seeds';
import { runReferenceCalculator } from '../../../../../modules/bom-items/costing/shared/calculators/reference-calculator';

// A representative aluminium HPDC part through the Cost Summary with the real
// calculators and the real memory/Die Casting data (no mocks).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const MEM = join(__dirname, '../../../../../../../memory');
const csv = (rel: string): Array<Record<string, any>> => readCsv(join(MEM, rel)).rows;
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
const alloyRow = DC('Raw Material/materials_master.csv').find((m) => m['Name'] === 'Aluminum, AA 380.0')!;
const alloy = resolveCastingMaterial({
  row: { name: alloyRow['Name'], material_type: alloyRow['Material Type'], density_kg_m3: alloyRow['Density (kg/m^3)'], cost_usa: alloyRow['Unit Cost (USD/kg)'], cut_code: alloyRow['Cut Code'] },
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
const trimPresses = fin('trim_presses.csv', (r) => ({ cycle_time_s: r['Cycle Time (s)'], press_force_kn: r['Press Force (kN)'] }));
const grinders = fin('finishing_machines.csv', (r) => ({ grinding_speed_parting_line_mm3_per_s: r['Grinding Speed Parting Line (mm^3/s)'], grinding_speed_gating_mm3_per_s: r['Grinding Speed Gating (mm^3/s)'], max_weight_kg: r['Max Weight (kg)'] }));
const inspectors = fin('visual_inspection.csv', () => ({}));
const furnaces = DC('Machine/melting_furnaces.csv').map((r, i): FinishingMachine => ({
  id: `f${i}`, name: String(r['Name']), machineRatePerHr: null, labourRatePerHr: Number(r['Labor Rate (USD/hr)']), operators: Number(r['Number of Operators']),
  setupTimeHr: Number(r['Setup Time (hr)']), specs: { furnace_capacity_m3: r['Furnace Capacity (m^3)'], max_temperature_c: r['Max Temperature (C)'] },
}));
const diConversion = Number(csv('Casting/Machine/pmmelting_machines.csv').find((r) => r['Name'] === 'Induction - DI')!['Conversion Cost (USD/kg)']);

// A 160 x 110 x 40 mm housing, 120 cm3 of aluminium.
const part = {
  volumeMm3: 120_000, surfaceAreaMm2: 60_000, projectedAreaMm2: 14_000, footprintMm: [160, 110] as [number, number],
  wallNominalMm: 3, wallMaxMm: 8, perimeterMm: 520, pullExtentMm: 40, lengthMm: 160, featureCount: 300,
};
const geometry = {
  projectedAreaMm2: part.projectedAreaMm2, footprintMm: part.footprintMm, wallNominalMm: part.wallNominalMm, wallMaxMm: part.wallMaxMm,
  partVolumeMm3: part.volumeMm3, partLengthMm: part.lengthMm,
};

function costPart(batchSize: number, process: 'hpdc' | 'gdc' = 'hpdc', annualVolume: number | null = 50_000) {
  const line = process === 'hpdc'
    ? computeHpdc({ reference: ref, referenceMissing: [], calculators, material: alloy, materialGrade: alloy.name, geometry, machines: hpdcMachines, batchSize, costContext: ctx })
    : computeGdc({ reference: ref, referenceMissing: [], calculators, material: alloy, materialGrade: alloy.name, geometry, machines: gdcMachines, batchSize, coreCount: 0, costContext: ctx });
  const net = runReferenceCalculator(calculators, 'Net Material Usage', {
    'Part Volume': castingSeed.cad(part.volumeMm3, 'v'), Density: castingSeed.alloy(alloy.name, 'Density (kg/m^3)', alloy.densityKgM3!),
  }, 'Net Usage').value!;
  const common = { processGroup: 'Die Casting', costContext: ctx, batchSize, calculators };
  const cleaning = cleaningLine({ ...common, machines: cleaners, partWeight: castingSeed.calculator(net, 'Net Material Usage'), partDimsMm: [160, 110, 40], machineClass: 'die_casting_cleaning' });
  const inspection = visualInspectionLine({ ...common, machines: inspectors, rows: ref.visualInspection, partMassKg: net, surfaceAreaMm2: part.surfaceAreaMm2, machineClass: 'die_casting_visual_inspection' });
  const trim = trimLine({
    ...common, machines: trimPresses, alloyName: alloy.name, partsPerStroke: ref.variables.defaultNumberOfTrimmedParts, partingPerimeterMm: part.perimeterMm,
    partMassKg: net, dimensions: ref.grindingDimensions, shearStrengthMpa: alloy.shearStrengthMpa, machineClass: 'die_casting_trim',
  });
  const grinding = partingLineGrindingLine({
    ...common, machines: grinders, partMassKg: net, cutCode: alloy.cutCode, partingPerimeterMm: part.perimeterMm, dimensions: ref.grindingDimensions,
    speedFactor: ref.grindingSpeedFactorByCutCode.get(alloy.cutCode!) ?? null, speedFactorNote: 'no factor',
    gates: process === 'hpdc' ? { ground: true } : { ground: false, reason: 'gravity' }, wallMaxMm: part.wallMaxMm, partLengthMm: part.lengthMm,
    variables: ref.variables, machineClass: 'die_casting_finishing',
  });
  const melting = meltingLine({
    furnaces, calculators, ductileIron: { name: 'Induction - DI', costPerKg: diConversion }, regionConvFactor: ref.variables.regionConvFactor,
    furnaceCapacitySafetyFactor: ref.variables.furnaceCapacitySafetyFactor, shotVolumeMm3: line.shotVolumeMm3, cavities: line.cavities?.count ?? null,
    alloyName: alloy.name, densityKgM3: alloy.densityKgM3, injectionTempC: alloy.injectionTempC, batchSize, processGroup: 'Die Casting', machineClass: 'die_casting_melting',
  });
  const borders = line.machine && process === 'hpdc' ? pressDieBorders(toolingRef, line.machine.clampingForceKn!) : null;
  const dieTooling = line.machine && borders && 'borders' in borders
    ? computeDieTooling({
      reference: toolingRef, calculators, borders: borders.borders, pressForceKn: line.machine.clampingForceKn, cavities: line.cavities!, footprintMm: part.footprintMm,
      pullExtentMm: part.pullExtentMm, projectedAreaMm2: part.projectedAreaMm2, surfaceAreaMm2: part.surfaceAreaMm2, featureCount: part.featureCount,
      slideCount: 0, slideWidthsMm: [], materialType: alloy.materialType, annualVolume, productionLifeYears: 5, location: 'USA',
    })
    : null;
  const summary = buildCastingCostSummary({
    family: 'die_cast', process: 'die_casting', hpdc: line, materialGrade: alloy.name, materialCostPerKg: Number(alloyRow['Unit Cost (USD/kg)']),
    materialDensityKgM3: alloy.densityKgM3!, materialSource: 'db', partVolumeMm3: part.volumeMm3, batchSize, warnings: [], ratesSource: 'test',
    finishing: { melting: melting.line, trim: trim.line, grinding: grinding.line, cleaning: cleaning.line, inspection: inspection.line, warnings: [] },
    dieTooling, calculators, alloy: { name: alloy.name, densityKgM3: alloy.densityKgM3, yieldLossFactor: alloy.yieldLossFactor }, meltedKg: melting.meltedKg,
    calculatorRuns: trim.forceRun ? { 'Trim Force': trim.forceRun } : {},
  });
  return { summary, line, melting, dieTooling, net };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const BATCHES = [1, 10, 100, 1000, 10_000];

describe('die-cast part through the Cost Summary (real calculators, memory data)', () => {
  const r = costPart(1000);
  const s = r.summary;
  const line = (name: string) => s.processLines.find((l) => l.process === name)!;

  describe('hand calculation, AA 380.0 housing: 14 000 mm2 projected, 3 / 8 mm walls, 120 cm3, 160 mm long', () => {
    it('required clamp = 14 000 mm2 x 48 MPa x 1.5 / 1000 = 1008 kN, and the shot is parts x (1 + 0.10) + runner', () => {
      expect(r.line.requiredClampKn).toBeCloseTo(1008, 9);
      // tblOverflowDim row 2.5 mm, quality 3 -> Low 0.10; runner (8 + 1.5)^2 x 2 = 180.5 mm2 x 2 ingates x 152.4 mm.
      expect(r.line.shotVolumeMm3!).toBeCloseTo(120_000 * 1.1 + 180.5 * 2 * 152.4, 6);
    });

    it('the casting cycle = dry + ladle 3 + lube + eject (x 2.45) + fill + 0.47 s/mm x 8 mm, per part with one cavity', () => {
      // lube 2.72 + 0.0000511 x 2 x 14 000 = 4.1508 s; fill 0.034 x (690 - 643 + 25 x 3.8) / (643 - 220) x 3 mm = 0.034241 s.
      const dry = r.line.machine!.dryCycleTimeS!;
      const shotS = dry + 3 + 4.1508 + 4.1508 * 2.45 + 0.034241 + 0.47 * 8;
      expect(line('High Pressure Die Casting').cycleTimeMin).toBeCloseTo(shotS / 60, 3); // minutes, rounded to 3 places
    });

    it('metal: part 0.348 kg charged at 5.515 USD/kg; the overflow and runner (0.5424 - 0.348 kg) are remelted, not charged', () => {
      expect(r.net).toBeCloseTo(0.348, 9);
      expect(s.materialCost).toBeCloseTo(0.348 * 5.515, 2);
      expect(s.dieCasting!.metal.partKg).toBeCloseTo(0.348, 3);
      expect(s.dieCasting!.metal.meltedKg!).toBeCloseTo(0.54235, 3);
      expect(s.dieCasting!.metal.returnedKg!).toBeCloseTo(0.19435, 3);
      // melting 0.54235 kg x Induction - DI conversion x regionConvFactor 1
      expect(line('Melting').totalCost).toBeCloseTo(0.54235 * diConversion, 2);
    });

    it('finishing: 520 mm x 0.41 x 1.63 mm flash at 683 mm3/s x 1.2 plus two 252.7 mm2 x 4.78 mm gate stubs at 1256 mm3/s x 1.2', () => {
      const flash = 520 * 0.41 * 1.63 / (683 * 1.2);
      const gates = 2 * 180.5 * 1.4 * 4.78 / (1256 * 1.2);
      expect(line('Finishing').machineName).toBe('Snag Wheel - 12kg Max Part Weight');
      expect(line('Finishing').cycleTimeMin).toBeCloseTo((flash + gates) / 60, 3);
    });

    it('trim: Lasco VPE 315 strokes 1.1 s for one part; force 520 x 0.41 x 190 / 1000 = 40.5 kN is within its 3150 kN', () => {
      expect(line('Trim').machineName).toBe('Lasco VPE 315');
      expect(line('Trim').cycleTimeMin).toBeCloseTo(1.1 / 60, 3);
      expect(s.calculatorRuns!['Trim Force']!.value).toBeCloseTo(40.508, 3);
    });

    it('die: 490 x 414 x 243.2 mm of H13 on the 1600 kN press, 2 ejector pins, 3 dies for 250 000 parts at 110 000 shots', () => {
      const d = s.dieTooling!;
      expect(d.pressForceKn).toBe(1600);
      expect(d.dieSizeMm).toEqual([490, 414, 243.2]);
      expect(d.steelKg!).toBeCloseTo(388.76, 2);
      expect(d.ejectorPins).toBe(2);
      expect(d.diesRequired).toBe(3);
      expect(d.perPartUsd!).toBeCloseTo(d.totalToolingUsd! / 250_000, 4);
    });
  });

  describe('invariants', () => {
    it('every line and the summary add up (cents rounding only)', () => {
      for (const l of s.processLines) expect(Math.abs(l.totalCost - (l.setupCost + l.runCost))).toBeLessThanOrEqual(0.0101);
      expect(Math.abs(s.totalProcessCost - sum(s.processLines.map((l) => l.totalCost)))).toBeLessThanOrEqual(0.0101);
      expect(Math.abs(s.totalCost - (s.materialCost + s.totalProcessCost))).toBeLessThanOrEqual(0.0101);
      expect(s.processLines.map((l) => l.process)).toEqual(['Melting', 'High Pressure Die Casting', 'Trim', 'Finishing', 'Cleaning', 'Visual Inspection']);
      expect(s.processLines.every((l) => !l.physicsGap)).toBe(true);
    });

    it('no NaN, Infinity or negative number anywhere in the priced lines', () => {
      const numbers: number[] = [s.materialCost, s.totalCost, s.totalProcessCost, s.grossWeightKg];
      for (const l of s.processLines) numbers.push(l.setupCost, l.runCost, l.totalCost, l.cycleTimeMin, l.hourlyRate);
      for (const x of numbers) {
        expect(Number.isFinite(x)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(0);
      }
    });

    it('the chosen machine has the clamp for the projected area and tie bars clear of the footprint', () => {
      const m = r.line.machine!;
      expect(m.clampingForceKn!).toBeGreaterThanOrEqual((part.projectedAreaMm2 * Number(alloyRow['Clamping Pressure (MPa)']) * ref.clampForceSafetyFactor) / 1000);
      const [a, b] = part.footprintMm;
      expect((a < m.tieBarHorMm! && b < m.tieBarVertMm!) || (b < m.tieBarHorMm! && a < m.tieBarVertMm!)).toBe(true);
    });

    it('cost per part never rises with the batch (setup is spread over more parts)', () => {
      const totals = BATCHES.map((b) => costPart(b).summary.totalCost);
      for (let i = 1; i < totals.length; i++) expect(totals[i]!).toBeLessThanOrEqual(totals[i - 1]! + 0.011);
      expect(totals[0]!).toBeGreaterThan(totals[totals.length - 1]!);
    });

    it('is deterministic', () => {
      expect(JSON.stringify(costPart(1000).summary)).toBe(JSON.stringify(costPart(1000).summary));
    });

    it('two cavities double the clamp the machine must hold', () => {
      const two = computeHpdc({
        reference: ref, referenceMissing: [], calculators, material: alloy, materialGrade: alloy.name, geometry,
        machines: hpdcMachines, batchSize: 1000, costContext: ctx, cavityCountOverride: 2,
      });
      expect(two.processLines[0]!.physicsGap).toBeUndefined();
      expect(two.requiredClampKn!).toBeCloseTo(2016, 9);
      expect(two.machine!.clampingForceKn!).toBeGreaterThanOrEqual(2016);
    });
  });

  describe('gravity die casting', () => {
    const g = costPart(1000, 'gdc');
    it('is priced on a gravity machine with no clamp, and gating metal is remelted', () => {
      expect(g.line.requiredClampKn).toBeNull();
      expect(g.summary.processLines.every((l) => !l.physicsGap)).toBe(true);
      expect(g.summary.dieCasting!.metal.meltedKg!).toBeCloseTo(0.348 / (0.7 + 0.01), 3);
      expect(Math.abs(g.summary.totalCost - (g.summary.materialCost + g.summary.totalProcessCost))).toBeLessThanOrEqual(0.0101);
    });
  });
});

describe('setup-time contract (shared rule, see shared/setup-contract.ts)', () => {
  const run = (process: 'hpdc' | 'gdc', setupOnFile: boolean) => {
    const noSetup = (ms: HpdcMachine[]) => ms.map((m) => ({ ...m, setupTimeHr: null }));
    return process === 'hpdc'
      ? computeHpdc({ reference: ref, referenceMissing: [], calculators, material: alloy, materialGrade: alloy.name, geometry, machines: setupOnFile ? hpdcMachines : noSetup(hpdcMachines), batchSize: 1000, costContext: ctx })
      : computeGdc({ reference: ref, referenceMissing: [], calculators, material: alloy, materialGrade: alloy.name, geometry, machines: setupOnFile ? gdcMachines : noSetup(gdcMachines), batchSize: 1000, coreCount: 0, costContext: ctx });
  };

  it.each(['hpdc', 'gdc'] as const)('%s: a machine with a setup time carries it; one without leaves the route a data gap', (process) => {
    const label = run(process, true).processLines[0]!.process;
    expectSetupContract(run(process, true).processLines, true, label);
    expectSetupContract(run(process, false).processLines, false, label);
  });
});
