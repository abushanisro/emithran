import { computePressStrokeCost } from '../../../modules/bom-items/costing/sheet-metal/process/press-stroke-engine';
import { PRESS_STROKE_SETUP_MIN, SHEARING_SETUP_MIN } from '../../../modules/bom-items/costing/shared/core/default-rates.constants';
import { SheetMetalLookupService } from '../../../modules/bom-items/costing/sheet-metal/lookup/sheet-metal-lookup.service';

// A Standard Press line showed "Setup (0.0 min) $0.00" while the selected
// machine carried a real setup_time_hr of 0.5 (30 min) in mhr_records. Two
// faults compounded:
//
//   1. sm_lookup_op_setup_time holds 11 rows and NONE is a press class, so
//      resolveOpSetupMin missed — and it reported the miss as `minutes: 0`,
//      which the caller passed on as if it were a measured value.
//   2. PressStrokeEngine was the only sheet-metal engine (1 of 17) not using
//      resolveSetupMinutes. Its own chain tested `input.setupMin != null`,
//      which is true for 0, so it took the miss as a real zero and never
//      consulted rate.setupTimeHr at all.
//
// Both are gone: the miss is null, and this engine uses the shared resolver
// (calculator -> machine setup_time_hr -> operation lookup -> class default).

const rate = (over: Record<string, unknown> = {}) => ({
  rate: 52.8, source: 'mhr_database' as const, machineClass: 'standard_press',
  machineName: 'Standard Press - 3,000kN Press Force', commodityCode: null,
  labourRate: 36.3, operators: 1, setupTimeHr: 0.5, ...over,
}) as never;

const input = (over: Record<string, unknown> = {}) => ({
  batchSize: 125000, partWeightKg: 0.024, rate: rate(),
  pressCycleTimeS: 1.8, dlrPerHr: 36.3, qairPerHr: 47, ...over,
}) as never;

describe('a press line uses the machine setup time on file', () => {
  it('takes the real 0.5 hr setup_time_hr, not zero', () => {
    const r = computePressStrokeCost('Std Press', 'standard_press', input()) as never as
      { processLines: Array<{ setupTimeMin?: number; setupCost: number }> };
    expect(r.processLines[0]!.setupTimeMin).toBe(30);   // 0.5 hr
    expect(r.processLines[0]!.setupCost).toBeGreaterThan(0);
  });

  it('ignores a zero from a missing operation-lookup row', () => {
    // The exact shape that produced $0.00: a miss arriving as 0.
    const r = computePressStrokeCost('Std Press', 'standard_press', input({ setupMin: 0 })) as never as
      { processLines: Array<{ setupTimeMin?: number }> };
    expect(r.processLines[0]!.setupTimeMin).toBe(30);
    expect(r.processLines[0]!.setupTimeMin).not.toBe(0);
  });

  it('falls to the cited class constant when the machine has none', () => {
    const r = computePressStrokeCost('Std Press', 'standard_press', input({ rate: rate({ setupTimeHr: null }) })) as never as
      { processLines: Array<{ setupTimeMin?: number }> };
    expect(r.processLines[0]!.setupTimeMin).toBe(PRESS_STROKE_SETUP_MIN); // 30
  });

  it('uses shearing own cited constant, not the press one', () => {
    const r = computePressStrokeCost(
      'Shearing', 'shear', input({ rate: rate({ setupTimeHr: null, machineClass: 'shear' }) })) as never as
      { processLines: Array<{ setupTimeMin?: number }> };
    expect(r.processLines[0]!.setupTimeMin).toBe(SHEARING_SETUP_MIN); // 22.8
  });

  it('prefers a real operation-lookup row over the class default', () => {
    const r = computePressStrokeCost(
      'Std Press', 'standard_press', input({ rate: rate({ setupTimeHr: null }), setupMin: 12 })) as never as
      { processLines: Array<{ setupTimeMin?: number }> };
    expect(r.processLines[0]!.setupTimeMin).toBe(12);
  });
});

describe('a missing operation-setup row is null, never zero minutes', () => {
  const svc = new SheetMetalLookupService({} as never);
  const resolved = { minutes: new Map([['fiber_laser', 15]]), dataFound: new Set(['fiber_laser']) };

  it('reports a miss as null', () => {
    expect(svc.resolveOpSetupMin(resolved, 'standard_press')).toEqual({ minutes: null, dataFound: false });
  });

  it('still returns a real hit', () => {
    expect(svc.resolveOpSetupMin(resolved, 'fiber_laser')).toEqual({ minutes: 15, dataFound: true });
  });
});
