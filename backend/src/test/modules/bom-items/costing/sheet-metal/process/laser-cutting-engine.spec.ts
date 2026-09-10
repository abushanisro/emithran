import { computeLaserCuttingCost, Co2LaserCuttingEngine, ThreeDLaserCuttingEngine, type LaserCuttingInput } from '../../../../../../modules/bom-items/costing/sheet-metal/process/laser-cutting-engine';
import type { UnsupportedOperationGap } from '../../../../../../modules/bom-items/dto/cost-breakdown.dto';
import { LASER_SETUP_MIN } from '../../../../../../modules/bom-items/costing/shared/core/default-rates.constants';
import type { MHRRateInput } from '../../../../../../modules/bom-items/costing/shared/core/cost-engine';

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

    expect(line.setupCost).toBeCloseTo(expectedSetupCost, 5);
    expect(line.runCost).toBeCloseTo(expectedRunCost, 5);
    expect(line.labourRate).toBe(rateWithLabor.labourRate);
    // Before this fix, laser's cost never included a labor term at all — pin
    // that the run cost is now strictly greater than machine-rate-only cost.
    const machineOnlyRunCost = Math.round(((input.cuttingSecFromCalculator! / 3600) * rateWithLabor.rate) * 100) / 100;
    expect(line.runCost).toBeGreaterThan(machineOnlyRunCost);
  });

  it('excludes labor cost (never a guessed number) when no labourRate resolved', () => {
    const rateNoLabor: MHRRateInput = {
      rate: 60, source: 'mhr_database', machineClass: 'fiber_laser', machineName: 'Trumpf TruLaser 3030', commodityCode: null,
    };
    const input = baseInput({ laserRate: rateNoLabor, setupMin: 20 });
    const result = computeLaserCuttingCost(input);
    const line = result.processLines[0];

    expect(line.labourRate).toBeNull();
    expect(line.runCost).toBeCloseTo(((input.cuttingSecFromCalculator! / 3600) * rateNoLabor.rate), 5);
  });

  it('falls back to LASER_SETUP_MIN with a disclosed warning when no setupMin is supplied', () => {
    const input = baseInput({ laserRate: rateWithLabor, setupMin: undefined });
    const result = computeLaserCuttingCost(input);
    // Disclosed because NEITHER real source resolved: no per-machine
    // setup_time_hr on this rate and no sm_lookup_op_setup_time row.
    expect(result.warnings.some((w) => w.startsWith('Laser Cutting: setup time from fallback'))).toBe(true);
    expect(result.processLines[0]!.setupTimeMin).toBeCloseTo(LASER_SETUP_MIN, 5);
    expect(result.processLines[0]!.setupTimeSource).toBe('class_default');
    const dlrMin = rateWithLabor.labourRate! / 60;
    const expectedSetupCost = (LASER_SETUP_MIN / 60) * rateWithLabor.rate / input.batchSize + dlrMin * LASER_SETUP_MIN / input.batchSize;
    expect(result.processLines[0].setupCost).toBeCloseTo(expectedSetupCost, 5);
  });

  it('returns no process lines when there is nothing to cut', () => {
    const result = computeLaserCuttingCost(baseInput({ cutLengthMm: 0, pierceCount: 0, cuttingSecFromCalculator: undefined }));
    expect(result.processLines).toHaveLength(0);
  });
});

// ── CO2 laser: the gap must be reported for its real, documented reason ──
//
// Migration 457 deliberately seeded ZERO co2 rows into sm_lookup_laser_cut (no
// published CO2 cutting-speed/pierce-time table met the sourcing bar), so
// co2_laser has no cycle-time source and must fail closed. Before this fix the
// route-comparison caller handed cuttingSecFromCalculator AND physicsGap to
// fiber_laser only; co2_laser got neither, so the engine fell through to its
// defensive branch and warned "no calculator result and no reported gap
// (unexpected; check resolvePhysicsQuantity)" -- reporting a phantom resolver
// bug in place of a real recorded data gap.
describe('Co2LaserCuttingEngine — reports the real CO2 data gap, never a phantom resolver bug', () => {
  const co2Rate: MHRRateInput = {
    rate: 30.13,
    source: 'mhr_database',
    machineClass: 'co2_laser',
    machineName: 'Laser Cutter - 8000 Watts',
    commodityCode: null,
    labourRate: 9,
  };

  // The exact gap bom-items.service.ts now supplies for co2_laser.
  const co2Gap: UnsupportedOperationGap = {
    gapType: 'unsupported_operation',
    process: 'Laser Cutting',
    machineClass: 'co2_laser',
    reason:
      'no CO2 cutting-speed/pierce-time data exists for any material or thickness -- '
      + 'sm_lookup_laser_cut is fiber-only by design (migration 457, which found no '
      + 'published CO2 table meeting the sourcing bar). CO2 cycle time stays '
      + 'unavailable until real CO2 cutting conditions are sourced; fiber data is '
      + 'never substituted for it.',
    requiredCapability: 'sm_lookup_laser_cut rows with laser_technology = co2',
  };

  it('names the CO2 data gap and does not blame resolvePhysicsQuantity', () => {
    const result = computeLaserCuttingCost(baseInput({
      laserRate: co2Rate,
      setupMin: 20,
      cuttingSecFromCalculator: undefined,
      physicsGap: co2Gap,
    }));

    const gapWarning = result.warnings.find((w) => w.startsWith('Laser cutting cycle time unavailable'));
    expect(gapWarning).toBeDefined();
    expect(gapWarning).toContain('sm_lookup_laser_cut is fiber-only by design');
    expect(gapWarning).toContain('migration 457');
    // The point of the fix: the misleading defensive message must be gone.
    expect(gapWarning).not.toContain('unexpected');
    expect(gapWarning).not.toContain('resolvePhysicsQuantity');
  });

  it('costs no cutting time rather than substituting fiber cycle time', () => {
    const result = computeLaserCuttingCost(baseInput({
      laserRate: co2Rate,
      setupMin: 20,
      cuttingSecFromCalculator: undefined,
      physicsGap: co2Gap,
    }));
    // Fails closed: zero cutting minutes, and no run cost invented for it.
    expect(result.cuttingMin).toBe(0);
    expect(result.processLines[0]!.cycleTimeMin).toBe(0);
  });

  it('still hits the honest gap path when driven through the registered engine', () => {
    // Guards the wiring, not just the formula: the registered co2_laser engine
    // must forward the caller gap into the shared formula unchanged.
    const engine = new Co2LaserCuttingEngine();
    expect(engine.machineClass).toBe('co2_laser');

    const result = engine.computeCost({
      cutLengthMm: 1000,
      pierceCount: 5,
      batchSize: 10,
      grade: 'SS304',
      sheetThicknessMm: 3,
      rate: co2Rate,
      cuttingSecFromCalculator: undefined,
      physicsGap: co2Gap,
      opSetupMin: 20,
    } as unknown as Parameters<Co2LaserCuttingEngine['computeCost']>[0]);

    const gapWarning = result.warnings.find((w) => w.startsWith('Laser cutting cycle time unavailable'));
    expect(gapWarning).toContain('fiber-only by design');
    expect(gapWarning).not.toContain('unexpected');
  });
});

