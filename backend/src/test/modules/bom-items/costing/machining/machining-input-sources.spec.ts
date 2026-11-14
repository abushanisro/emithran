import type { CalculationTraceStep, SourceRef } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';
import {
  computeDrillCycle,
  computeMillingCostSummary,
  computeTurningCostSummary,
  type MachineClassId,
  type MachiningCostInput,
} from '../../../../../modules/bom-items/costing/machining/process/cost-machining-engine';
import { specAsCalculators } from '../../../../../modules/bom-items/costing/machining/calculators/machining-calculator-spec';
import {
  grindingLookupSeeds,
  keywayBroachingLookupSeeds,
  surfaceGrindingLookupSeeds,
} from '../../../../../modules/bom-items/costing/machining/calculators/machining-lookup-seeds';
import { flattenMachiningLookupTable } from '../../../../../modules/bom-items/costing/machining/lookup/machining-lookup-tables';
import type { MHRRateInput } from '../../../../../modules/bom-items/costing/shared/core/cost-engine';
import {
  realCapabilityRules,
  realDrillingTable,
  realGrindingParams,
  realKeywayBroachReference,
  realSurfaceGrindingParams,
  realTappingTable,
} from './real-reference-tables';

// Every machining calculator input read from a table, a variable, a machine record or a calculation says which (SourceRef), so the
// calculator dialog's eye opens it with the row outlined: a lookup through the `machining` reference domain (GET /processes/reference-lookup,
// the table flattened as flattenMachiningLookupTable serves it), a variable by name, the machine's HR Rates record and column.
const CALCS = specAsCalculators();
const RULES = realCapabilityRules();
const DRILLING = realDrillingTable();

function rate(value: number, overrides: Partial<MHRRateInput> = {}): MHRRateInput {
  return { rate: value, source: 'mhr_database', machineClass: '3_axis_mill', machineName: 'Test VMC', commodityCode: 'CNC-VMC-3AX', ...overrides };
}

// A steel bracket: one hole size, one thread size, sharp edges to deburr.
const milled: MachiningCostInput = {
  volume: 100_000, surfaceArea: 40_000, maxLength: 83, maxWidth: 62, maxHeight: 32,
  holeCount: 4, holeGroups: [{ diameter_mm: 8, count: 4, depth_mm: 20 }], pocketCount: 0,
  materialGrade: 'AISI 1045', materialCostPerKg: 90, materialDensityKgM3: 7850, materialSource: 'db',
  threads: [{ size: 'M8', count: 2, depthMm: 12 }], tightestToleranceMm: 0.1, gdtFeatureCount: 0,
  batchSize: 50, family: 'milled', finishedWeightKg: 0.7,
  mhrRate: rate(900), tappingRate: rate(900, { machineClass: 'tapping' }), deburrRate: rate(300, { machineClass: 'deburring', machineName: null }),
  inspectionRate: rate(450, { machineClass: 'cmm', machineName: null, commodityCode: null }),
  surfaceTreatment: null, machiningCalculators: CALCS, capabilityRules: RULES, location: 'India',
  drillingTable: DRILLING, tappingTable: realTappingTable(),
  sharpEdgeLengthMm: 600, deburrLinearSpeedMmPerSec: 18.8,
  deburrMatch: { table: 'tblDeburring', row: { material_cut_code_name: '1.0', deburr_type: 'Unused', tool_series: 'Virtual Debuiring Brush' } },
};
const milling = computeMillingCostSummary(milled, '3_axis_mill' as MachineClassId);

const traceOf = (process: string): CalculationTraceStep[] => {
  const line = milling.processLines.find((l) => l.process === process);
  if (!line) throw new Error(`no ${process} line (lines: ${milling.processLines.map((l) => l.process).join(', ')})`);
  return line.calculationTrace ?? [];
};
const inputStep = (trace: CalculationTraceStep[], field: string) => trace.find((s) => s.kind === 'input' && s.fieldName === field);

/** The rows of a flattened machining table a lookup ref's row identifies. */
const rowsOf = (table: { rows: Array<Record<string, unknown>> }, ref: Extract<SourceRef, { kind: 'lookup' }>) =>
  table.rows.filter((r) => Object.entries(ref.row ?? {}).every(([k, v]) => String(r[k]) === String(v)));

