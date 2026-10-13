import { computeTurretPunchCost, type TurretPunchInput } from '../../../../../../modules/bom-items/costing/sheet-metal/process/turret-punch-engine';
import { findRouteDataGaps } from '../../../../../../modules/bom-items/costing/shared/core/engine-kernel';

// Real per-machine nibble/tool-change data for "Amada EM-3510 ZRB"
// (machine_library.json's "Turret Press (Punch Press)" category,
// 2026-09-02): nibble_rate_cycles_min=410, nibble_tool_diameter_mm=6.35,
// nibble_tool_overlap_mm=0.5 -> nibbleMmPerMin = 410*(6.35-0.5) = 2398.5;
// tool_change_time_s=1.5. Punch rate 500 hits/min for the same machine (Countries data
// export, punchRate) and the Lookup Table 1 factor for its 30.6 t press (nearest row
// 30 t): simple 0.78, intermediate 0.62, complex 0.55.
const AMADA_EM3510 = {
  nibbleMmPerMin: 2398.5, toolChangeSec: 1.5, dataFound: true,
  punchRateCyclesPerMin: 500, strokeRateFactor: 0.62, machineTonnageT: 30.6,
};
const NO_MACHINE_DATA = {
  nibbleMmPerMin: 0, toolChangeSec: 0, dataFound: false,
  punchRateCyclesPerMin: 0, strokeRateFactor: null, machineTonnageT: null,
};
function baseInput(overrides: Partial<TurretPunchInput> = {}): TurretPunchInput {
  return {
    sheetThicknessMm: 2,
    pierceCount: 20,
    holeCount: 3,
    cutLengthMm: 0,
    batchSize: 10,
    turretMachineParams: AMADA_EM3510,
    ...overrides,
  };
}

describe('computeTurretPunchCost — punching (punch rate x stroke rate factor)', () => {
  it('prices one hit per hole at 60 / (punch rate x factor) seconds', () => {
    // 500 hits/min x 0.62 = 310 effective hits/min; 20 holes -> 20/310 min.
    const result = computeTurretPunchCost(baseInput({ pierceCount: 20, holeCount: 0, cutLengthMm: 0 }));
    expect(result.cuttingMin).toBeCloseTo(20 / 310, 6);
    expect(result.processLines[0]!.physicsGap).toBeUndefined();
  });

  it('is slower for a more complex part on the same machine (factor 0.55 vs 0.78)', () => {
    const only = { pierceCount: 100, holeCount: 0, cutLengthMm: 0 };
    const simple = computeTurretPunchCost(baseInput({ ...only, turretMachineParams: { ...AMADA_EM3510, strokeRateFactor: 0.78 } }));
    const complex = computeTurretPunchCost(baseInput({ ...only, turretMachineParams: { ...AMADA_EM3510, strokeRateFactor: 0.55 } }));
    expect(simple.cuttingMin).toBeCloseTo(100 / (500 * 0.78), 6);
    expect(complex.cuttingMin).toBeCloseTo(100 / (500 * 0.55), 6);
    expect(complex.cuttingMin).toBeGreaterThan(simple.cuttingMin);
  });

  it('is faster on a machine with a higher punch rate (500 vs 240 hits/min)', () => {
    const only = { pierceCount: 100, holeCount: 0, cutLengthMm: 0 };
    const fast = computeTurretPunchCost(baseInput(only));
    const slow = computeTurretPunchCost(baseInput({ ...only, turretMachineParams: { ...AMADA_EM3510, punchRateCyclesPerMin: 240 } }));
    expect(slow.cuttingMin).toBeGreaterThan(fast.cuttingMin);
  });

  it('is a data gap, not a $0 line, when the machine has a nibble row but no punch rate', () => {
    const line = computeTurretPunchCost(baseInput({
      pierceCount: 20, turretMachineParams: { ...AMADA_EM3510, punchRateCyclesPerMin: 0, strokeRateFactor: null },
    })).processLines[0]!;
    expect(line.physicsGap?.gapType).toBe('unsupported_operation');
  });

  it('adds no punching time and no gap when pierceCount is 0', () => {
    const result = computeTurretPunchCost(baseInput({ pierceCount: 0, holeCount: 0 }));
    expect(result.cuttingMin).toBe(0);
    expect(result.processLines[0]!.physicsGap).toBeUndefined();
  });
});

