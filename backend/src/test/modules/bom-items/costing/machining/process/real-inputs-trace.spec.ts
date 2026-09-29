import {
  computeDrillCycle,
  computeTurningCostSummary,
  type MachiningCostInput,
  type MachineClassId,
} from '../../../../../../modules/bom-items/costing/machining/process/cost-machining-engine';
import { specAsCalculators } from '../../../../../../modules/bom-items/costing/machining/calculators/machining-calculator-spec';

const CALCS = specAsCalculators();
import { resolveDrillingParams } from '../../../../../../modules/bom-items/costing/machining/lookup/drilling-table';
import { resolvePartoffParams } from '../../../../../../modules/bom-items/costing/machining/lookup/partoff-table';
import type { MHRRateInput } from '../../../../../../modules/bom-items/costing/shared/core/cost-engine';
import { realDrillingTable, realHobbingReference, realPartoffTable } from '../real-reference-tables';

// Machining cycle times from real inputs only — CAD geometry and the real
// machining_reference_data tables (read here from the same source CSVs the
// migrations staged). Every number below is either measured, looked up, or
// derived from those by the formula the trace states.

const mc = (s: string) => s as MachineClassId;
const rate = (r: number, extra: Partial<MHRRateInput> = {}): MHRRateInput =>
  ({ rate: r, source: 'mhr_database', machineClass: 'x', machineName: 'M', commodityCode: null, ...extra } as MHRRateInput);

describe('tblDrilling resolution', () => {
  const table = realDrillingTable();

  it('a Ø4 mm drill is a Solid drill with feed interpolated between the Solid band breakpoints', () => {
    const p = resolveDrillingParams(table, 4, 'aluminum')!;
    expect(p.construction).toBe('Solid');
    const row = table.materials!.find((m) => m.material_cut_code === p.materialCutCode)!;
    expect(p.cuttingSpeedMPerMin).toBe(row.cutting_speed_m_min!.solid);
    const lo = row.feed_mm_rev_by_diameter!['0.1']!;
    const hi = row.feed_mm_rev_by_diameter!['19.9']!;
    expect(p.feedMmPerRev).toBeCloseTo(lo + ((4 - 0.1) / (19.9 - 0.1)) * (hi - lo), 5);
    expect(p.feedDerivation).toContain('linear');
  });

  it('a Ø30 mm drill is Insert-Based, with the insert speed', () => {
    const p = resolveDrillingParams(table, 30, 'mild_steel')!;
    expect(p.construction).toBe('Insert-Based');
    const row = table.materials!.find((m) => m.material_cut_code === p.materialCutCode)!;
    expect(p.cuttingSpeedMPerMin).toBe(row.cutting_speed_m_min!.insert_based);
  });
});

describe('computeDrillCycle — CAD + tblDrilling, gaps instead of guesses', () => {
  it('without a CAD depth the hole is not priced and the missing input is named', () => {
    const c = computeDrillCycle(4, 'AL6061-T6', undefined, realDrillingTable(), CALCS);
    expect(c.sec).toBeNull();
    expect(c.missing).toContain('Drilling: Hole Depth');
  });

  it('without the drilling table the hole is not priced', () => {
    const c = computeDrillCycle(4, 'AL6061-T6', 3.029, null, CALCS);
    expect(c.sec).toBeNull();
    expect(c.missing).toContain('tblDrilling (machining_reference_data) could not be read');
  });

  it('times the hole from its CAD depth, and every trace input names its source', () => {
    const table = realDrillingTable();
    const c = computeDrillCycle(4, 'AL6061-T6', 3.029, table, CALCS);
    const p = resolveDrillingParams(table, 4, 'aluminum')!;
    const rpm = (p.cuttingSpeedMPerMin * 1000) / (Math.PI * 4);
    expect(c.sec).toBeCloseTo((3.029 / (rpm * p.feedMmPerRev)) * 60, 6);
    const inputs = c.trace.filter((s) => s.kind === 'input');
    expect(inputs.map((s) => s.source)).toEqual([
      'CAD: hole diameter',
      'CAD: hole depth',
      'CAD: holes of this diameter',
      expect.stringContaining('tblDrilling'),
      expect.stringContaining('tblDrilling'),
    ]);
    // The time comes from the Drilling calculator's own stored formula.
    expect(c.calculatorId).toBe('Machining - Drilling');
    expect(c.trace.find((s) => s.fieldName === 'Time per Hole')?.formula).toBe('{Hole Depth} / {Feed Rate} * 60');
    expect(inputs.some((s) => s.source?.startsWith('Assumption'))).toBe(false);
  });
});

describe('part-off insert selection (tblVirtualPartoffInsertCutData)', () => {
  const rows = realPartoffTable();

  it('picks the narrowest insert whose reach covers the cut', () => {
    const p = resolvePartoffParams(rows, 10, 'aluminum')!;
    const sameMaterial = rows.filter((r) => r.MaterialCutCodeName === p.materialCutCode && r.Hardness === p.hardnessHb);
    const reaching = sameMaterial.filter((r) => r.DepthMaxMm >= 10);
    expect(p.insertWidthMm).toBe(Math.min(...reaching.map((r) => r.LengthMm)));
    expect(p.depthMaxMm).toBeGreaterThanOrEqual(10);
  });

  it('has no parameters for a cut deeper than any real insert reaches', () => {
    const deepest = Math.max(...rows.map((r) => r.DepthMaxMm));
    expect(resolvePartoffParams(rows, deepest + 1, 'aluminum')).toBeNull();
  });
});