describe('machining calculator inputs carry where they were read (SourceRef)', () => {
  // A hole-size group's drilling run (the mill sums it into its own line; a turned part has a Drilling line of it).
  const drill = computeDrillCycle(8, milled.materialGrade, 20, DRILLING, CALCS, 4);

  it('Drilling: the cutting speed names its tblDrilling rows and column; the interpolated feed is the calculation over its two breakpoint rows', () => {
    const trace = drill.trace;
    const speed = inputStep(trace, 'Cutting Speed')!.ref as Extract<SourceRef, { kind: 'lookup' }>;
    expect(speed).toMatchObject({ kind: 'lookup', domain: 'machining', table: 'tblDrilling', column: 'cutting_speed_m_min' });
    const flat = flattenMachiningLookupTable('tblDrilling', DRILLING);
    expect(flat.columns).toContain(speed.column);
    // Every row of the code's construction band carries the one speed the input has.
    const speedRows = rowsOf(flat, speed);
    expect(speedRows.length).toBeGreaterThan(0);
    expect(speedRows.every((r) => r.cutting_speed_m_min === inputStep(trace, 'Cutting Speed')!.value)).toBe(true);

    const feed = inputStep(trace, 'Feed')!;
    expect(feed.ref).toMatchObject({ kind: 'calculation', name: 'tblDrilling feed, interpolated by diameter' });
    const steps = (feed.ref as Extract<SourceRef, { kind: 'calculation' }>).steps;
    const points = steps.filter((s) => s.ref?.kind === 'lookup').map((s) => s.ref as Extract<SourceRef, { kind: 'lookup' }>);
    expect(points).toHaveLength(2);
    for (const p of points) {
      expect(p.column).toBe('feed_mm_rev');
      // Each breakpoint is exactly one row of the table, holding the step's value.
      expect(rowsOf(flat, p)).toHaveLength(1);
    }
    expect(steps.at(-1)).toMatchObject({ kind: 'calculated', fieldName: 'Feed', value: feed.value });
    // The legacy lookup match (the dialog's Case M) is still recorded.
    expect(drill.lookups['Cutting Speed']?.table).toBe('tblDrilling');
  });

  it('Tapping: the cutting speed is one tblTapping row (material code and pitch)', () => {
    const speed = inputStep(traceOf('Tapping'), 'Cutting Speed')!;
    expect(speed.ref).toEqual({
      kind: 'lookup', domain: 'machining', table: 'tblTapping', column: 'CuttingSpeedMPerMin',
      row: { MaterialCutCodeName: expect.any(Number), MetricPitchMm: expect.any(Number) },
    });
  });

  it('Deburring: the edge speed is the tblDeburring row the speed came from', () => {
    expect(inputStep(traceOf('Deburring'), 'Edge Speed')!.ref).toEqual({
      kind: 'lookup', domain: 'machining', table: 'tblDeburring', column: 'linear_speed_mm_s',
      row: { material_cut_code_name: '1.0', deburr_type: 'Unused', tool_series: 'Virtual Debuiring Brush' },
    });
  });

  it('gives no ref to a CAD measurement with no face set behind it, nor to the batch size: there is nothing to open', () => {
    for (const field of ['Hole Diameter', 'Hole Depth', 'Holes']) expect(inputStep(drill.trace, field)!.ref).toBeUndefined();
    expect(inputStep(traceOf('Inspection'), 'Batch Size')!.ref).toBeUndefined();
  });

  it('Index Transfer: the multi-spindle times open the selected machine\'s HR Rates record at the column read', () => {
    const turned = computeTurningCostSummary({
      ...milled, family: 'turned', maxLength: 100, maxWidth: 20, maxHeight: 20, volume: 20000, holeGroups: [], holeCount: 0, threads: [],
      blankResult: { form: 'round_bar', sizeLabel: 'Ø30 round bar', barDiameterMm: 30, billetVolMm3: Math.PI * 15 ** 2 * 100, utilizationPct: 50 },
      mhrRate: rate(1000, {
        machineClass: 'simultaneous_turning', machineName: 'Index MS32-6', mhrRecordId: 'mhr-ms32',
        numberSpindles: 6, drumIndexTimeS: 0.7, transferTimeS: 1.0, stockFeedTimeS: 2.5, speedSynchronizationTimeS: 1.5,
      }),
    }, 'simultaneous_turning' as MachineClassId);
    const trace = turned.processLines.find((l) => l.process === 'Index Transfer')!.calculationTrace!;
    expect(inputStep(trace, 'Drum Index Time')!.ref).toEqual({
      kind: 'machine', machineId: 'mhr-ms32', machineName: 'Index MS32-6', machineClass: 'simultaneous_turning', location: 'India', column: 'drum_index_time_s',
    });
    expect((inputStep(trace, 'Speed Synchronization Time')!.ref as { column: string }).column).toBe('speed_synchronization_time_s');
  });
});

