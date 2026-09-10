// Phase 1 (real thermal + cure-time data) regression tests.
//
// Scope: Compression Molding / Reaction Injection Molding's real per-material
// cure_time_min folding into effective cycle time. Proves: (a) real cure time
// is added on top of the real machine press-cycle time, never replacing it,
// (b) a material with no real cure time on file produces an honest disclosure
// warning and does NOT fabricate a cure-time constant, (c) when the machine
// itself has no real press_cycle_time_s, the underlying $0-cycle-time warning
// still fires and this engine's own cure-time disclosure is suppressed rather
// than adding a confusing second warning on top of it.
//
// Run: npm run test -- cure-time-engines

import { computeCompressionMoldingCost } from '../../../../../../modules/bom-items/costing/plastic-molding/process/cost-compression-molding-engine';
import { computeReactionInjectionMoldingCost } from '../../../../../../modules/bom-items/costing/plastic-molding/process/cost-reaction-injection-molding-engine';
import type { MHRRateInput } from '../../../../../../modules/bom-items/costing/shared/core/cost-engine';

const realMachineRate = (machineClass: string): MHRRateInput => ({
  rate: 1200,
  source: 'mhr_database',
  machineClass,
  machineName: 'Real Test Machine',
  commodityCode: null,
  operators: 1,
  pressCycleTimeS: 45, // real open/close platen motion, seconds
  setupTimeHr: 1.0,    // real per-machine setup, hours
});

// A REAL, selected machine that simply has no press_cycle_time_s on file.
// This is a genuine case: migration 608 records 19 real press-family machines
// (Aida x7, Bliss B-35, Niagara E511B, the Progressive Die placeholders) with
// no press_cycle_time_s anywhere in the staged data.
//
// machineName is deliberately a real name. The previous version of this fixture
// set machineName:null AND pressCycleTimeS:null together, which conflated two
// different failures -- "a machine was selected but its cycle time is unknown"
// and "no machine was selected at all". press-stroke-engine.ts now reports
// those separately (the second cannot be a missing-press_cycle_time_s problem,
// because there is no machine to be missing it), so the fixture has to pick one.
const noCycleTimeMachineRate = (machineClass: string): MHRRateInput => ({
  rate: 1200,
  source: 'mhr_database',
  machineClass,
  machineName: 'Real Test Machine',
  commodityCode: null,
  pressCycleTimeS: null, // no real cycle-time data on file for this machine
});

// Nothing passed the capability check, so selection returned no machine.
const noMachineSelectedRate = (machineClass: string): MHRRateInput => ({
  rate: 1200,
  source: 'default_rate',
  machineClass,
  machineName: null,
  commodityCode: null,
  pressCycleTimeS: null,
});

describe('computeCompressionMoldingCost — real cure-time folding', () => {
  it('material WITH real cure time → cycle time = real press motion + real cure time, disclosure warning names it', () => {
    const withoutCure = computeCompressionMoldingCost({
      batchSize: 100,
      partWeightKg: 0.5,
      rate: realMachineRate('compression_molding'),
      cureTimeMinFromMaterial: null,
    });
    const withCure = computeCompressionMoldingCost({
      batchSize: 100,
      partWeightKg: 0.5,
      rate: realMachineRate('compression_molding'),
      cureTimeMinFromMaterial: 4, // 4 real minutes on file for this grade
    });
    // 4 real minutes = 240s added to the 45s real platen-motion time.
    expect(withCure.cuttingMin).toBeCloseTo(withoutCure.cuttingMin + 4, 5);
    expect(withCure.warnings.some((w) => w.includes('real cure time (4 min)'))).toBe(true);
  });

  it('material WITHOUT real cure time → cycle time reflects only real press motion, honest gap disclosed, never fabricated', () => {
    const result = computeCompressionMoldingCost({
      batchSize: 100,
      partWeightKg: 0.5,
      rate: realMachineRate('compression_molding'),
      cureTimeMinFromMaterial: null,
    });
    expect(result.cuttingMin).toBeCloseTo(45 / 60, 5); // no handling coeff supplied → pure platen motion
    expect(result.warnings.some((w) => w.includes('no real cure-time data on file for this material'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('real cure time'))).toBe(false);
  });

  it('machine itself has no real press_cycle_time_s → underlying $0 warning fires, no redundant cure-time warning added', () => {
    const result = computeCompressionMoldingCost({
      batchSize: 100,
      partWeightKg: 0.5,
      rate: noCycleTimeMachineRate('compression_molding'),
      cureTimeMinFromMaterial: 4,
    });
    expect(result.cuttingMin).toBe(0);
    expect(result.warnings.some((w) => w.includes('no real press_cycle_time_s on file'))).toBe(true);
    // This engine's own cure-time disclosure is gated on pressCycleTimeS != null —
    // it must not add a second, confusing warning when the base $0 warning already covers it.
    expect(result.warnings.some((w) => w.toLowerCase().includes('cure time') || w.toLowerCase().includes('cure-time'))).toBe(false);
  });

  it('no machine selected at all -> reports the capability gap, not a missing press_cycle_time_s', () => {
    // The distinction this asserts is the whole point of the split above: when
    // selection returns nothing, blaming absent press_cycle_time_s sends the
    // reader to the wrong table. Observed for real on tandem_press, where all
    // four USA rows DID carry a real press_cycle_time_s and the actual cause was
    // a zero thickness capability rejecting every candidate (migration 713).
    const result = computeCompressionMoldingCost({
      batchSize: 100,
      partWeightKg: 0.5,
      rate: noMachineSelectedRate('compression_molding'),
      cureTimeMinFromMaterial: 4,
    });
    expect(result.cuttingMin).toBe(0);
    expect(result.warnings.some((w) => w.includes('no capable machine on file for this part'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('no real press_cycle_time_s on file'))).toBe(false);
  });
});

describe('computeReactionInjectionMoldingCost — real cure/reaction-time folding', () => {
  it('material WITH real cure time → cycle time = real dry-cycle + real reaction/cure time', () => {
    const withoutCure = computeReactionInjectionMoldingCost({
      batchSize: 50,
      partWeightKg: 1.2,
      rate: realMachineRate('reaction_injection_molding'),
      cureTimeMinFromMaterial: null,
    });
    const withCure = computeReactionInjectionMoldingCost({
      batchSize: 50,
      partWeightKg: 1.2,
      rate: realMachineRate('reaction_injection_molding'),
      cureTimeMinFromMaterial: 6,
    });
    expect(withCure.cuttingMin).toBeCloseTo(withoutCure.cuttingMin + 6, 5);
    expect(withCure.warnings.some((w) => w.includes('real cure/reaction time (6 min)'))).toBe(true);
  });

  it('material WITHOUT real cure time → honest gap disclosure, no fabricated constant', () => {
    const result = computeReactionInjectionMoldingCost({
      batchSize: 50,
      partWeightKg: 1.2,
      rate: realMachineRate('reaction_injection_molding'),
      cureTimeMinFromMaterial: null,
    });
    expect(result.warnings.some((w) => w.includes('no real fill-time-from-volume or') && w.includes('chemical cure/reaction-time data on file'))).toBe(true);
  });
});
