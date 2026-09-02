import { computeTurretPunchCost, type TurretPunchInput } from '../../../../../../modules/bom-items/costing/sheet-metal/process/turret-punch-engine';

// Real per-machine nibble/tool-change data for "Amada EM-3510 ZRB"
// (machine_library.json's "Turret Press (Punch Press)" category,
// 2026-09-02): nibble_rate_cycles_min=410, nibble_tool_diameter_mm=6.35,
// nibble_tool_overlap_mm=0.5 -> nibbleMmPerMin = 410*(6.35-0.5) = 2398.5;
// tool_change_time_s=1.5.
function baseInput(overrides: Partial<TurretPunchInput> = {}): TurretPunchInput {
  return {
    sheetThicknessMm: 2,
    pierceCount: 20,
    holeCount: 3,
    cutLengthMm: 0,
    batchSize: 10,
    turretMachineParams: { nibbleMmPerMin: 2398.5, toolChangeSec: 1.5, dataFound: true },
    ...overrides,
  };
}

describe('computeTurretPunchCost — punching (no real hit-rate data exists)', () => {
  it('always costs punching at $0, with a disclosed warning, when there are holes to pierce', () => {
    const result = computeTurretPunchCost(baseInput({ pierceCount: 20 }));
    expect(result.warnings.some((w) => w.includes('no real punch/hit-rate data exists'))).toBe(true);
  });

  it('does not warn about punching when pierceCount is 0', () => {
    const result = computeTurretPunchCost(baseInput({ pierceCount: 0 }));
    expect(result.warnings.some((w) => w.includes('no real punch/hit-rate data exists'))).toBe(false);
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
      turretMachineParams: { nibbleMmPerMin: 0, toolChangeSec: 0, dataFound: false },
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
      turretMachineParams: { nibbleMmPerMin: 0, toolChangeSec: 0, dataFound: false },
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
    expect(line.runCost).toBeCloseTo(Math.round((result.cuttingMin / 60) * 90 * 100) / 100, 5);
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
