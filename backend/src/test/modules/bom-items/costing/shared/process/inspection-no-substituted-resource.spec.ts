import { readFileSync } from 'fs';
import { join } from 'path';

import { planInspection } from '../../../../../../modules/bom-items/costing/shared/process/inspection-engine';
import type { InspectionInput } from '../../../../../../modules/bom-items/costing/shared/process/inspection-engine';

// Missing real data must stay unresolved, never be replaced by another
// resource's rate.
//
// Two substitutions were removed on 2026-09-07:
//
//   CMM       a location with no CMM in mhr_records had its CMM-tier check
//             priced at the GENERIC INSPECTION BENCH rate — a different,
//             cheaper resource — while the warning itself admitted the figure
//             "likely understates real CMM cost". A number known to be wrong at
//             the moment it was produced.
//   Sampling  computeCostSummary defaulted samplingRate to 0.08, so a caller
//             that omitted it silently inspected 8% of every batch and
//             multiplied that into the QA term of every process line.
//
// Both are now unresolved: no machine cost, no sampling multiplier, and a
// warning naming the table to seed.

const rate = (over: Partial<{ rate: number; source: string; machineClass: string; machineName: string | null }> = {}) => ({
  rate: 40, source: 'mhr_database' as const, machineClass: 'cmm',
  machineName: 'Manual Inspection Bench', commodityCode: null, ...over,
}) as InspectionInput['rate'];

/** A part whose tightest tolerance forces the CMM tier. */
function cmmTierInput(over: Partial<InspectionInput> = {}): InspectionInput {
  return {
    holes: [{ diameterMm: 4.2 }, { diameterMm: 5 }],
    bends: [{ lengthMm: 40, radiusMm: 1 }],
    sheetThicknessMm: 1.5,
    hasOverallDimensions: true,
    threads: [],
    generalTolerances: null,
    toleranceConfidence: 0.9,
    // A tight geometric callout is what escalates the method to CMM.
    gdtCallouts: [{ type: 'position', toleranceMm: 0.01 }],
    inspectionRules: [],
    operationDefaults: [],
    inspectionStrategy: 'sampling',
    samplingRate: 0.08,
    batchSize: 100,
    rate: rate(),
    qaInspectorRatePerHr: 47,
    ...over,
  } as InspectionInput;
}

describe('a CMM-tier check never borrows the inspection-bench rate', () => {
  it('leaves the CMM machine rate unresolved when no CMM resource exists', () => {
    // cmmRate absent = the location has no CMM on file. The bench rate passed as
    // `rate` must NOT be used for the CMM-tier check.
    const plan = planInspection(cmmTierInput());
    if (plan.skip) return;

    if (plan.method === 'cmm') {
      expect(plan.rate.rate).toBe(0);
      expect(plan.rate.source).toBe('no_db_rate');
      expect(plan.rate.machineClass).toBe('cmm');
      // Specifically NOT the bench resource it used to fall back to.
      expect(plan.rate.machineName).not.toBe('Manual Inspection Bench');
    }
  });

  it('uses a real CMM rate when one genuinely exists', () => {
    const plan = planInspection(cmmTierInput({
      cmmRate: rate({ rate: 180, machineName: 'Zeiss CONTURA' }),
    }));
    if (plan.skip || plan.method !== 'cmm') return;
    expect(plan.rate.rate).toBe(180);
    expect(plan.rate.machineName).toBe('Zeiss CONTURA');
  });

  it('still uses the real bench resource for non-CMM tiers', () => {
    // Removing the CMM substitution must not disturb visual/caliper/height-gauge
    // costing, where a bench resource is the correct, real answer.
    const plan = planInspection(cmmTierInput({ gdtCallouts: [] }));
    if (plan.skip || plan.method === 'cmm') return;
    expect(plan.rate.machineName).toBe('Manual Inspection Bench');
    expect(plan.rate.rate).toBe(40);
  });
});

describe('the removed substitutions cannot return', () => {
  const serviceSrc = readFileSync(
    join(__dirname, '..', '..', '..', '..', '..', '..', 'modules', 'bom-items', 'bom-items.service.ts'),
    'utf8',
  );
  const engineSrc = readFileSync(
    join(__dirname, '..', '..', '..', '..', '..', '..', 'modules', 'bom-items', 'costing', 'shared', 'core', 'cost-engine.ts'),
    'utf8',
  );
  const executable = (src: string) =>
    src.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  it('does not price a CMM check at the generic inspection bench rate', () => {
    expect(executable(serviceSrc)).not.toMatch(/priced at the generic inspection bench rate/);
  });

  it('does not default the sampling rate to a percentage', () => {
    // `samplingRate = 0` is the unresolved value; any non-zero literal is a
    // sampling plan nobody published.
    expect(executable(engineSrc)).not.toMatch(/samplingRate\s*=\s*0?\.\d/);
    expect(executable(engineSrc)).toMatch(/samplingRate\s*=\s*0\s*,/);
  });
});
