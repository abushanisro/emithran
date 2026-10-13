import { computeTurretPunchCost, distinctHoleDiameterCount, turretMissingInputs, type TurretPunchInput } from '../../../../../../modules/bom-items/costing/sheet-metal/process/turret-punch-engine';
import { findRouteDataGaps } from '../../../../../../modules/bom-items/costing/shared/core/engine-kernel';

// Cycle time is the TPP calculator result (migration 904; the formula is checked in
// test/migrations/904-tpp-calculator.spec.ts). The engine prices that time, or reports
// why there is none.
const TURRET = { rate: 40, source: 'mhr_database', machineClass: 'turret_punch', machineName: 'Amada EM-3510 ZRB', commodityCode: null } as const;

function baseInput(overrides: Partial<TurretPunchInput> = {}): TurretPunchInput {
  return {
    sheetThicknessMm: 2,
    pierceCount: 20,
    cutLengthMm: 0,
    batchSize: 10,
    turretRate: TURRET,
    cuttingSecFromCalculator: 3.871,
    calculatorId: 'calc-id',
    ...overrides,
  };
}

describe('computeTurretPunchCost — prices the calculator cycle time', () => {
  it('uses the calculator seconds as the line cycle time and carries the calculator id', () => {
    const result = computeTurretPunchCost(baseInput({ cuttingSecFromCalculator: 120 }));
    expect(result.cuttingMin).toBeCloseTo(2, 9);
    expect(result.processLines[0]!.cycleTimeMin).toBeCloseTo(2, 9);
    expect(result.processLines[0]!.calculatorId).toBe('calc-id');
    expect(result.processLines[0]!.physicsGap).toBeUndefined();
  });

  it('a longer calculator time costs more on the same machine', () => {
    const short = computeTurretPunchCost(baseInput({ cuttingSecFromCalculator: 60 }));
    const long = computeTurretPunchCost(baseInput({ cuttingSecFromCalculator: 600 }));
    expect(long.processLines[0]!.totalCost).toBeGreaterThan(short.processLines[0]!.totalCost);
  });

  it('adds no gap and no time when there is nothing to punch or nibble', () => {
    const result = computeTurretPunchCost(baseInput({ pierceCount: 0, cutLengthMm: 0, cuttingSecFromCalculator: undefined }));
    expect(result.cuttingMin).toBe(0);
    expect(result.processLines[0]!.physicsGap).toBeUndefined();
  });
});

// Reported live on Rtp2 Mag2 Backframe (124 holes, 5018 mm of cut, no turret machine
// data): the route priced punching and nibbling at $0, looked like the cheapest route
// and Auto applied it. Work with no calculator time is a data gap, so the route is
// incomplete.
describe('computeTurretPunchCost — no calculator time is a data gap, not a $0 operation', () => {
  const reasonOf = (line: { physicsGap?: unknown }) => (line.physicsGap as { reason?: string } | undefined)?.reason ?? '';

  it('raises the gap the caller reports', () => {
    const gap = { gapType: 'unsupported_operation' as const, process: 'Turret Punching', machineClass: 'turret_punch', reason: 'Not priced: example.' };
    const line = computeTurretPunchCost(baseInput({ cuttingSecFromCalculator: undefined, physicsGap: gap })).processLines[0]!;
    expect(line.physicsGap).toEqual(gap);
  });

  it('raises a gap of its own when there was work but neither a time nor a reason', () => {
    const line = computeTurretPunchCost(baseInput({ pierceCount: 128, cuttingSecFromCalculator: undefined })).processLines[0]!;
    expect(line.physicsGap?.gapType).toBe('unsupported_operation');
    expect(reasonOf(line)).toContain('TPP Manufacturing calculator');
  });

  it('makes the route incomplete, so it cannot be auto-recommended', () => {
    const result = computeTurretPunchCost(baseInput({ pierceCount: 128, cuttingSecFromCalculator: undefined }));
    expect(findRouteDataGaps(result.processLines)).toHaveLength(1);
  });
});

