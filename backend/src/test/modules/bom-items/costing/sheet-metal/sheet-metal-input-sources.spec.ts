import type { PlasticCatalogOperationsService } from '../../../../../modules/bom-items/costing/plastic-molding/operation/plastic-catalog-operations.service';
import type { CalculationTraceStep, ManufacturingPhysicsResult, SourceRef } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';
import type { CalculatorCatalogService } from '../../../../../modules/bom-items/services/calculator-catalog.service';
import type { MHRRateInput } from '../../../../../modules/bom-items/costing/shared/core/cost-engine';
import { BOMItemsService } from '../../../../../modules/bom-items/bom-items.service';
import { SheetMetalLookupService } from '../../../../../modules/bom-items/costing/sheet-metal/lookup/sheet-metal-lookup.service';
import {
  inspectionSeedRefs, laserCutSeedRefs, materialSeedRefs, pressBrakeSeedRefs, turretSeedRefs, waterjetSeedRefs,
} from '../../../../../modules/bom-items/costing/sheet-metal/lookup/sheet-metal-source-refs';
import { planInspection, type InspectionInput, type InspectionOperationDefaultRow } from '../../../../../modules/bom-items/costing/shared/process/inspection-engine';

// Every sheet-metal calculator input the engine reads from a table, a variable or a record says which (SourceRef), so the calculator
// dialog's eye opens that table with that row outlined: the real SheetMetalLookupService resolves the rows (over a fake database holding
// reference rows), the real seed-ref builders name them, and BOMItemsService's own calculator resolution (resolvePhysicsQuantity, the one
// every sheet-metal line runs through) writes them onto the trace. CAD-measured inputs carry their faces; a value with no single source row
// (an interpolated stroke time, a rule of thumb, a batch size) carries none.