// ── One operation for the profile and its compatible through-holes ────────────
//
// A laser pierces and cuts every through-hole in the same pass that cuts the
// outer profile. The engine is handed the combined cut length and the pierce
// count and must emit exactly ONE process line for the whole blank — adding a
// second, separate hole-making operation on top would charge the same holes
// twice.
describe('computeLaserCuttingCost — profile and through-holes in one operation', () => {
  it('emits a single Laser Cutting line covering profile plus pierces', () => {
    const result = computeLaserCuttingCost(baseInput({
      laserRate: rateWithLabor, setupMin: 20, cutLengthMm: 1000, pierceCount: 14,
    }));
    expect(result.processLines).toHaveLength(1);
    expect(result.processLines[0].process).toBe('Laser Cutting');
  });

  it('still emits one line when the part has no holes at all', () => {
    const result = computeLaserCuttingCost(baseInput({
      laserRate: rateWithLabor, setupMin: 20, pierceCount: 0,
    }));
    expect(result.processLines).toHaveLength(1);
  });
});

// ── laser_3d: a real, separately-specced Digital Factory pool ────────────
//
// Root-caused 2026-09-10, confirmed by real machine_library.json schemas:
// "3D Laser Cutting Machine" uniquely carries bed_height_mm (a real Z-axis
// dimension) — a structurally different real machine category from flat-
// sheet fiber/CO2 laser cutting. Reuses the exact same real cost formula
// (computeLaserCuttingCost has no technology-specific assumption baked in)
// — only the registered machineClass differs, so route comparison can find
// this real pool through its own class.
//
// "Laser Cutting Machine" (24 machines, e.g. "Cincinnati CL 850") was
// briefly given its own 'laser_cut' class + LaserCutEngine the same day,
// before memory/sheetmetal/machine/india_base.json's independent "CO2 Laser
// Cutter" category (the same 24 machines, confirmed name-for-name) showed
// that split was wrong — those machines resolve through the existing
// Co2LaserCuttingEngine/co2_laser class instead (see default-rates.
// constants.ts's co2_laser entry and Co2LaserCuttingEngine's own test above).
describe('ThreeDLaserCuttingEngine — real, separate machine class', () => {
  it('ThreeDLaserCuttingEngine is registered on laser_3d, not fiber_laser', () => {
    const engine = new ThreeDLaserCuttingEngine();
    expect(engine.machineClass).toBe('laser_3d');
    expect(engine.processFamily).toBe('sheet_metal_cutting');
  });

  it('ThreeDLaserCuttingEngine prices a real "3D Laser Cutting Machine" the same real formula', () => {
    const laser3dRate: MHRRateInput = {
      rate: 55.0, source: 'mhr_database', machineClass: 'laser_3d',
      machineName: '3D Laser - 3300 Watts', commodityCode: null, labourRate: 9,
    };
    const engine = new ThreeDLaserCuttingEngine();
    const result = engine.computeCost({
      cutLengthMm: 500, pierceCount: 2, batchSize: 10, grade: 'SS304', sheetThicknessMm: 2,
      rate: laser3dRate, cuttingSecFromCalculator: 60, opSetupMin: 20,
    } as unknown as Parameters<ThreeDLaserCuttingEngine['computeCost']>[0]);

    expect(result.processLines).toHaveLength(1);
    expect(result.processLines[0].process).toBe('Laser Cutting');
    expect(result.processLines[0].hourlyRate).toBe(laser3dRate.rate);
    expect(result.processLines[0].totalCost).toBeGreaterThan(0);
  });
});
