import type { CalculationTraceStep, ProcessLineCost, SourceRef } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';
import { plasticMoldingCalculatorsByName } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculator-spec';
import { computeCompressionMoldingCost } from '../../../../../modules/bom-items/costing/plastic-molding/process/cost-compression-molding-engine';
import { computeInjectionMoldedCostSummary, type InjectionMoldingCostInput } from '../../../../../modules/bom-items/costing/plastic-molding/process/cost-injection-molding-engine';
import { computeReactionInjectionMoldingCost } from '../../../../../modules/bom-items/costing/plastic-molding/process/cost-reaction-injection-molding-engine';
import { resolvePlasticReference } from '../../../../../modules/bom-items/costing/plastic-molding/plastic-reference';
import { realMaterialClamp, realPlasticReference, realPress, realReferenceRows, realResinInputs } from './real-plastic-reference';

// Every plastic calculator input says where its value was read (SourceRef), so the calculator dialog's eye opens that record or table with the
// value's row outlined: the staged variables and lookup rows of memory/Plastic Modeling, the press's HR Rates record, the resin's Raw Materials
// record, the CAD faces, the calculation it came from. A value read from no place the dialog can open carries none.

const CALCULATORS = plasticMoldingCalculatorsByName();
const PRESS_NAME = 'Arburg Allrounder 420 C 1300 - 350';
const PRESS = realPress(PRESS_NAME);
const PRESS_RECORD = { id: 'mhr-press-1', name: PRESS_NAME, machineClass: 'injection_molding', location: 'USA' };
const ABS = { id: 'rm-abs', name: 'ABS' };
const rate = (machineClass: string, usd: number, name: string | null) => ({ rate: usd, labourRate: 34.48, operators: 1, source: 'mhr_database' as const, machineClass, machineName: name, commodityCode: null });
const part = (over: Partial<InjectionMoldingCostInput> = {}): InjectionMoldingCostInput => ({
  volume: 50_000, surfaceArea: 40_000, wallThicknessNominalMm: 2, materialGrade: 'ABS', materialCostPerKg: 3.046, materialDensityKgM3: 1040, materialSource: 'db',
  batchSize: 250, family: 'plastic_molded', mhrRate: { ...rate('injection_molding', PRESS.mhrUsd, PRESS_NAME), setupTimeHr: 2 },
  deburrRate: rate('deburring', 12, 'Bench'), inspectionRate: rate('cmm', 0, null), machineClampTonnes: PRESS.maxTonnage, machineShotCapacityG: PRESS.shotCapacityGrams,
  pressTiming: { ...PRESS.timing, record: PRESS_RECORD }, goodPartYield: PRESS.goodPartYield, calculators: CALCULATORS,
  materialClamp: realMaterialClamp('ABS'), realResinInputs: realResinInputs('ABS'), materialRecord: ABS, materialType: 'ABS',
  electricity: { usdPerKwh: 0.12, source: 'location_electricity_prices: USA' },
  plasticReference: realPlasticReference(), location: 'USA', annualVolume: 100_000, productionLifeYears: 3, cadFaceCount: 120,
  bboxMaxMm: 120, bboxMidMm: 80, bboxMinMm: 30,
  signals: { projectedAreaMm2: 9_600, undercutCount: 0, partingComplexity: 0.6, partingLineLengthMm: 400 },
  ...over,
});

const input = (trace: readonly CalculationTraceStep[] | undefined, field: string) => {
  const step = trace?.find((t) => t.kind === 'input' && t.fieldName === field);
  if (!step) throw new Error(`no input "${field}" in ${trace?.map((t) => t.fieldName).join(', ')}`);
  return step;
};
const refOf = (trace: readonly CalculationTraceStep[] | undefined, field: string): SourceRef | undefined => input(trace, field).ref;
const lineNamed = (lines: readonly ProcessLineCost[], calculator: string) => {
  const line = lines.find((l) => l.calculatorName === calculator);
  if (!line) throw new Error(`no line of ${calculator}: ${lines.map((l) => l.calculatorName ?? l.process).join(', ')}`);
  return line;
};

