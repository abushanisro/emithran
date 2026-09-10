import { SheetMetalLookupService, resolveNearestStandardTonnageClass } from '../../../../../../modules/bom-items/costing/sheet-metal/lookup/sheet-metal-lookup.service';

// Manual-stroke rows actually seeded for tonnage=80/simple (migration 360) —
// same three rows the live "Result Unavailable" trace showed as nearest
// matches for a 0.5mm request (thicknessMm=1 -> 1.18, =2 -> 1.30, =3 -> 1.46).
const MANUAL_STROKE_ROWS_80T_SIMPLE = [
  { thickness_mm: 1, tonnage: 80, complexity: 'simple', stroke_time_sec: 1.18 },
  { thickness_mm: 2, tonnage: 80, complexity: 'simple', stroke_time_sec: 1.30 },
  { thickness_mm: 3, tonnage: 80, complexity: 'simple', stroke_time_sec: 1.46 },
];

function fakeSupabaseService(rows: typeof MANUAL_STROKE_ROWS_80T_SIMPLE) {
  const builder: any = {
    from: (_table: string) => builder,
    select: (_cols: string) => builder,
    eq: (_col: string, _val: unknown) => builder,
    limit: (_n: number) => builder,
    lte: (_col: string, _val: unknown) => builder,
    gte: (_col: string, _val: unknown) => builder,
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (v: { data: unknown }) => void) => resolve({ data: rows }),
  };
  return { getAdminClient: () => builder } as any;
}

describe('SheetMetalLookupService.getManualStrokeTime', () => {
  it('still resolves an exact seeded row unchanged', async () => {
    const svc = new SheetMetalLookupService(fakeSupabaseService(MANUAL_STROKE_ROWS_80T_SIMPLE));
    const result = await svc.getManualStrokeTime(1, 80, 'simple');
    expect(result.dataFound).toBe(true);
    expect(result.secondsPerBend).toBeCloseTo(1.18, 2);
    expect(result.resolution.policy).toBe('EXACT_MATCH');
  });

  it('still interpolates between two real bracketing rows unchanged', async () => {
    const svc = new SheetMetalLookupService(fakeSupabaseService(MANUAL_STROKE_ROWS_80T_SIMPLE));
    const result = await svc.getManualStrokeTime(1.5, 80, 'simple');
    expect(result.dataFound).toBe(true);
    // Linear midpoint of 1.18 and 1.30.
    expect(result.secondsPerBend).toBeCloseTo(1.24, 2);
    expect(result.resolution.matchedRow?.columns['interpolated_between_thickness_mm']).toBe('1-2');
  });

  it('extrapolates below the smallest real row instead of reporting a bare gap (0.5mm/80T/simple)', async () => {
    const svc = new SheetMetalLookupService(fakeSupabaseService(MANUAL_STROKE_ROWS_80T_SIMPLE));
    const result = await svc.getManualStrokeTime(0.5, 80, 'simple');
    expect(result.dataFound).toBe(true);
    // Local slope between the two nearest real rows (1mm->1.18s, 2mm->1.30s)
    // is 0.12s/mm; extrapolating half a step below 1mm: 1.18 - 0.5*0.12 = 1.12.
    expect(result.secondsPerBend).toBeCloseTo(1.12, 2);
    expect(result.resolution.matchedRow?.columns['extrapolated_from_thickness_mm']).toBe('1-2');
    expect(result.resolution.matchedRow?.columns['interpolated_between_thickness_mm']).toBeUndefined();
  });

  it('still reports a real gap when fewer than two real rows exist on the near side', async () => {
    const svc = new SheetMetalLookupService(fakeSupabaseService([MANUAL_STROKE_ROWS_80T_SIMPLE[0]]));
    const result = await svc.getManualStrokeTime(0.5, 80, 'simple');
    expect(result.dataFound).toBe(false);
    expect(result.resolution.matchedRow).toBeNull();
  });
});

