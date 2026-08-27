import { computeTurretPunchCost, type TurretPunchInput } from './turret-punch-engine';

function baseInput(overrides: Partial<TurretPunchInput> = {}): TurretPunchInput {
  return {
    sheetThicknessMm: 2,
    pierceCount: 20,
    holeCount: 3,
    cutLengthMm: 0,
    batchSize: 10,
    turretParams: { hitsPerMin: 200, nibbleMmPerMin: 800, toolChangeSec: 30, dataFound: true },
    ...overrides,
  };
}

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

  it('discloses $0 labour (not a guess) when no differentiated rate was resolved', () => {
    const input = baseInput({
      turretRate: { rate: 90, source: 'mhr_database', machineClass: 'turret_punch', machineName: 'Test Turret', commodityCode: null, labourRate: null },
    });
    const result = computeTurretPunchCost(input);

    expect(result.warnings.some((w) => w.includes('no direct labor rate resolved'))).toBe(true);
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