/** The staged variables and lookup tables, by the keys the viewer endpoints serve them under (machining_reference_data, 2026-Plastic / 2026-Secondary). */
const ROWS = realReferenceRows();
const VARIABLES = new Set(ROWS.variables.map((v) => v.key));
/** A lookup ref names a staged table, a column it has, and a row that is in it (every column/value of `row` matches exactly one row). */
function expectServedLookup(ref: SourceRef | undefined, field = '') {
  expect({ field, kind: ref?.kind }).toEqual({ field, kind: 'lookup' });
  if (ref?.kind !== 'lookup') return;
  expect(ref.domain).toBe('injection_molding');
  const table = ROWS.lookups[ref.table];
  expect(table?.length).toBeGreaterThan(0);
  expect(Object.keys(table![0]!)).toContain(ref.column);
  if (ref.row) {
    // Compared as the dialog compares (lib/calculators/lookup-row-match.ts): numbers as numbers (the memory/ CSV writes 99999999.0, the staged row 99999999).
    const same = (a: unknown, b: unknown) => (typeof b === 'number' ? Math.abs(Number(a) - b) < 1e-6 : String(a) === String(b));
    const hits = table!.filter((r) => Object.entries(ref.row!).every(([k, v]) => same(r[k], v)));
    expect({ field, rows: hits.length }).toEqual({ field, rows: 1 });
  }
}
function expectServedVariable(ref: SourceRef | undefined, domain = 'injection_molding') {
  expect(ref).toMatchObject({ kind: 'variable', domain });
  if (ref?.kind === 'variable') expect(VARIABLES.has(ref.name)).toBe(true);
}

describe('the injection molding cycle inputs carry where they were read', () => {
  const result = computeInjectionMoldedCostSummary(part());
  const trace = lineNamed(result.processLines, 'Injection Molding - Cycle Time').calculationTrace;

  it('the CAD wall carries its faces', () => {
    expect(refOf(trace, 'Nominal Wall Thickness')).toEqual({ kind: 'cad', evidence: 'wall_thickness' });
    expect(input(trace, 'Nominal Wall Thickness').evidence).toBe('wall_thickness');
  });

  it('the press injection rate opens the press record at its specs key', () => {
    expect(refOf(trace, 'Press Injection Rate')).toEqual({
      kind: 'machine', machineId: 'mhr-press-1', machineName: PRESS_NAME, machineClass: 'injection_molding', location: 'USA', column: 'injection_rate_mm3_per_s',
    });
  });

  it('each resin property opens the material record at the raw_materials column it is read from', () => {
    const columns: Record<string, string> = {
      'Melt Temperature': 'melting_temp_c', 'Mold Temperature': 'mold_temp_c', 'Ejection Temperature': 'eject_deflection_temp_c',
      'Specific Heat of Melt': 'specific_heat_melt', 'Thermal Conductivity of Melt': 'thermal_conductivity_melt', 'Melt Density': 'im_density_of_melt_kg_m3',
    };
    for (const [field, column] of Object.entries(columns)) {
      expect(refOf(trace, field)).toEqual({ kind: 'material', materialId: ABS.id, materialName: ABS.name, column });
    }
  });

  it('the variables and the fill factor rows are the staged ones', () => {
    expectServedVariable(refOf(trace, 'Cycle Time Adjustment Factor'));
    expectServedVariable(refOf(trace, 'Mold Temperature Increase'));
    const cavities = refOf(trace, 'Fill Factor for Cavities');
    expect(cavities).toMatchObject({ table: 'injectionTimeAdjustmentFactors', column: 'adjustment_factor', row: { attribute: 'Cavities Per Mold' } });
    expectServedLookup(cavities);
    expectServedLookup(refOf(trace, 'Fill Factor for Gates'));
  });

  it('a value with no place the dialog can open carries none: the dry cycle (a column the HR Rates viewer does not list), the computed shot volume', () => {
    expect(refOf(trace, 'Press Dry Cycle Time')).toBeUndefined();
    expect(refOf(trace, 'Shot Melt Volume')).toBeUndefined();
  });

  it('without the records (an older caller) the cycle is the same and the machine and material inputs carry no ref', () => {
    const bare = computeInjectionMoldedCostSummary(part({ pressTiming: PRESS.timing, materialRecord: null }));
    const t = lineNamed(bare.processLines, 'Injection Molding - Cycle Time').calculationTrace;
    expect(refOf(t, 'Press Injection Rate')).toBeUndefined();
    expect(refOf(t, 'Melt Temperature')).toBeUndefined();
    expect(bare.totalCost).toBe(result.totalCost);
  });

  it('a value the part overrides was not read from the source: no ref', () => {
    const r = computeInjectionMoldedCostSummary(part({ calculatorOverrides: { 'Injection Molding - Cycle Time': { 'Cycle Time Adjustment Factor': { value: 1.1, reason: 'plant trial' } } } }));
    expect(refOf(lineNamed(r.processLines, 'Injection Molding - Cycle Time').calculationTrace, 'Cycle Time Adjustment Factor')).toBeUndefined();
  });
});