// getWaterjetAbrasiveRateForMachine() — the real, selected machine's own
// abrasive_flow_rate_kg_min from machine_library.json (staged into
// sm_reference_data, category='machine'), which bom-items.service.ts now
// prefers over the generic pump-tier average when the selected waterjet
// machine happens to be one of the 281 named reference machines.
function fakeMachineReferenceData(rows: Array<{ raw: Record<string, unknown> }>) {
  const builder: any = {
    from: (_table: string) => builder,
    select: (_cols: string) => builder,
    eq: (_col: string, _val: unknown) => builder,
    then: (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: rows, error: null }),
  };
  return { getAdminClient: () => builder } as any;
}

describe('SheetMetalLookupService.getWaterjetAbrasiveRateForMachine', () => {
  it('returns the real machine-specific rate on an unambiguous exact name match', async () => {
    const svc = new SheetMetalLookupService(fakeMachineReferenceData([
      { raw: { name: 'OMAX 2626', abrasive_flow_rate_kg_min: 0.45 } },
      { raw: { name: 'Some Other Waterjet', abrasive_flow_rate_kg_min: 0.6 } },
    ]));
    const result = await svc.getWaterjetAbrasiveRateForMachine('OMAX 2626');
    expect(result).toEqual({ kgPerMin: 0.45, dataFound: true });
  });

  it('matches case-insensitively, same discipline as lookupMachineLibraryBenchmark', async () => {
    const svc = new SheetMetalLookupService(fakeMachineReferenceData([
      { raw: { name: 'OMAX 2626', abrasive_flow_rate_kg_min: 0.45 } },
    ]));
    const result = await svc.getWaterjetAbrasiveRateForMachine('omax 2626');
    expect(result).toEqual({ kgPerMin: 0.45, dataFound: true });
  });

  it('returns dataFound: false when no machine name is given', async () => {
    const svc = new SheetMetalLookupService(fakeMachineReferenceData([]));
    const result = await svc.getWaterjetAbrasiveRateForMachine(null);
    expect(result).toEqual({ kgPerMin: 0, dataFound: false });
  });

  it('never guesses across an ambiguous (duplicate-name) match', async () => {
    const svc = new SheetMetalLookupService(fakeMachineReferenceData([
      { raw: { name: 'OMAX 2626', abrasive_flow_rate_kg_min: 0.45 } },
      { raw: { name: 'OMAX 2626', abrasive_flow_rate_kg_min: 0.50 } },
    ]));
    const result = await svc.getWaterjetAbrasiveRateForMachine('OMAX 2626');
    expect(result).toEqual({ kgPerMin: 0, dataFound: false });
  });

  it('returns dataFound: false when the matched machine has no real abrasive rate on file', async () => {
    const svc = new SheetMetalLookupService(fakeMachineReferenceData([
      { raw: { name: 'OMAX 2626', abrasive_flow_rate_kg_min: null } },
    ]));
    const result = await svc.getWaterjetAbrasiveRateForMachine('OMAX 2626');
    expect(result).toEqual({ kgPerMin: 0, dataFound: false });
  });
});

// getTurretPunchParamsForMachine() — real per-machine punch_rate_cycles_min/
// tool_change_time_s, preferred outright over the thickness-keyed
// sm_lookup_turret_punch curve per explicit product decision.
describe('SheetMetalLookupService.getTurretPunchParamsForMachine', () => {
  it('returns both real fields on an unambiguous exact name match', async () => {
    const svc = new SheetMetalLookupService(fakeMachineReferenceData([
      { raw: { name: 'Whitney 3700 SST', punch_rate_cycles_min: 350, tool_change_time_s: 2.5 } },
    ]));
    const result = await svc.getTurretPunchParamsForMachine('Whitney 3700 SST');
    expect(result).toEqual({ hitsPerMin: 350, toolChangeSec: 2.5, dataFound: true });
  });

  it('returns dataFound: true with a partial result when only one field is real', async () => {
    const svc = new SheetMetalLookupService(fakeMachineReferenceData([
      { raw: { name: 'Whitney 3700 SST', punch_rate_cycles_min: 350, tool_change_time_s: null } },
    ]));
    const result = await svc.getTurretPunchParamsForMachine('Whitney 3700 SST');
    expect(result).toEqual({ hitsPerMin: 350, toolChangeSec: null, dataFound: true });
  });

  it('returns dataFound: false when no machine name is given', async () => {
    const svc = new SheetMetalLookupService(fakeMachineReferenceData([]));
    const result = await svc.getTurretPunchParamsForMachine(undefined);
    expect(result).toEqual({ hitsPerMin: null, toolChangeSec: null, dataFound: false });
  });

  it('never guesses across an ambiguous (duplicate-name) match', async () => {
    const svc = new SheetMetalLookupService(fakeMachineReferenceData([
      { raw: { name: 'Whitney 3700 SST', punch_rate_cycles_min: 350, tool_change_time_s: 2.5 } },
      { raw: { name: 'Whitney 3700 SST', punch_rate_cycles_min: 400, tool_change_time_s: 3.0 } },
    ]));
    const result = await svc.getTurretPunchParamsForMachine('Whitney 3700 SST');
    expect(result).toEqual({ hitsPerMin: null, toolChangeSec: null, dataFound: false });
  });
});