describe('turned part costed from CAD geometry (a Ø17.6 × 3.0 mm gear blank)', () => {
  // The reported part: bounding box 17.6 × 17.6 × 3.0 mm; the cad-engine
  // recognised its turned OD as a Ø17.6 mm Ring, 3.0 mm along the axis.
  const input = (overrides: Partial<MachiningCostInput> = {}): MachiningCostInput => ({
    volume: 552.64, surfaceArea: 704.7, maxLength: 17.6, maxWidth: 17.6, maxHeight: 3,
    holeCount: 1, holeGroups: [{ diameter_mm: 4, count: 1, depth_mm: 3.029 }], pocketCount: 0,
    materialGrade: 'Aluminum, ANSI 6061', materialCostPerKg: 5.875, materialDensityKgM3: 2700,
    materialSource: 'db', threads: [], tightestToleranceMm: null, gdtFeatureCount: 0,
    batchSize: 250, family: 'turned', finishedWeightKg: 0.0015,
    mhrRate: rate(2841.505, { machineClass: '2_axis_bar_feed_lathe_with_sub_spindle', setupTimeHr: 0.25 }),
    tappingRate: rate(900, { machineClass: 'tapping' }),
    deburrRate: rate(300, { machineClass: 'manual_deburr' }),
    inspectionRate: rate(450, { machineClass: 'machining_inspection' }),
    surfaceTreatment: null,
    machiningCalculators: CALCS,
    turnedGeometry: {
      diameterMm: 17.6, lengthMm: 3,
      diameterSource: 'CAD: largest turned outer diameter (Ring feature)',
      lengthSource: 'CAD: bounding-box extent along the turning axis',
    },
    blankResult: { form: 'round_bar', sizeLabel: 'Ø20 round bar', billetVolMm3: Math.PI * 10 ** 2 * 8, utilizationPct: 50, barDiameterMm: 20 },
    turningParams: {
      roughCutDepthMm: 1.3, roughCuttingSpeedMPerMin: 250.4, roughFeedMmPerRev: 0.3625,
      finishCutDepthMm: 0.8, finishCuttingSpeedMPerMin: 333.1, finishFeedMmPerRev: 0.29, dataFound: true,
    },
    drillingTable: realDrillingTable(),
    partoffTable: realPartoffTable(),
    ...overrides,
  });

  const result = computeTurningCostSummary(input(), mc('2_axis_bar_feed_lathe_with_sub_spindle'));
  const line = (name: string) => result.processLines.find((l) => l.process === name)!;

  it('turns over the CAD axial length (3.0 mm), not the bounding-box long side (17.6 mm)', () => {
    const trace = line('Finish Turning').calculationTrace!;
    expect(trace.find((s) => s.fieldName === 'Turned Length')).toMatchObject({ value: 3, source: expect.stringContaining('turning axis') });
    const rough = line('Rough Turning').calculationTrace!;
    expect(rough.find((s) => s.fieldName === 'Bar Diameter')).toMatchObject({ value: 20, source: expect.stringContaining('Ø20 round bar') });
    // Both turning lines are evaluated by their database calculators.
    expect(line('Rough Turning').calculatorId).toBe('Machining - Rough Turning');
    expect(line('Finish Turning').calculatorId).toBe('Machining - Finish Turning');
  });

  it('drills the Ø4 hole to its real 3.029 mm CAD depth', () => {
    const drilling = line('Drilling');
    expect(drilling.confidence).toBe('verified');
    expect(drilling.calculationTrace!.find((s) => s.fieldName === 'Hole Depth')).toMatchObject({ value: 3.029, source: 'CAD: hole depth' });
    expect(drilling.cycleTimeMin * 60).toBeCloseTo(computeDrillCycle(4, 'Aluminum, ANSI 6061', 3.029, realDrillingTable(), CALCS).sec!, 1);
  });

  it('parts off through the bar radius with a real insert', () => {
    const parting = line('Parting');
    expect(parting.confidence).toBe('verified');
    expect(parting.calculationTrace!.find((s) => s.fieldName === 'Cut Depth')).toMatchObject({ value: 10 });
    expect(parting.cycleTimeMin).toBeGreaterThan(0);
  });

  it('the setup folded into Rough Turning names the machine record it came from', () => {
    const trace = line('Rough Turning').calculationTrace!;
    expect(trace.find((s) => s.fieldName === 'Setup time')).toMatchObject({ value: 15, source: expect.stringContaining('setup_time_hr') });
  });

  it('a part analysed before edge measurement shows the deburring gap, not an estimate', () => {
    const deburr = line('Deburring');
    expect(deburr.cycleTimeMin).toBe(0);
    expect(deburr.physicsGap).toMatchObject({ reason: expect.stringContaining('CAD sharp-edge length') });
  });
});