// Reported live on Rtp2 Mag2 Backframe (124 holes, 5018 mm of cut, no turret machine
// data): the route priced punching and nibbling at $0, looked like the cheapest route
// and Auto applied it. Unpriced work is a data gap, so the route is incomplete.
describe('computeTurretPunchCost — unpriced work is a data gap, not a $0 operation', () => {
  const reasonOf = (line: { physicsGap?: unknown }) => {
    const gap = line.physicsGap as { reason?: string } | undefined;
    return gap?.reason ?? '';
  };

  it('raises a gap naming the unpriced punching when there are holes to pierce', () => {
    const line = computeTurretPunchCost(baseInput({ pierceCount: 128, turretMachineParams: NO_MACHINE_DATA })).processLines[0]!;
    expect(line.physicsGap?.gapType).toBe('unsupported_operation');
    expect(reasonOf(line)).toContain('punching 128 holes');
  });

  it('says no machine was selected, not that data is missing, when the route has no machine', () => {
    const line = computeTurretPunchCost(baseInput({ pierceCount: 128, turretMachineParams: NO_MACHINE_DATA })).processLines[0]!;
    expect(reasonOf(line)).toContain('no turret machine could be selected');
    expect(reasonOf(line)).not.toContain('has no punch rate');
  });

  it('names the machine and the missing field when a machine is selected but has no punch rate', () => {
    const line = computeTurretPunchCost(baseInput({
      pierceCount: 128,
      turretRate: { rate: 40, source: 'mhr_database', machineClass: 'turret_punch', machineName: 'Amada Vipros 255', commodityCode: null },
      turretMachineParams: { ...AMADA_EM3510, punchRateCyclesPerMin: 0, strokeRateFactor: null },
    })).processLines[0]!;
    expect(reasonOf(line)).toContain('Amada Vipros 255 has no punch rate');
  });

  it('raises a gap naming the unpriced nibbling when no nibble rate resolved', () => {
    const line = computeTurretPunchCost(baseInput({
      pierceCount: 0, holeCount: 0, cutLengthMm: 5018,
      turretMachineParams: NO_MACHINE_DATA,
    })).processLines[0]!;
    expect(reasonOf(line)).toContain('nibbling 5018 mm');
  });

  it('raises no gap when there is nothing to punch and the nibble rate is real', () => {
    const line = computeTurretPunchCost(baseInput({ pierceCount: 0, holeCount: 0, cutLengthMm: 1000 })).processLines[0]!;
    expect(line.physicsGap).toBeUndefined();
  });

  it('makes the route incomplete, so it cannot be auto-recommended', () => {
    const result = computeTurretPunchCost(baseInput({ pierceCount: 128, turretMachineParams: NO_MACHINE_DATA }));
    expect(findRouteDataGaps(result.processLines)).toHaveLength(1);
  });
});

describe('computeTurretPunchCost — nibbling (real per-machine rate)', () => {
  it('computes nibbling time from the real per-machine nibbleMmPerMin', () => {
    const input = baseInput({ cutLengthMm: 1000, pierceCount: 0, holeCount: 0 });
    const result = computeTurretPunchCost(input);
    const expectedMin = 1000 / 2398.5;
    expect(result.cuttingMin).toBeCloseTo(expectedMin, 6);
    expect(result.warnings.some((w) => w.includes('no real nibble-rate data'))).toBe(false);
  });

  it('stays honestly $0 (no guess) when no real nibble data was resolved for this machine', () => {
    const input = baseInput({
      cutLengthMm: 1000, pierceCount: 0, holeCount: 0,
      turretMachineParams: NO_MACHINE_DATA,
    });
    const result = computeTurretPunchCost(input);
    expect(result.cuttingMin).toBe(0);
    expect(result.warnings.some((w) => w.includes('no real nibble-rate data on file'))).toBe(true);
  });
});