describe('SheetMetalLookupService.getBendCycleTimeForMachine', () => {
  it('returns the real per-machine bend cycle time on an unambiguous match', async () => {
    const svc = new SheetMetalLookupService(fakeMachineReferenceData([
      { raw: { name: 'Default Bend Brake', bend_cycle_time_s: 4.2 } },
    ]));
    const result = await svc.getBendCycleTimeForMachine('Default Bend Brake');
    expect(result).toEqual({ secondsPerBend: 4.2, dataFound: true });
  });

  it('returns dataFound: false when no machine name is given', async () => {
    const svc = new SheetMetalLookupService(fakeMachineReferenceData([]));
    const result = await svc.getBendCycleTimeForMachine(null);
    expect(result).toEqual({ secondsPerBend: null, dataFound: false });
  });
});

describe('SheetMetalLookupService.getManualStrokeTimeForPressBrake', () => {
  it('prefers the real per-machine cycle time outright over the generic curve, keeping resolution/roundedFromTonnage from the curve', async () => {
    const svc = new SheetMetalLookupService(fakeSupabaseService(MANUAL_STROKE_ROWS_80T_SIMPLE));
    // Stub the real-machine lookup independently of the generic-curve fake DB.
    (svc as any).getBendCycleTimeForMachine = async () => ({ secondsPerBend: 0.9, dataFound: true });

    const result = await svc.getManualStrokeTimeForPressBrake(1, 80, 'simple', 'Real Machine');
    expect(result.secondsPerBend).toBe(0.9);
    expect(result.dataFound).toBe(true);
    // Generic curve's own resolution trace still comes through unchanged.
    expect(result.resolution.policy).toBe('EXACT_MATCH');
  });

  it('falls back to the generic curve untouched when no real per-machine data exists', async () => {
    const svc = new SheetMetalLookupService(fakeSupabaseService(MANUAL_STROKE_ROWS_80T_SIMPLE));
    (svc as any).getBendCycleTimeForMachine = async () => ({ secondsPerBend: null, dataFound: false });

    const result = await svc.getManualStrokeTimeForPressBrake(1, 80, 'simple', 'Unknown Machine');
    expect(result.secondsPerBend).toBeCloseTo(1.18, 2);
    expect(result.dataFound).toBe(true);
  });
});