describe('machining lookup seeds: variables, multi-value rows and computed values', () => {
  it('a grinding allowance is the machining variable by name; the grinding values name their table row and column', () => {
    const { seeds } = grindingLookupSeeds({
      matClass: 'mild_steel', capabilityRules: RULES, internalGrindingParams: realGrindingParams('tblInternalGrinding', '1.1'),
    }, 'jig_grind', 'tblInternalGrinding');
    expect(seeds['Grinding Allowance']!.ref).toEqual({ kind: 'variable', domain: 'machining', name: 'finishGrindingDepth' });
    expect(seeds['Repetitions']!.ref).toEqual({
      kind: 'lookup', domain: 'machining', table: 'tblGtolProcessCapabilities', column: 'Num Repetitions', row: { Process: 'Jig Grind', GtolCategory: 'positionTolerance' },
    });
    expect(seeds['Work Speed']!.ref).toEqual({
      kind: 'lookup', domain: 'machining', table: 'tblInternalGrinding', column: 'Work Speed (m / min)', row: { 'Material Cut Code Name': 1.1 },
    });
  });

  it('a surface-grinding crossfeed is the calculation over its row\'s crossfeed limits and the wheel width', () => {
    const { seeds } = surfaceGrindingLookupSeeds({ matClass: 'mild_steel', capabilityRules: RULES, surfaceGrindingParams: realSurfaceGrindingParams('1.1') });
    expect(seeds['Table Speed']!.ref).toMatchObject({ kind: 'lookup', table: 'tblReciprocatingSurfaceGrinding', column: 'TableSpeedMPerMin' });
    const crossfeed = seeds['Crossfeed']!;
    expect(crossfeed.ref).toMatchObject({ kind: 'calculation', name: 'Surface grinding crossfeed' });
    const steps = (crossfeed.ref as Extract<SourceRef, { kind: 'calculation' }>).steps;
    expect(steps.map((s) => (s.ref as { column?: string } | undefined)?.column)).toEqual(['AbsoluteCrossfeedMm', 'MaxFractionalCrossfeed', 'wheel_width_mm', undefined]);
    expect(steps.at(-1)).toMatchObject({ kind: 'calculated', value: crossfeed.value });
  });

  it('a keyway broach: its teeth, pitch and speed name the broach row; the positioning time is its variable', () => {
    const { seeds } = keywayBroachingLookupSeeds({ matClass: 'mild_steel', keywayBroach: realKeywayBroachReference() }, { 'Keyway Width': 4, 'Keyway Length': 20 });
    const teeth = seeds['Broach Teeth']!.ref as Extract<SourceRef, { kind: 'lookup' }>;
    expect(teeth).toMatchObject({ kind: 'lookup', domain: 'machining', column: 'Teeth', row: { Id: expect.any(Number), 'Material Cut Code Name': expect.anything() } });
    expect(seeds['Cutting Speed']!.ref).toMatchObject({ table: teeth.table, column: 'Cutting Speed (m / min)', row: teeth.row });
    expect(seeds['Positioning Time']!.ref).toMatchObject({ kind: 'variable', domain: 'machining' });
    // Passes: the table's Passes column for a pull broach, or Shims + 1 for a shim broach.
    const passes = seeds['Passes']!.ref!;
    if (teeth.table === 'tblPullTypeKeywayBroach') expect(passes).toMatchObject({ kind: 'lookup', column: 'Passes' });
    else expect(passes).toMatchObject({ kind: 'calculation', name: 'Shim keyway broach passes' });
  });
});