describe('the secondary operations', () => {
  const result = computeInjectionMoldedCostSummary(part());

  it('material drying: its press time opens the molding cycle calculation, step by step', () => {
    const cycle = lineNamed(result.processLines, 'Injection Molding - Cycle Time');
    const ref = refOf(lineNamed(result.processLines, 'Injection Molding - Material Drying').calculationTrace, 'Press Time Per Part');
    expect(ref).toEqual({ kind: 'calculation', name: 'Injection Molding - Cycle Time', evidence: null, steps: cycle.calculationTrace });
  });

  it('material drying: the bundled reference package values carry none (no viewer serves them)', () => {
    const trace = lineNamed(result.processLines, 'Injection Molding - Material Drying').calculationTrace;
    for (const field of ['Drying Temperature', 'Dryer Throughput', 'Electricity Price', 'Equipment Life']) expect(refOf(trace, field)).toBeUndefined();
  });

  it('deflashing: the trimming rate is the staged variable; the CAD parting line has no face evidence yet', () => {
    const trace = lineNamed(result.processLines, 'Injection Molding - Deflashing').calculationTrace;
    expectServedVariable(refOf(trace, 'Manual Flash Trimming Rate'));
    expect(refOf(trace, 'Parting Line Length')).toBeUndefined();
  });

  it('visual inspection: the surface is the CAD surface, the rate and share are memory/Secondary process variables', () => {
    const trace = lineNamed(result.processLines, 'Injection Molding - Visual Inspection').calculationTrace;
    expect(refOf(trace, 'Part Surface Area')).toEqual({ kind: 'cad', evidence: 'part_surface' });
    expectServedVariable(refOf(trace, 'Visual Inspection Rate'), 'secondary_process');
    expectServedVariable(refOf(trace, 'Percent Inspected'), 'secondary_process');
  });
});

describe('the mold tooling inputs', () => {
  const tooling = computeInjectionMoldedCostSummary(part()).tooling!;
  const trace = tooling.calculationTrace;

  it('variables, toolroom settings, tool steel and lookup rows open the staged row they were read from', () => {
    for (const field of ['A Plate Min Thickness', 'Sprue Bushing Cost', 'Tryout Base Hours', 'Water Line Diameter', 'Hot Drop Unit Cost']) expectServedVariable(refOf(trace, field));
    for (const field of [
      'Design Hours', 'Plate Machining Rate', 'Design Rate', 'Machining Rate', 'Tryout Rate', 'Tool Life Shots', 'Mold Base Width', 'Mold Base Length',
      'Cavity Plate Depth Border', 'Core Plate Depth Border', 'Tool Steel Density', 'Tool Steel Price', 'Mold Base Cost Factor', 'Cavity Machining Hours Per Sq In',
      'Polish Hours Per Sq Meter', 'Ejector Pin Cost', 'Ejector Pin Assembly Hours', 'Line Drilling Rate', 'Rib Insert Assembly Hours', 'EDM Burn Rate', 'Insert Pocket Rate',
    ]) {
      expectServedLookup(refOf(trace, field), field);
    }
    expect(refOf(trace, 'Tool Life Shots')).toMatchObject({ table: 'tblToolLife', column: 'Num Shots Per Tool', row: { 'Material Type': 'ABS' } });
    expect(refOf(trace, 'Part Surface Area')).toEqual({ kind: 'cad', evidence: 'part_surface' });
  });

  it('in inches, the mold base row is named with its size too (a base name repeats in the table)', () => {
    const rows = realReferenceRows();
    const imperial = resolvePlasticReference({ ...rows, variables: rows.variables.map((v) => (v.key === 'useMetricOrImperialValues' ? { ...v, value: 'Imperial' } : v)) }).reference!;
    const t = computeInjectionMoldedCostSummary(part({ plasticReference: imperial })).tooling!.calculationTrace;
    const ref = refOf(t, 'Mold Base Width');
    expect(ref).toMatchObject({ table: 'tblStandardMoldBaseSizes', column: 'Actual Width', row: { 'Reference Uom': 'inches' } });
    if (ref?.kind !== 'lookup') throw new Error('not a lookup');
    const hits = rows.lookups['tblStandardMoldBaseSizes']!.filter((r) => Object.entries(ref.row!).every(([k, v]) => (typeof v === 'number' ? Math.abs(Number(r[k]) - v) < 1e-6 : r[k] === v)));
    expect(hits.length).toBeGreaterThan(0);
    expect(new Set(hits.map((r) => `${r['Actual Width']}x${r['Actual Length']}`)).size).toBe(1);
  });

  it('a material type with no tblToolLife row reads the defaultToolLife variable', () => {
    const t = computeInjectionMoldedCostSummary(part({ materialType: 'No Such Type' })).tooling!.calculationTrace;
    expect(refOf(t, 'Tool Life Shots')).toEqual({ kind: 'variable', domain: 'injection_molding', name: 'defaultToolLife' });
  });

  it('sums over several rows, bounding-box sizes and the scenario carry none', () => {
    for (const field of ['Purchased Components Cost', 'Assembly Hours', 'Plate Setup Hours', 'Part Height', 'Mold Base Area', 'Annual Volume', 'Cavities per Mold']) {
      expect(refOf(trace, field)).toBeUndefined();
    }
  });
});