// getRollBendingCycleTime() — real per-machine 3/4-Roll Bender cycle time
// from machine_library.json's rolling_speed_mm_s/prebend_time_s/pass limits
// (staged into sm_reference_data, category='machine'). Single-pass parts get
// a real computed time; multi-pass-capable parts get an honest gap (no
// fabricated pass count); out-of-capability parts are marked not capable.
describe('SheetMetalLookupService.getRollBendingCycleTime', () => {
  const machine = {
    name: 'Faccin HCU 2050 X 5',
    rolling_speed_mm_s: 80,
    prebend_time_s: 45,
    max_single_pass_thickness_mm: 15,
    min_single_pass_diameter_mm: 550,
    max_multi_pass_thickness_mm: 20,
    min_multi_pass_diameter_mm: 600,
  };

  it('computes real single-pass cycle time (developed length / speed + 2x prebend) when within single-pass limits', async () => {
    const svc = new SheetMetalLookupService(fakeMachineReferenceData([{ raw: machine }]));
    // developed length 4000mm at 80mm/s = 50s rolling + 2*45s prebend = 140s
    const result = await svc.getRollBendingCycleTime('Faccin HCU 2050 X 5', 4000, 10, 600);
    expect(result).toEqual({ secondsPerPart: 140, passMode: 'single', capable: true, dataFound: true });
  });

  it('flags multi-pass parts as capable with an honest gap instead of a fabricated pass count', async () => {
    const svc = new SheetMetalLookupService(fakeMachineReferenceData([{ raw: machine }]));
    // 18mm exceeds single-pass max (15mm) but is within multi-pass max (20mm)
    const result = await svc.getRollBendingCycleTime('Faccin HCU 2050 X 5', 4000, 18, 600);
    expect(result.capable).toBe(true);
    expect(result.passMode).toBe('multi');
    expect(result.secondsPerPart).toBeNull();
    expect(result.gapReason).toMatch(/multiple rolling passes/);
  });

  it('marks a part outside both single- and multi-pass limits as not capable', async () => {
    const svc = new SheetMetalLookupService(fakeMachineReferenceData([{ raw: machine }]));
    const result = await svc.getRollBendingCycleTime('Faccin HCU 2050 X 5', 4000, 25, 600);
    expect(result.capable).toBe(false);
    expect(result.secondsPerPart).toBeNull();
    expect(result.dataFound).toBe(true);
    expect(result.gapReason).toMatch(/Exceeds this machine's real capability/);
  });

  it('returns dataFound: false when no machine name is given', async () => {
    const svc = new SheetMetalLookupService(fakeMachineReferenceData([]));
    const result = await svc.getRollBendingCycleTime(null, 4000, 10, 600);
    expect(result).toEqual({ secondsPerPart: null, passMode: null, capable: false, dataFound: false });
  });

  it('never guesses across an ambiguous (duplicate-name) match', async () => {
    const svc = new SheetMetalLookupService(fakeMachineReferenceData([
      { raw: machine },
      { raw: { ...machine, rolling_speed_mm_s: 60 } },
    ]));
    const result = await svc.getRollBendingCycleTime('Faccin HCU 2050 X 5', 4000, 10, 600);
    expect(result).toEqual({ secondsPerPart: null, passMode: null, capable: false, dataFound: false });
  });

  it('returns dataFound: false when the matched machine has no real rolling speed on file', async () => {
    const svc = new SheetMetalLookupService(fakeMachineReferenceData([
      { raw: { ...machine, rolling_speed_mm_s: null } },
    ]));
    const result = await svc.getRollBendingCycleTime('Faccin HCU 2050 X 5', 4000, 10, 600);
    expect(result.dataFound).toBe(false);
  });
});

// getToolingAnnualVolumeThresholds() — real sm_reference_data 'variable' rows
// (migration 479): progDieAnnualVolumeLimit / stageToolingAnnualVolumeLimit,
// the sourced annual-volume thresholds gating whether Progressive Die /
// Tandem Press hard tooling is economical for a given part.
function fakeVariableRows(rows: Array<{ key: string; value: string }>) {
  const builder: any = {
    from: (_table: string) => builder,
    select: (_cols: string) => builder,
    eq: (_col: string, _val: unknown) => builder,
    in: (_col: string, _vals: unknown[]) => builder,
    then: (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: rows, error: null }),
  };
  return { getAdminClient: () => builder } as any;
}

describe('SheetMetalLookupService.getToolingAnnualVolumeThresholds', () => {
  it('returns both real thresholds unchanged when both rows are present', async () => {
    const svc = new SheetMetalLookupService(fakeVariableRows([
      { key: 'progDieAnnualVolumeLimit', value: '15000' },
      { key: 'stageToolingAnnualVolumeLimit', value: '10000' },
    ]));
    const result = await svc.getToolingAnnualVolumeThresholds();
    expect(result.progressiveDie).toBe(15000);
    expect(result.stageTooling).toBe(10000);
  });

  it('reports a real null for a threshold whose row is missing, never a fabricated default', async () => {
    const svc = new SheetMetalLookupService(fakeVariableRows([
      { key: 'progDieAnnualVolumeLimit', value: '15000' },
    ]));
    const result = await svc.getToolingAnnualVolumeThresholds();
    expect(result.progressiveDie).toBe(15000);
    expect(result.stageTooling).toBeNull();
  });

  it('returns both null when the query finds no rows at all', async () => {
    const svc = new SheetMetalLookupService(fakeVariableRows([]));
    const result = await svc.getToolingAnnualVolumeThresholds();
    expect(result.progressiveDie).toBeNull();
    expect(result.stageTooling).toBeNull();
  });
});

