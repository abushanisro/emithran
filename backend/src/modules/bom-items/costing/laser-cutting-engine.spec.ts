import { computeLaserCuttingCost, type LaserCuttingInput } from './laser-cutting-engine';
import { LASER_SETUP_MIN } from './default-rates';
import type { MHRRateInput } from './cost-engine';

function baseInput(overrides: Partial<LaserCuttingInput> = {}): LaserCuttingInput {
  return {
    cutLengthMm: 1000,
    pierceCount: 5,
    batchSize: 10,
    grade: 'SS304',
    sheetThicknessMm: 3,
    cuttingSecFromCalculator: 120,
    ...overrides,
  };
}

const rateWithLabor: MHRRateInput = {
  rate: 60,
  source: 'mhr_database',
  machineClass: 'fiber_laser',
  machineName: 'Trumpf TruLaser 3030',
  commodityCode: null,
  labourRate: 9,
};

describe('computeLaserCuttingCost — direct-labor cost (Track B Phase 1 bug fix)', () => {
  it('charges a direct-labor cost when the rate has a resolved labourRate, same formula as waterjet/turret', () => {
    const input = baseInput({ laserRate: rateWithLabor, setupMin: 20 });
    const result = computeLaserCuttingCost(input);
    const line = result.processLines[0];

    const cuttingMin = input.cuttingSecFromCalculator! / 60;
    const dlrMin = rateWithLabor.labourRate! / 60;
    const expectedSetupCost = (20 / 60) * rateWithLabor.rate / input.batchSize + dlrMin * 20 / input.batchSize;
    const expectedRunCost = (input.cuttingSecFromCalculator! / 3600) * rateWithLabor.rate + dlrMin * cuttingMin;

    expect(line.setupCost).toBeCloseTo(Math.round(expectedSetupCost * 100) / 100, 5);
    expect(line.runCost).toBeCloseTo(Math.round(expectedRunCost * 100) / 100, 5);
    expect(line.labourRate).toBe(rateWithLabor.labourRate);
    // Before this fix, laser's cost never included a labor term at all — pin
    // that the run cost is now strictly greater than machine-rate-only cost.
    const machineOnlyRunCost = Math.round(((input.cuttingSecFromCalculator! / 3600) * rateWithLabor.rate) * 100) / 100;
    expect(line.runCost).toBeGreaterThan(machineOnlyRunCost);
  });

  it('discloses a warning and excludes labor cost when no labourRate resolved — never a guessed number', () => {
    const rateNoLabor: MHRRateInput = {
      rate: 60, source: 'mhr_database', machineClass: 'fiber_laser', machineName: 'Trumpf TruLaser 3030', commodityCode: null,
    };
    const input = baseInput({ laserRate: rateNoLabor, setupMin: 20 });
    const result = computeLaserCuttingCost(input);
    const line = result.processLines[0];

    expect(line.labourRate).toBeNull();
    expect(result.warnings).toContain('Laser: no direct labor rate resolved for this process — labor cost excluded from quote');
    const cuttingMin = input.cuttingSecFromCalculator! / 60;
    expect(line.runCost).toBeCloseTo(Math.round(((input.cuttingSecFromCalculator! / 3600) * rateNoLabor.rate) * 100) / 100, 5);
  });

  it('falls back to LASER_SETUP_MIN with a disclosed warning when no setupMin is supplied', () => {
    const input = baseInput({ laserRate: rateWithLabor, setupMin: undefined });
    const result = computeLaserCuttingCost(input);
    expect(result.warnings).toContain("Laser: setup time from fallback — seed sm_lookup_op_setup_time for 'laser'");
    const dlrMin = rateWithLabor.labourRate! / 60;
    const expectedSetupCost = (LASER_SETUP_MIN / 60) * rateWithLabor.rate / input.batchSize + dlrMin * LASER_SETUP_MIN / input.batchSize;
    expect(result.processLines[0].setupCost).toBeCloseTo(Math.round(expectedSetupCost * 100) / 100, 5);
  });

  it('returns no process lines when there is nothing to cut', () => {
    const result = computeLaserCuttingCost(baseInput({ cutLengthMm: 0, pierceCount: 0, cuttingSecFromCalculator: undefined }));
    expect(result.processLines).toHaveLength(0);
  });
});