describe('turretMissingInputs — why the calculator could not be seeded', () => {
  const full = { nibbleMmPerMin: 2398.5, toolChangeSec: 1.5, dataFound: true, punchRateCyclesPerMin: 500, strokeRateFactor: 0.62, machineTonnageT: 30.6 };

  it('says no machine was selected, not that data is missing, when the route has no machine', () => {
    const why = turretMissingInputs(null, null)!;
    expect(why).toContain('no turret machine could be selected');
    expect(why).not.toContain('has no punch rate');
  });

  it('names the machine when its row has no nibble data', () => {
    expect(turretMissingInputs('Amada Vipros 255', { ...full, dataFound: false })).toContain('Amada Vipros 255');
  });

  it('names the machine and the missing field when it has no punch rate or factor', () => {
    expect(turretMissingInputs('Amada Vipros 255', { ...full, punchRateCyclesPerMin: 0 })).toContain('Amada Vipros 255 has no punch rate');
    expect(turretMissingInputs('Amada Vipros 255', { ...full, strokeRateFactor: null })).toContain('stroke rate factor');
  });

  it('is null when every machine input is on file', () => {
    expect(turretMissingInputs('Amada EM-3510 ZRB', full)).toBeNull();
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
  });

  it('charges $0 labour (not a guess) when no differentiated rate was resolved', () => {
    const input = baseInput({
      turretRate: { rate: 90, source: 'mhr_database', machineClass: 'turret_punch', machineName: 'Test Turret', commodityCode: null, labourRate: null },
    });
    const result = computeTurretPunchCost(input);
    const line = result.processLines[0]!;

    expect(line.labourRate).toBeNull();
    expect(line.runCost).toBeCloseTo((result.cuttingMin / 60) * 90, 5);
  });
});

describe('computeTurretPunchCost — material handling allowance (closeout Plan Phase 2a)', () => {
  it('adds a distinct Material Handling line when a rate is seeded and part weight is known', () => {
    const result = computeTurretPunchCost(baseInput({ partWeightKg: 15, handlingAllowance: { allowanceUsd: 9, dataFound: true } }));
    const handlingLine = result.processLines.find((l) => l.process === 'Material Handling');

    expect(handlingLine).toBeDefined();
    expect(handlingLine!.totalCost).toBe(9);
    expect(handlingLine!.setupCost).toBe(0);
  });

  it('does not add a handling line, and warns, when no rate is seeded for this machine class', () => {
    const result = computeTurretPunchCost(baseInput({ partWeightKg: 15, handlingAllowance: { allowanceUsd: 0, dataFound: false } }));

    expect(result.processLines.some((l) => l.process === 'Material Handling')).toBe(false);
    expect(result.warnings.some((w) => w.includes('no material-handling-allowance rate seeded'))).toBe(true);
  });

  it('does not add a handling line when part weight is unknown, even if a rate is seeded', () => {
    const result = computeTurretPunchCost(baseInput({ handlingAllowance: { allowanceUsd: 9, dataFound: true } }));

    expect(result.processLines.some((l) => l.process === 'Material Handling')).toBe(false);
  });
});

// Rtp2 Mag2 Backframe, real feature graph: 124 plain holes of 13 distinct diameters. The tool
// changes are the 13 diameters, not the 124 holes.
describe('distinctHoleDiameterCount', () => {
  const rtp2 = [[2.5, 60], [3, 6], [3.5, 7], [4, 11], [4.8, 11], [5, 6], [6, 1], [7, 2], [8, 3], [9, 5], [10, 3], [12, 8], [20, 1]]
    .flatMap(([d, n]) => Array.from({ length: n! }, () => d!));

  it('counts one tool per diameter, not one per hole', () => {
    expect(rtp2).toHaveLength(124);
    expect(distinctHoleDiameterCount(rtp2)).toBe(13);
  });

  it('treats diameters within 0.01 mm as one tool', () => {
    expect(distinctHoleDiameterCount([5, 4.999, 5.001])).toBe(1);
    expect(distinctHoleDiameterCount([5, 5.02])).toBe(2);
  });

  it('is null, not 0, when no diameters were recorded', () => {
    expect(distinctHoleDiameterCount([])).toBeNull();
    expect(distinctHoleDiameterCount(undefined)).toBeNull();
  });
});