describe('computeTurretPunchCost — tool change (real per-machine time)', () => {
  it('uses the real per-machine toolChangeSec, amortised over batch size', () => {
    const input = baseInput({ holeCount: 3, batchSize: 10, pierceCount: 0, cutLengthMm: 0 });
    const result = computeTurretPunchCost(input);
    const expectedMin = ((3 * 1.5) / 10) / 60;
    expect(result.cuttingMin).toBeCloseTo(expectedMin, 6);
  });

  it('falls back to the corrected TURRET_TOOL_CHANGE_SEC constant and discloses it when no real data is resolved', () => {
    const input = baseInput({
      holeCount: 3, pierceCount: 0, cutLengthMm: 0,
      turretMachineParams: NO_MACHINE_DATA,
    });
    const result = computeTurretPunchCost(input);
    expect(result.warnings.some((w) => w.includes('tool-change time from fallback'))).toBe(true);
  });
});

describe('computeTurretPunchCost — direct labour cost', () => {
  it('charges labour cost for both setup and run time when a differentiated labour rate is resolved', () => {
    const input = baseInput({
      turretRate: { rate: 90, source: 'mhr_database', machineClass: 'turret_punch', machineName: 'Test Turret', commodityCode: null, labourRate: 40 },
      setupMin: 45,
    });
    const result = computeTurretPunchCost(input);
    const line = result.processLines[0]!;

    const dlrMin = 40 / 60;
    const expectedSetupCost = (45 / 60) * 90 / input.batchSize + dlrMin * 45 / input.batchSize;
    const machineOnlyRunCost = (result.cuttingMin / 60) * 90;

    expect(line.setupCost).toBeCloseTo(expectedSetupCost, 2);
    expect(line.runCost).toBeGreaterThan(machineOnlyRunCost);
    expect(result.warnings.some((w) => w.includes('no direct labor rate'))).toBe(false);
  });

  it('charges $0 labour (not a guess) when no differentiated rate was resolved', () => {
    const input = baseInput({
      turretRate: { rate: 90, source: 'mhr_database', machineClass: 'turret_punch', machineName: 'Test Turret', commodityCode: null, labourRate: null },
    });
    const result = computeTurretPunchCost(input);
    const line = result.processLines[0];

    expect(line.labourRate).toBeNull();
    expect(line.runCost).toBeCloseTo((result.cuttingMin / 60) * 90, 5);
  });
});

describe('computeTurretPunchCost — material handling allowance (closeout Plan Phase 2a)', () => {
  it('adds a distinct Material Handling line when a rate is seeded and part weight is known', () => {
    const input = baseInput({
      partWeightKg: 15,
      handlingAllowance: { allowanceUsd: 9, dataFound: true },
    });
    const result = computeTurretPunchCost(input);
    const handlingLine = result.processLines.find((l) => l.process === 'Material Handling');

    expect(handlingLine).toBeDefined();
    expect(handlingLine!.totalCost).toBe(9);
    expect(handlingLine!.setupCost).toBe(0);
  });

  it('does not add a handling line, and warns, when no rate is seeded for this machine class', () => {
    const input = baseInput({ partWeightKg: 15, handlingAllowance: { allowanceUsd: 0, dataFound: false } });
    const result = computeTurretPunchCost(input);

    expect(result.processLines.some((l) => l.process === 'Material Handling')).toBe(false);
    expect(result.warnings.some((w) => w.includes('no material-handling-allowance rate seeded'))).toBe(true);
  });

  it('does not add a handling line when part weight is unknown, even if a rate is seeded', () => {
    const input = baseInput({ handlingAllowance: { allowanceUsd: 9, dataFound: true } });
    const result = computeTurretPunchCost(input);

    expect(result.processLines.some((l) => l.process === 'Material Handling')).toBe(false);
  });
});