describe('gear teeth recognised by CAD (AxiGroove) are hobbed from tblHobbing / tblAnsiHobbing', () => {
  const HOBBING = realHobbingReference();
  const turned = (overrides: Record<string, unknown>) => computeTurningCostSummary({
    volume: 552.64, surfaceArea: 704.7, maxLength: 17.6, maxWidth: 17.6, maxHeight: 3,
    holeCount: 0, holeGroups: [], pocketCount: 0,
    materialGrade: 'Aluminum, ANSI 6061', materialCostPerKg: 5.875, materialDensityKgM3: 2700,
    materialSource: 'db', threads: [], tightestToleranceMm: null, gdtFeatureCount: 0,
    batchSize: 250, family: 'turned', finishedWeightKg: 0.0015,
    mhrRate: rate(2841.505, { machineClass: '2_axis_bar_feed_lathe_with_sub_spindle' }),
    tappingRate: rate(900, { machineClass: 'tapping' }),
    deburrRate: rate(300, { machineClass: 'manual_deburr' }),
    inspectionRate: rate(450, { machineClass: 'machining_inspection' }),
    surfaceTreatment: null,
    machiningCalculators: CALCS,
    hobRate: rate(1500, { machineClass: 'hob_machine' }),
    hobbing: HOBBING,
    ...overrides,
  } as any, mc('2_axis_bar_feed_lathe_with_sub_spindle'));

  it('prices a module-2 steel gear: ANSI hob, tblHobbing speed/feed at the nearest diametral pitch, face width + approach', () => {
    // 30 teeth, tip Ø64 -> module 2; root Ø55 -> tooth depth 4.5; face width 20.
    const r = turned({ materialGrade: 'AISI 1018', toothForms: [{ tooth_count: 30, tip_diameter_mm: 64, root_diameter_mm: 55, face_width_mm: 20 }] });
    const hob = r.processLines.find((l) => l.machineClass === 'hob_machine')!;
    const ansi = HOBBING.ansiRows.filter((a: any) => a.num_starts === HOBBING.defaultNumStarts)
      .reduce((b: any, a: any) => (Math.abs(a.module_mm - 2) < Math.abs(b.module_mm - 2) ? a : b));
    // Module 2 -> diametral pitch 12.7 -> the tabulated DP 11 row of code 1.0 (125 HB).
    const row = HOBBING.hobRows.find((h: any) => h['Material Cut Code Name'] === 1 && h['Diametral Pitch'] === 11)!;
    const hobRpm = (row['Cutting Speed (m / min)'] * 1000) / (Math.PI * ansi.hob_diameter_mm);
    const travel = 20 + Math.sqrt(4.5 * (ansi.hob_diameter_mm - 4.5));
    const sec = (travel * 30) / (hobRpm * HOBBING.defaultNumStarts * row['Feed (mm / rev)']) * 60;
    expect(hob.cycleTimeMin).toBeCloseTo(sec / 60, 2);
    expect(hob.calculationTrace!.find((st) => st.fieldName === 'Hob Diameter')!.source).toContain('tblAnsiHobbing: module');
    expect(hob.calculationTrace!.find((st) => st.fieldName === 'Axial Feed')!.source).toContain('diametral pitch 11');
  });

  it('shows the real 40-tooth aluminium gear (module 0.42) as a named gap: below the smallest ANSI hob and the tables have no aluminium hardness', () => {
    const r = turned({ toothForms: [{ tooth_count: 40, tip_diameter_mm: 17.6, root_diameter_mm: 15.2, face_width_mm: 3 }] });
    const hob = r.processLines.find((l) => l.machineClass === 'hob_machine')!;
    expect(hob.cycleTimeMin).toBe(0);
    const gap = JSON.stringify(hob.physicsGap ?? r.warnings);
    expect(gap).toContain('tblAnsiHobbing');
    expect(hob.calculationTrace!.find((s) => s.fieldName === 'Teeth')).toMatchObject({ value: 40, source: expect.stringContaining('CAD') });
  });
});

describe('lookup-table viewer: the row a machining input came from is identifiable in the flattened table', () => {
  it('the Drilling match outlines exactly the two tblDrilling breakpoint rows the feed was interpolated between', () => {
    const { flattenMachiningLookupTable } = require('../../../../../../modules/bom-items/costing/machining/lookup/machining-lookup-tables');
    const table = realDrillingTable();
    const flat = flattenMachiningLookupTable('tblDrilling', table);
    const c = computeDrillCycle(4, 'AL6061-T6', 3.029, table, CALCS);
    const match = c.lookups['Feed']!;
    expect(match.table).toBe('tblDrilling');
    const outlined = flat.rows.filter((r: any) => Object.entries(match.row).every(([k, v]) => r[k] === v));
    expect(outlined.map((r: any) => r.diameter_mm)).toEqual([0.1, 19.9]);
    expect(outlined.every((r: any) => r.cutting_speed_m_min === c.trace.find((s) => s.fieldName === 'Cutting Speed')!.value)).toBe(true);
  });
});
