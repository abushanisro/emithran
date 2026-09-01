import { computePressBrakeCost, type PressBrakeInput } from '../../../../../../modules/bom-items/costing/sheet-metal/process/press-brake-engine';
import type { MHRRateInput } from '../../../../../../modules/bom-items/costing/shared/core/cost-engine';

const realRate: MHRRateInput = {
  rate: 40,
  source: 'mhr_database',
  machineClass: 'press_brake',
  machineName: 'Test Press Brake',
  commodityCode: null,
  labourRate: 20,
};

function baseInput(overrides: Partial<PressBrakeInput> = {}): PressBrakeInput {
  return {
    bendCount: 4,
    batchSize: 10,
    rate: realRate,
    cycleTimeSecFromCalculator: 30,
    fallbackSetupMin: 20,
    ...overrides,
  };
}

describe('computePressBrakeCost — Platform Architecture Remediation Phase 1 (engine registry unification)', () => {
  it('returns no line when not gated (bendCount 0), matching cost-engine.ts inline behavior', () => {
    const result = computePressBrakeCost(baseInput({ bendCount: 0 }));
    expect(result.processLines).toHaveLength(0);
    expect(result.cycleTimeMin).toBe(0);
  });

  it('includes QA inspection-sampling and yield-loss cost when the caller supplies them — the exact terms that were missing before this phase, closing the divergence with cost-engine.ts\'s primary quote path', () => {
    const withoutExtras = computePressBrakeCost(baseInput());
    const withExtras = computePressBrakeCost(baseInput({
      qairPerHr: 30,
      inspTimeMin: 0.5,
      samplingRate: 0.08,
      yieldPct: 0.9,
      netMatCost: 50,
      netWeightKg: 2,
      scrapPricePerKg: 1,
    }));

    const lineWithout = withoutExtras.processLines[0]!;
    const lineWith = withExtras.processLines[0]!;

    // Same cycle time/rate inputs — the only difference is the eMithranTerms
    // inspection-sampling + yield-loss terms, which must now be reflected in
    // totalCost (folded in, same convention as cost-engine.ts's own 9 inline
    // blocks: totalCost includes them even though the separate setupCost/
    // runCost breakdown fields do not).
    expect(lineWith.cycleTimeMin).toBeCloseTo(lineWithout.cycleTimeMin, 5);
    expect(lineWith.totalCost).toBeGreaterThan(lineWithout.totalCost);
  });

  it('produces a real, non-zero cost line for a realistic bend, using the shared eMithranTerms formula', () => {
    const result = computePressBrakeCost(baseInput({
      qairPerHr: 25, inspTimeMin: 0.5, samplingRate: 0.08, yieldPct: 0.98,
      netMatCost: 40, netWeightKg: 1.5, scrapPricePerKg: 0.5,
    }));
    const line = result.processLines[0]!;
    expect(line.process).toBe('Press Brake');
    expect(line.totalCost).toBeGreaterThan(0);
    expect(line.machineClass).toBe('press_brake');
  });
});