// resolveNearestStandardTonnageClass — root-caused live 2026-08-31: real USA
// press brakes whose kN-derived tonnage sits 10-11% from their clearly-
// intended standard class (previously excluded by a 10% cutoff) now resolve
// correctly; genuinely different-sized real machines (13%+ away) still don't.
describe('resolveNearestStandardTonnageClass', () => {
  it('rounds "11010 (Heller-hydraulic)" (1096kN -> 111.76t, 10.52% from 100T) to the 100T class', () => {
    const result = resolveNearestStandardTonnageClass(1096 / 9.80665);
    expect(result.tonnage).toBe(100);
    expect(result.roundedFrom).toBeCloseTo(111.76, 1);
  });

  it('rounds "HG-2204 (Amada)" (2200kN -> 224.34t, 10.85% from 200T) to the 200T class', () => {
    const result = resolveNearestStandardTonnageClass(2200 / 9.80665);
    expect(result.tonnage).toBe(200);
  });

  it('does NOT round "HG-1303 (Amada)" (1300kN -> 132.56t, 13.15% from 150T) — genuinely a different real size', () => {
    const result = resolveNearestStandardTonnageClass(1300 / 9.80665);
    expect(result.tonnage).toBeCloseTo(132.56, 1);
    expect(result.roundedFrom).toBeNull();
  });

  it('still rounds already-close real machines unchanged (e.g. "Bend Brake - 800kN Press Force", 1.93% from 80T)', () => {
    const result = resolveNearestStandardTonnageClass(800 / 9.80665);
    expect(result.tonnage).toBe(80);
  });
});

// getProgressiveDieToolingVariables() — real sm_reference_data 'variable' rows
// (migration 479) progressive-die-tooling-engine.ts needs to price the real
// BOM subtotal and estimate real, unpriced toolmaker build hours.
describe('SheetMetalLookupService.getProgressiveDieToolingVariables', () => {
  it('normalises whole-number percentages and leaves already-fractional ones alone', async () => {
    const svc = new SheetMetalLookupService(fakeVariableRows([
      { key: 'orMarkupPercent', value: '10' },
      { key: 'percentSGandA', value: '.1' },
      { key: 'percentProfit', value: '.1' },
      { key: 'orDesignPercent', value: '32.8' },
      { key: 'orAssemblyPercent', value: '35.6' },
      { key: 'orDebugPercent', value: '4.1' },
      { key: 'orReworkPercent', value: '2' },
      { key: 'assyHrsCompProgDie', value: '1.1' },
    ]));
    const result = await svc.getProgressiveDieToolingVariables();
    expect(result.toolingMarkupPct).toBeCloseTo(0.10, 5);
    expect(result.sgAndAPct).toBeCloseTo(0.10, 5);
    expect(result.profitPct).toBeCloseTo(0.10, 5);
    expect(result.designHoursPct).toBeCloseTo(0.328, 5);
    expect(result.assemblyHoursPct).toBeCloseTo(0.356, 5);
    expect(result.debugHoursPct).toBeCloseTo(0.041, 5);
    expect(result.reworkHoursPct).toBeCloseTo(0.02, 5);
    // Not a percentage at all — a direct multiplier dial, left as-is.
    expect(result.progDieAssemblyDial).toBe(1.1);
  });

  it('passes real per-die-block hour figures through unchanged', async () => {
    const svc = new SheetMetalLookupService(fakeVariableRows([
      { key: 'dbCncSetupHrs', value: '0.75' },
      { key: 'dbMillingHrs', value: '1.5' },
      { key: 'dbCncHrsPerPocket', value: '0.5' },
      { key: 'dbMilledPocketsPerDieBlock', value: '5' },
      { key: 'dbGrindingHrsPerDieBlock', value: '3' },
      { key: 'dbDrillingHrsPerDieBlock', value: '0' },
      { key: 'dbWireEdmSetupHrs', value: '1' },
    ]));
    const result = await svc.getProgressiveDieToolingVariables();
    expect(result.dbCncSetupHrs).toBe(0.75);
    expect(result.dbMillingHrs).toBe(1.5);
    expect(result.dbCncHrsPerPocket).toBe(0.5);
    expect(result.dbMilledPocketsPerDieBlock).toBe(5);
    expect(result.dbGrindingHrsPerDieBlock).toBe(3);
    expect(result.dbDrillingHrsPerDieBlock).toBe(0);
    expect(result.dbWireEdmSetupHrs).toBe(1);
  });

  it('reports a real null for every field when no rows are on file, never a fabricated default', async () => {
    const svc = new SheetMetalLookupService(fakeVariableRows([]));
    const result = await svc.getProgressiveDieToolingVariables();
    for (const v of Object.values(result)) expect(v).toBeNull();
  });

  it('reports a real null for one specific missing field while the rest resolve', async () => {
    const svc = new SheetMetalLookupService(fakeVariableRows([
      { key: 'dbGrindingHrsPerDieBlock', value: '3' },
    ]));
    const result = await svc.getProgressiveDieToolingVariables();
    expect(result.dbGrindingHrsPerDieBlock).toBe(3);
    expect(result.dbMillingHrs).toBeNull();
  });
});

