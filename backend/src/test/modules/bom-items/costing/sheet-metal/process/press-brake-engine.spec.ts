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

// ── Setup-time tiering (2026-09-05) ───────────────────────────────────────────
// Press brake is the only sheet-metal engine with a part-specific calculator
// tier, and the only one whose calculator output is already per-piece — its
// real stored formula is "Tool Loading Time / Lot Size" (calculators/009),
// labelled "Setup Time (min/piece)". Everything here pins that asymmetry,
// because getting it wrong charges a whole batch's setup on every single part.
describe('computePressBrakeCost — real setup-time tiering', () => {
  it('treats the calculator value as PER PIECE and does not amortise it again', () => {
    const perPiece = 0.5;
    const result = computePressBrakeCost(baseInput({
      batchSize: 10, setupTimeMinFromCalculator: perPiece, rate: { ...realRate, labourRate: 20 },
    }));
    // setupCost = (mhr/60 + dlr/60 * operators) * setupTimeMinPerPiece
    const expected = (40 / 60 + 20 / 60 * 1) * perPiece;
    expect(result.processLines[0]!.setupCost).toBeCloseTo(Math.round(expected * 100) / 100, 5);
  });

  it('reports the un-amortised batch setup on the line, recovered from the per-piece value', () => {
    // 0.5 min/piece over a lot of 10 IS 5 minutes of real tool loading — that
    // is what apply-route must persist, not the per-piece figure.
    const line = computePressBrakeCost(baseInput({
      batchSize: 10, setupTimeMinFromCalculator: 0.5,
    })).processLines[0]!;
    expect(line.setupTimeMin).toBeCloseTo(5, 5);
    expect(line.setupTimeSource).toBe('calculator');
  });

  it('uses the selected machine own setup_time_hr when the calculator produced none', () => {
    const line = computePressBrakeCost(baseInput({
      batchSize: 10,
      setupTimeMinFromCalculator: undefined,
      rate: { ...realRate, setupTimeHr: 0.75 },   // the real Heller value: 45 min
      operationSetupMin: 30,
      fallbackSetupMin: 20,
    })).processLines[0]!;
    expect(line.setupTimeMin).toBeCloseTo(45, 5);
    expect(line.setupTimeSource).toBe('machine');
  });

  it('falls to the real per-operation lookup before the class constant', () => {
    const line = computePressBrakeCost(baseInput({
      setupTimeMinFromCalculator: undefined, operationSetupMin: 30, fallbackSetupMin: 20,
    })).processLines[0]!;
    expect(line.setupTimeMin).toBeCloseTo(30, 5);
    expect(line.setupTimeSource).toBe('operation_lookup');
  });

  it('falls to the class constant last, and discloses that it did', () => {
    const result = computePressBrakeCost(baseInput({
      setupTimeMinFromCalculator: undefined, operationSetupMin: null, fallbackSetupMin: 20,
    }));
    expect(result.processLines[0]!.setupTimeMin).toBeCloseTo(20, 5);
    expect(result.processLines[0]!.setupTimeSource).toBe('class_default');
    expect(result.warnings.some((w) => w.includes('setup time from fallback'))).toBe(true);
  });

  it('lets two press brakes with different real setup times cost differently', () => {
    const cheap = computePressBrakeCost(baseInput({
      setupTimeMinFromCalculator: undefined, rate: { ...realRate, setupTimeHr: 0.25 },
    })).processLines[0]!;
    const slow = computePressBrakeCost(baseInput({
      setupTimeMinFromCalculator: undefined, rate: { ...realRate, setupTimeHr: 0.75 },
    })).processLines[0]!;
    expect(cheap.setupTimeMin).toBeCloseTo(15, 5);
    expect(slow.setupTimeMin).toBeCloseTo(45, 5);
    expect(slow.setupCost).toBeGreaterThan(cheap.setupCost);
  });
});