describe('compression and reaction injection molding', () => {
  it('compression: the cure time opens the material record; the press open/close time has no viewer column', () => {
    const r = computeCompressionMoldingCost({
      batchSize: 250, partWeightKg: 0.2, rate: { ...rate('compression_molding', 40, 'Compression press'), pressCycleTimeS: 26.2, setupTimeHr: 1 },
      cureTimeMinFromMaterial: 3, materialRecord: { id: 'rm-smc', name: 'SMC' }, calculators: CALCULATORS,
    });
    const trace = r.processLines[0]!.calculationTrace;
    expect(refOf(trace, 'Material Cure Time')).toEqual({ kind: 'material', materialId: 'rm-smc', materialName: 'SMC', column: 'cure_time_min' });
    expect(refOf(trace, 'Press Open/Close Time')).toBeUndefined();
  });

  it('compression: a grade with no cure time is seeded 0 from nowhere, so no ref', () => {
    const r = computeCompressionMoldingCost({
      batchSize: 250, rate: { ...rate('compression_molding', 40, 'Compression press'), pressCycleTimeS: 26.2 }, cureTimeMinFromMaterial: null,
      materialRecord: { id: 'rm-smc', name: 'SMC' }, calculators: CALCULATORS,
    });
    expect(refOf(r.processLines[0]!.calculationTrace, 'Material Cure Time')).toBeUndefined();
  });

  it('reaction injection: the injection rate opens the machine record, the part volume its CAD faces, the cure time the material', () => {
    const machine = { id: 'mhr-rim-1', name: 'RIM press', machineClass: 'reaction_injection_molding', location: 'India' };
    const r = computeReactionInjectionMoldingCost({
      batchSize: 100, rate: { ...rate('reaction_injection_molding', 60, 'RIM press'), pressCycleTimeS: 10 }, cureTimeMinFromMaterial: 2,
      partVolumeMm3: 500_000, injectionRateMm3PerS: 100_000, machineRecord: machine, materialRecord: { id: 'rm-pu', name: 'PU' }, calculators: CALCULATORS,
    });
    const trace = r.processLines[0]!.calculationTrace;
    expect(refOf(trace, 'Machine Injection Rate')).toEqual({ kind: 'machine', machineId: 'mhr-rim-1', machineName: 'RIM press', machineClass: 'reaction_injection_molding', location: 'India', column: 'injection_rate_mm3_per_s' });
    expect(refOf(trace, 'Part Volume')).toEqual({ kind: 'cad', evidence: 'part_volume' });
    expect(refOf(trace, 'Material Cure Time')).toMatchObject({ kind: 'material', materialId: 'rm-pu', column: 'cure_time_min' });
    expect(refOf(trace, 'Machine Dry Cycle Time')).toBeUndefined();
  });
});