// getToolingComponentCosts() — real progressive-die/stage-tooling BOM costs
// (migration 720, sm_lookup_tooling_component_costs).
describe('SheetMetalLookupService.getToolingComponentCosts', () => {
  function fakeComponentCostRows(rows: Array<Record<string, unknown>>) {
    const builder: any = {
      from: (_table: string) => builder,
      select: (_cols: string) => builder,
      then: (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: rows, error: null }),
    };
    return { getAdminClient: () => builder } as any;
  }

  it('maps real rows through, including the null model of a single-variant component', async () => {
    const svc = new SheetMetalLookupService(fakeComponentCostRows([
      { component_name: 'dieButton', model: null, size_mm: null, cost_usd: '125', weight_kg: '0.5' },
      { component_name: 'guidePinAssy', model: 'small', size_mm: '50.8', cost_usd: '360', weight_kg: '10' },
    ]));
    const rows = await svc.getToolingComponentCosts();
    expect(rows).toEqual([
      { componentName: 'dieButton', model: null, sizeMm: null, costUsd: 125, weightKg: 0.5 },
      { componentName: 'guidePinAssy', model: 'small', sizeMm: 50.8, costUsd: 360, weightKg: 10 },
    ]);
  });

  it('returns an empty array, never fabricated rows, when the table has none on file', async () => {
    const svc = new SheetMetalLookupService(fakeComponentCostRows([]));
    expect(await svc.getToolingComponentCosts()).toEqual([]);
  });
});

// getToolingCoatingCostPerKg() — real per-kg coating cost (migration 721,
// sm_lookup_tooling_coating_cost).
describe('SheetMetalLookupService.getToolingCoatingCostPerKg', () => {
  function fakeCoatingRow(row: Record<string, unknown> | null) {
    const builder: any = {
      from: (_table: string) => builder,
      select: (_cols: string) => builder,
      eq: (_col: string, _val: unknown) => builder,
      maybeSingle: () => Promise.resolve({ data: row, error: null }),
    };
    return { getAdminClient: () => builder } as any;
  }

  it('resolves the real rate for an exact (toolMaterial, coatingType) pair', async () => {
    const svc = new SheetMetalLookupService(fakeCoatingRow({ coating_cost_usd_per_kg: '3.4' }));
    expect(await svc.getToolingCoatingCostPerKg('D2', 'CVD')).toBe(3.4);
  });

  it('returns null, never substituting a different pair\'s rate, when this exact pair has none on file', async () => {
    const svc = new SheetMetalLookupService(fakeCoatingRow(null));
    expect(await svc.getToolingCoatingCostPerKg('S7', 'CVD')).toBeNull();
  });
});