// ── A fake database: each query answers with the rows of its table that match its eq/like filters ──────────────────────────────────────
type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
  const query = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const cell = (r: Row, col: string) => (col.startsWith('raw->>') ? (r.raw as Row | undefined)?.[col.slice(6)] : r[col]);
    const q: any = {
      select: () => q,
      eq: (col: string, v: unknown) => { rows = rows.filter((r) => cell(r, col) === v); return q; },
      like: (col: string, pattern: string) => {
        const re = new RegExp(`^${pattern.split('%').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
        rows = rows.filter((r) => re.test(String(cell(r, col))));
        return q;
      },
      ilike: (col: string, pattern: string) => {
        const name = pattern.replace(/\\(.)/g, '$1').toLowerCase();
        rows = rows.filter((r) => String(cell(r, col) ?? '').toLowerCase() === name);
        return q;
      },
      in: (col: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[col])); return q; },
      not: () => q,
      gte: (col: string, v: number) => { rows = rows.filter((r) => Number(r[col]) >= v); return q; },
      order: (col: string, opts?: { ascending?: boolean }) => {
        rows.sort((a, b) => (Number(a[col]) - Number(b[col])) * (opts?.ascending === false ? -1 : 1));
        return q;
      },
      limit: (n: number) => { rows = rows.slice(0, n); return q; },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: rows, error: null }),
    };
    return q;
  };
  const client = { from: query };
  return { getPrivilegedClient: () => client, getClient: () => client } as any;
}

// Reference rows (values as seeded: sm_lookup_laser_cut fiber/Carbon Steel, Lookup Table 4 at 80 t, the machine library).
const DB = fakeDb({
  sm_lookup_laser_cut: [
    { material: 'Carbon Steel', laser_technology: 'fiber', thickness_mm: 2, laser_power_w: 3000, cutting_speed_m_per_min: 8.5, pierce_time_min: 0.005, kerf_mm: 0.2 },
    { material: 'Carbon Steel', laser_technology: 'fiber', thickness_mm: 2, laser_power_w: 6000, cutting_speed_m_per_min: 14, pierce_time_min: 0.003, kerf_mm: 0.2 },
    { material: 'Carbon Steel', laser_technology: 'fiber', thickness_mm: 3, laser_power_w: 3000, cutting_speed_m_per_min: 5.2, pierce_time_min: 0.008, kerf_mm: 0.25 },
  ],
  sm_lookup_manual_stroke: [
    { thickness_mm: 1, tonnage: 80, complexity: 'simple', stroke_time_sec: 1.18 },
    { thickness_mm: 2, tonnage: 80, complexity: 'simple', stroke_time_sec: 1.3 },
    { thickness_mm: 3, tonnage: 80, complexity: 'simple', stroke_time_sec: 1.46 },
  ],
  sm_lookup_handling_time: [{ weight_max_kg: 1, handling_min: 0.1 }, { weight_max_kg: 5, handling_min: 0.25 }],
  sm_lookup_tool_setup: [{ setup_type: 'brake', key_value: 250, loading_time_min: 10 }, { setup_type: 'brake', key_value: 500, loading_time_min: 15 }],
  lookup_table_policy: [],
  sm_reference_data: [
    { category: 'machine', key: 'turretPunchMachine:Amada EM-3510 ZRB', raw: { punch_rate_cycles_min: 500, nibble_rate_cycles_min: 410, nibble_tool_diameter_mm: 6.35, nibble_tool_overlap_mm: 0.5, tool_change_time_s: 1.5 } },
    { category: 'machine', key: 'Turret Press (Punch Press):Amada EM-3510 ZRB', raw: { press_force_kn: 300 } },
    { category: 'lookup_table', key: 'strokeRateFactor:20', raw: { tonnage_t: 20, simple: 0.7, intermediate: 0.6, complex: 0.5 } },
    { category: 'lookup_table', key: 'strokeRateFactor:30', raw: { tonnage_t: 30, simple: 0.72, intermediate: 0.62, complex: 0.52 } },
    { category: 'machine', key: 'Deslag Machine:Timesavers 42', raw: { name: 'Timesavers 42', machine_category: 'Deslag Machine', perimeter_allowance_s_per_mm: 0.004 } },
  ],
});
const lookup = new SheetMetalLookupService(DB);

// ── The calculators as seeded (calculator_fields): inputs, then the formulas the cost engine evaluates ──────────────────────────────────
const field = (calculator_id: string, field_name: string, display_order: number, default_value: string | null = null) =>
  ({ calculator_id, field_name, display_label: field_name, field_type: default_value ? 'calculated' : 'number', default_value, display_order, unit: null });
const CALCULATORS: Record<string, { machineClass: string; fields: ReturnType<typeof field>[] }> = {
  laser: {
    machineClass: 'fiber_laser',
    fields: [
      ...['Cutting Length', 'No Of Starts', 'Cutting Speed', 'Piercing Time Per Start'].map((f, i) => field('laser', f, i + 1)),
      field('laser', 'Cutting Time', 6, '{Cutting Length} / ({Cutting Speed} * 1000)'),
      field('laser', 'Piercing Time', 7, '{Piercing Time Per Start} * {No Of Starts}'),
      field('laser', 'Total Time', 8, '({Cutting Time} + {Piercing Time}) * 60'),
    ],
  },
  bending: {
    machineClass: 'press_brake',
    fields: [
      ...['Thickness', 'Bending Line Length', 'Shoulder Width', 'UTS', 'No Of Bends', 'Time Per Stroke', 'Sheet Loading Time', 'Tool Loading Time', 'Lot Size']
        .map((f, i) => field('bending', f, i + 1)),
      field('bending', 'Cycle Time', 20, '({Time Per Stroke} * {No Of Bends}) + ({Sheet Loading Time} * 60)'),
      field('bending', 'Setup Time', 21, '{Tool Loading Time} / {Lot Size}'),
    ],
  },
  tpp: {
    machineClass: 'turret_punch',
    fields: [
      ...['Punch Count', 'Punch Rate (hits/min)', 'Stroke Rate Factor', 'Tool Changes', 'Tool Change Time (s)', 'Nibble Length (mm)', 'Nibble Speed (mm/min)', 'Lot size']
        .map((f, i) => field('tpp', f, i + 1)),
      field('tpp', 'Cycle Time (sec)', 15,
        '({Punch Count} / ({Punch Rate (hits/min)} * {Stroke Rate Factor})) * 60 + ({Tool Changes} * {Tool Change Time (s)}) / {Lot size} + ({Nibble Length (mm)} / {Nibble Speed (mm/min)}) * 60'),
    ],
  },
  waterjet: {
    machineClass: 'waterjet',
    fields: [
      ...['Cutting Length', 'No Of Starts', 'Lead In Per Start', 'Cutting Speed', 'Cut Time Adjustment Factor', 'Pierce Delay Per Start', 'Lot Size']
        .map((f, i) => field('waterjet', f, i + 1)),
      field('waterjet', 'Cutting Time', 10, '(({Cutting Length} + {No Of Starts} * {Lead In Per Start}) / {Cutting Speed}) * {Cut Time Adjustment Factor}'),
      field('waterjet', 'Total Time', 11, '{Cutting Time} * 60 + {No Of Starts} * {Pierce Delay Per Start}'),
    ],
  },
  inspection: {
    machineClass: 'inspection',
    fields: [
      ...['Visual Pass Base', 'Holes to Inspect', 'Hole Check Time', 'Bends to Inspect', 'Bend Check Time', 'Threads to Inspect', 'Thread Gauge Time',
        'Has Thickness Check', 'Thickness Check Time', 'Has Dimension Check', 'Dimension Check Time'].map((f, i) => field('inspection', f, i + 1)),
      field('inspection', 'Total Time', 20,
        '{Visual Pass Base} + {Holes to Inspect} * {Hole Check Time} + {Bends to Inspect} * {Bend Check Time} + {Threads to Inspect} * {Thread Gauge Time} + {Has Thickness Check} * {Thickness Check Time} + {Has Dimension Check} * {Dimension Check Time}'),
    ],
  },
  deburr: {
    machineClass: 'deburring',
    fields: [field('deburr', 'Burr Edge Length', 1), field('deburr', 'Deburr Time Per mm', 2), field('deburr', 'Total Time', 3, '{Burr Edge Length} * {Deburr Time Per mm}')],
  },
};
const catalog = {
  mappings: Object.entries(CALCULATORS).map(([id, c]) => ({ machine_class: c.machineClass, operation: null, calculator_id: id })),
  mappingsError: null,
  calculators: Object.keys(CALCULATORS).map((id) => ({ id, name: id, version: 1, physics_key: null })),
  fields: Object.values(CALCULATORS).flatMap((c) => c.fields),
};

const service = new BOMItemsService(
  DB, {} as never, {} as never, lookup, {} as never, {} as never, {} as never, {} as never,
  { loadCalculatorCatalog: async () => catalog } as unknown as CalculatorCatalogService,
  {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
  {} as unknown as PlasticCatalogOperationsService, {} as never,
);
type Resolve = (token: string, params: Record<string, unknown>) => Promise<ManufacturingPhysicsResult>;
const resolve: Resolve = (service as unknown as { resolvePhysicsQuantity: Resolve }).resolvePhysicsQuantity.bind(service);
const refOf = (trace: CalculationTraceStep[], fieldName: string): SourceRef | undefined =>
  trace.find((s) => s.kind === 'input' && s.fieldName === fieldName)?.ref;

const CAD = {
  cut: 'CAD feature extraction — total cut path length',
  starts: 'CAD feature extraction — pierce/start count',
};

describe('sheet-metal calculator inputs carry where they were read (SourceRef)', () => {
  it('Laser Cutting: the CAD cut path and starts, and cutting speed / pierce time from the one sm_lookup_laser_cut row matched', async () => {
    const params = await lookup.getLaserParams('CRCA', 2.1, 5000, 'fiber');
    const run = await resolve('t', {
      machineClass: 'fiber_laser', process: 'Laser Cutting', targetFieldNames: ['Total Time'],
      seedScope: { 'Cutting Length': 1200, 'No Of Starts': 4, 'Cutting Speed': params.cuttingSpeedMPerMin, 'Piercing Time Per Start': params.pierceTimeMin },
      seedProvenance: { 'Cutting Length': CAD.cut, 'No Of Starts': CAD.starts, 'Cutting Speed': 'sm_lookup_laser_cut', 'Piercing Time Per Start': 'sm_lookup_laser_cut' },
      lookupTableByField: { 'Cutting Speed': 'sm_lookup_laser_cut', 'Piercing Time Per Start': 'sm_lookup_laser_cut' },
      seedRefs: laserCutSeedRefs(params),
    });
    expect(run.gap).toBeNull();
    // Nearest thickness (2 mm), then nearest power (6000 W for 5000 W): the row whose speed is in use.
    const row = { material: 'Carbon Steel', laser_technology: 'fiber', thickness_mm: 2, laser_power_w: 6000 };
    expect(params.cuttingSpeedMPerMin).toBe(14);
    expect(refOf(run.trace, 'Cutting Speed')).toEqual({ kind: 'smTable', table: 'sm_lookup_laser_cut', column: 'cutting_speed_m_per_min', row });
    expect(refOf(run.trace, 'Piercing Time Per Start')).toEqual({ kind: 'smTable', table: 'sm_lookup_laser_cut', column: 'pierce_time_min', row });
    expect(refOf(run.trace, 'Cutting Length')).toEqual({ kind: 'cad', evidence: 'cut_length' });
    expect(refOf(run.trace, 'No Of Starts')).toEqual({ kind: 'cad', evidence: 'pierce_count' });
  });

  it('Press Brake: stroke, handling and tool rows; UTS from the material record; CAD bends; none for a rule or the batch', async () => {
    const [stroke, handling, toolSetup] = await Promise.all([
      lookup.getManualStrokeTime(2, 80, 'simple'),
      lookup.getHandlingTime(0.6),
      lookup.getToolSetupTime('brake', 300),
    ]);
    const material = { id: 'rm-crca', name: 'CRCA', columns: { densityKgM3: 'density_kg_m3' as const, utsMpa: 'uts_mpa' as const, shearStrengthMpa: null } };
    const run = await resolve('t', {
      machineClass: 'press_brake', process: 'Press Brake', targetFieldNames: ['Cycle Time', 'Setup Time'],
      seedScope: {
        Thickness: 2, 'Bending Line Length': 180, 'Shoulder Width': 16, UTS: 410, 'No Of Bends': 3,
        'Time Per Stroke': stroke.secondsPerBend, 'Sheet Loading Time': handling.minutes, 'Tool Loading Time': toolSetup.minutes, 'Lot Size': 100,
      },
      seedProvenance: {
        Thickness: 'BOM sheet thickness', 'Bending Line Length': 'CAD feature extraction — longest of 3 bend lines',
        'Shoulder Width': 'Approximated as 8× sheet thickness', UTS: 'raw_materials', 'No Of Bends': 'CAD/drawing feature extraction — bend count',
        'Lot Size': 'Batch Size entered on this process cost form',
      },
      seedRefs: pressBrakeSeedRefs({ stroke: { ...stroke, fromMachineSpec: false }, handling, toolSetup, material, utsFromRecord: true }),
    });
    expect(run.gap).toBeNull();
    expect(refOf(run.trace, 'Time Per Stroke')).toEqual({
      kind: 'smTable', table: 'sm_lookup_manual_stroke', column: 'stroke_time_sec', row: { thickness_mm: 2, tonnage: 80, complexity: 'simple' },
    });
    expect(refOf(run.trace, 'Sheet Loading Time')).toEqual({ kind: 'smTable', table: 'sm_lookup_handling_time', column: 'handling_min', row: { weight_max_kg: 1 } });
    expect(refOf(run.trace, 'Tool Loading Time')).toEqual({ kind: 'smTable', table: 'sm_lookup_tool_setup', column: 'loading_time_min', row: { setup_type: 'brake', key_value: 250 } });
    expect(refOf(run.trace, 'UTS')).toEqual({ kind: 'material', materialId: 'rm-crca', materialName: 'CRCA', column: 'uts_mpa' });
    expect(refOf(run.trace, 'Bending Line Length')).toEqual({ kind: 'cad', evidence: 'bend_line_length' });
    expect(refOf(run.trace, 'No Of Bends')).toEqual({ kind: 'cad', evidence: 'bend_count' });
    for (const f of ['Thickness', 'Shoulder Width', 'Lot Size']) expect(refOf(run.trace, f)).toBeUndefined();
  });

  it('no row for a stroke time no single row holds (interpolated, or the machine\'s own spec), nor for a family-default UTS', async () => {
    const interpolated = await lookup.getManualStrokeTime(1.5, 80, 'simple');
    const exact = await lookup.getManualStrokeTime(2, 80, 'simple');
    const none = { dataFound: false };
    const material = { id: 'rm', name: 'X', columns: { densityKgM3: null, utsMpa: 'uts_mpa' as const, shearStrengthMpa: null } };
    expect(pressBrakeSeedRefs({ stroke: interpolated, handling: none, toolSetup: none, material, utsFromRecord: false })).toEqual({});
    expect(pressBrakeSeedRefs({ stroke: { ...exact, fromMachineSpec: true }, handling: none, toolSetup: none, material: null, utsFromRecord: true })).toEqual({});
  });

  it('Turret Punching: the machine\'s row of the Turret Press table, and Lookup Table 1\'s row and complexity column', async () => {
    const params = await lookup.getTurretPunchMachineParams('Amada EM-3510 ZRB', 'inter');
    // 300 kN = 30.6 t: the 30 t row, intermediate column.
    expect(params.strokeRateFactor).toBe(0.62);
    const run = await resolve('t', {
      machineClass: 'turret_punch', process: 'Turret Punching', targetFieldNames: ['Cycle Time (sec)'],
      seedScope: {
        'Punch Count': 20, 'Punch Rate (hits/min)': params.punchRateCyclesPerMin, 'Stroke Rate Factor': params.strokeRateFactor!, 'Tool Changes': 3,
        'Tool Change Time (s)': params.toolChangeSec, 'Nibble Length (mm)': 1000, 'Nibble Speed (mm/min)': params.nibbleMmPerMin, 'Lot size': 10,
      },
      seedProvenance: {
        'Punch Count': 'CAD feature extraction — punched hole count', 'Tool Changes': 'CAD feature extraction — distinct punched hole diameters', 'Nibble Length (mm)': CAD.cut,
      },
      seedRefs: turretSeedRefs('Amada EM-3510 ZRB', params),
    });
    expect(run.gap).toBeNull();
    const machine = { machine_name: 'Amada EM-3510 ZRB' };
    expect(refOf(run.trace, 'Punch Rate (hits/min)')).toEqual({ kind: 'smTable', table: 'turret_machines', column: 'punch_rate_cycles_min', row: machine });
    expect(refOf(run.trace, 'Tool Change Time (s)')).toEqual({ kind: 'smTable', table: 'turret_machines', column: 'tool_change_time_s', row: machine });
    expect(refOf(run.trace, 'Nibble Speed (mm/min)')).toEqual({ kind: 'smTable', table: 'turret_machines', column: 'nibble_speed_mm_per_min', row: machine });
    expect(refOf(run.trace, 'Stroke Rate Factor')).toEqual({ kind: 'smTable', table: 'stroke_rate_factor', column: 'intermediate', row: { tonnage_t: 30 } });
    expect(refOf(run.trace, 'Punch Count')).toEqual({ kind: 'cad', evidence: 'pierce_count' });
    expect(refOf(run.trace, 'Tool Changes')).toEqual({ kind: 'cad', evidence: 'hole_diameters' });
    expect(refOf(run.trace, 'Nibble Length (mm)')).toEqual({ kind: 'cad', evidence: 'cut_length' });
    expect(refOf(run.trace, 'Lot size')).toBeUndefined();
  });

  it('Waterjet Cutting: nozzle delay row, the two variables, and the cutting speed as the calculation that scales the table speed', async () => {
    const refs = waterjetSeedRefs({
      machineName: 'Flow Mach 500', referenceMachineName: 'Flow Mach 200', cutRow: { material: 'Carbon Steel', thickness_mm: 2 },
      tableSpeedMmPerMin: 600, machineTubeMm: 1.02, referenceTubeMm: 0.76, speedFactor: 1.02 / 0.76, material: 'CRCA', thicknessMm: 2,
    });
    const run = await resolve('t', {
      machineClass: 'waterjet', process: 'Waterjet Cutting', targetFieldNames: ['Total Time', 'Cutting Time'],
      seedScope: {
        'Cutting Length': 1200, 'No Of Starts': 4, 'Lead In Per Start': 5, 'Cutting Speed': 600 * (1.02 / 0.76),
        'Cut Time Adjustment Factor': 1.1, 'Pierce Delay Per Start': 2, 'Lot Size': 10,
      },
      seedProvenance: { 'Cutting Length': CAD.cut, 'No Of Starts': CAD.starts },
      seedRefs: refs,
    });
    expect(run.gap).toBeNull();
    expect(refOf(run.trace, 'Pierce Delay Per Start')).toEqual({ kind: 'smTable', table: 'waterjet_machines', column: 'nozzle_delay_s', row: { machine_name: 'Flow Mach 500' } });
    expect(refOf(run.trace, 'Lead In Per Start')).toEqual({ kind: 'variable', domain: 'sheet_metal', name: 'standardWaterjetCutLeadInAmount' });
    expect(refOf(run.trace, 'Cut Time Adjustment Factor')).toEqual({ kind: 'variable', domain: 'sheet_metal', name: 'waterjetCutTimeAdjustmentFactor' });
    const speed = refOf(run.trace, 'Cutting Speed') as Extract<SourceRef, { kind: 'calculation' }>;
    expect(speed.kind).toBe('calculation');
    expect(speed.steps.find((s) => s.fieldName === 'Table Cutting Speed')?.ref).toEqual({
      kind: 'smTable', table: 'sm_lookup_waterjet_cut', column: 'cutting_speed_mm_per_min', row: { material: 'Carbon Steel', thickness_mm: 2 },
    });
    expect(speed.steps.at(-1)!.value).toBeCloseTo(600 * (1.02 / 0.76), 9);
  });

  it('Inspection: each check time from its inspection_operation_defaults row (feature + method); none for a feature not checked', async () => {
    const defaults: InspectionOperationDefaultRow[] = (['visual_base', 'hole', 'thickness', 'dimension'] as const).map((feature) => ({
      feature, method: 'visual', cycle_time_sec: 5, sampling_default: null, equipment: null,
    }));
    const rate: MHRRateInput = { rate: 10, source: 'mhr_database', machineClass: 'inspection', machineName: 'Bench', commodityCode: null };
    const plan = planInspection({
      holes: [{ diameterMm: 6 }], bends: [], sheetThicknessMm: 2, hasOverallDimensions: true, threads: [], generalTolerances: null, toleranceConfidence: 0,
      gdtCallouts: [], inspectionRules: [], operationDefaults: defaults, inspectionStrategy: 'sampling', samplingRate: 1, batchSize: 10, rate,
    } as unknown as InspectionInput);
    const run = await resolve('t', {
      machineClass: 'inspection', process: 'Inspection', targetFieldNames: ['Total Time'],
      seedScope: {
        'Visual Pass Base': plan.visualPassBaseSec, 'Holes to Inspect': plan.holesToInspect, 'Hole Check Time': plan.holeCheckSec,
        'Bends to Inspect': plan.bendsToInspect, 'Bend Check Time': plan.bendCheckSec, 'Threads to Inspect': plan.threadsToInspect,
        'Thread Gauge Time': plan.threadGaugeSec, 'Has Thickness Check': 1, 'Thickness Check Time': plan.thicknessCheckSec,
        'Has Dimension Check': 1, 'Dimension Check Time': plan.dimensionCheckSec,
      },
      seedRefs: inspectionSeedRefs(plan),
    });
    const row = (feature: string) => ({ kind: 'smTable', table: 'inspection_operation_defaults', column: 'cycle_time_sec', row: { feature, method: plan.method } });
    expect(refOf(run.trace, 'Visual Pass Base')).toEqual(row('visual_base'));
    expect(refOf(run.trace, 'Hole Check Time')).toEqual(row('hole'));
    expect(refOf(run.trace, 'Dimension Check Time')).toEqual(row('dimension'));
    expect(refOf(run.trace, 'Bend Check Time')).toBeUndefined();
    expect(refOf(run.trace, 'Holes to Inspect')).toBeUndefined();
  });

  it('Deburring (the line\'s own resolution): the CAD burr edge, and the selected Deslag machine\'s row of the allowance table', async () => {
    const deslag = await lookup.getDeslagSecPerMmByMachine();
    const candidate = { machineId: 'm1', machineName: 'Timesavers 42', machineClass: 'deburring' };
    const deburring = {
      rate: 5, source: 'mhr_database', machineClass: 'deburring', machineName: 'Timesavers 42', commodityCode: null,
      selection: { requirement: { kind: 'deburr', burrEdgeLengthMm: 1200, deslagSecPerMmByMachine: deslag, manualDeburr: null }, balanced: { candidate } },
    } as unknown as MHRRateInput;
    const run = await (service as unknown as { resolveDeburrCalc: (t: string, r: MHRRateInput) => Promise<ManufacturingPhysicsResult> }).resolveDeburrCalc('t', deburring);
    expect(run.outputs['Total Time']).toBeCloseTo(1200 * 0.004, 9);
    expect(refOf(run.trace, 'Deburr Time Per mm')).toEqual({
      kind: 'smTable', table: 'deslag_allowance', column: 'perimeter_allowance_s_per_mm', row: { machine_name: 'Timesavers 42' },
    });
    expect(refOf(run.trace, 'Burr Edge Length')).toEqual({ kind: 'cad', evidence: 'cut_length' });
  });

  it('a material property opens the record\'s own column, and nothing when the record does not hold it', () => {
    const record = { id: 'rm', name: 'CRCA', columns: { densityKgM3: 'density' as const, utsMpa: null, shearStrengthMpa: 'shear_strength_mpa' as const } };
    expect(materialSeedRefs(record, { 'Material Density': 'densityKgM3', 'Shear Strength': 'shearStrengthMpa', UTS: 'utsMpa' })).toEqual({
      'Material Density': { kind: 'material', materialId: 'rm', materialName: 'CRCA', column: 'density' },
      'Shear Strength': { kind: 'material', materialId: 'rm', materialName: 'CRCA', column: 'shear_strength_mpa' },
    });
    expect(materialSeedRefs(null, { 'Material Density': 'densityKgM3' })).toEqual({});
  });
});
