import { ProcessCostCalculationEngine, ProcessCostInput } from '../../../../modules/processes/engines/process-cost-calculation.engine';

describe('ProcessCostCalculationEngine', () => {
  const engine = new ProcessCostCalculationEngine();

  const baseInput: ProcessCostInput = {
    directRate: 46.67,
    machineRate: 23,
    setupManning: 1,
    setupTime: 96.7,
    batchSize: 250,
    heads: 1,
    cycleTime: 27,
    partsPerCycle: 1,
    scrap: 0,
  };

  // Regression coverage for a bug where setupManning/heads/scrap were validated
  // as inputs but never actually applied in the cost formula — changing them
  // had zero effect on totalCostPerPart.

  it('increasing setupManning increases the total (previously had zero effect)', () => {
    const base = engine.calculate(baseInput);
    const withMoreSetupCrew = engine.calculate({ ...baseInput, setupManning: 3 });
    expect(withMoreSetupCrew.setupCostPerPart).toBeGreaterThan(base.setupCostPerPart);
    expect(withMoreSetupCrew.totalCostPerPart).toBeGreaterThan(base.totalCostPerPart);
  });

  it('increasing heads increases the total (previously had zero effect)', () => {
    const base = engine.calculate(baseInput);
    const withMoreHeads = engine.calculate({ ...baseInput, heads: 3 });
    expect(withMoreHeads.cycleLaborCostPerPart).toBeGreaterThan(base.cycleLaborCostPerPart);
    expect(withMoreHeads.totalCostPerPart).toBeGreaterThan(base.totalCostPerPart);
  });

  it('increasing scrap% increases the total (previously a hardcoded no-op)', () => {
    const base = engine.calculate(baseInput);
    const withScrap = engine.calculate({ ...baseInput, scrap: 10 });
    expect(withScrap.scrapAdjustment).toBeGreaterThan(0);
    expect(withScrap.totalCostPerPart).toBeGreaterThan(base.totalCostPerPart);
  });

  it('matches hand-computed arithmetic for the default (manning=1, heads=1, scrap=0) case', () => {
    const result = engine.calculate(baseInput);
    const machineRate = baseInput.machineRate as number;
    const setupTimeMinPerPart = baseInput.setupTime / baseInput.batchSize;
    const cycleTimeMinPerPart = (baseInput.cycleTime / 60) / baseInput.partsPerCycle;
    const mhrMin = machineRate / 60;
    const dlrMin = baseInput.directRate / 60;
    const expectedSetupCost = (mhrMin + dlrMin) * setupTimeMinPerPart;
    const expectedMachineCost = mhrMin * cycleTimeMinPerPart;
    const expectedLaborCost = dlrMin * cycleTimeMinPerPart;
    const expectedTotal = expectedSetupCost + expectedMachineCost + expectedLaborCost;

    expect(result.totalCostPerPart).toBeCloseTo(expectedTotal, 4);
  });

  it('setupManning=1/heads=1/scrap=0 behaves identically to the pre-fix formula (no regression for the common case)', () => {
    const result = engine.calculate(baseInput);
    const machineRate = baseInput.machineRate as number;
    const setupTimeHours = baseInput.setupTime / 60;
    const cycleTimePerPartHours = (baseInput.cycleTime / 3600) / baseInput.partsPerCycle;
    const legacySetupCostPerPart =
      (setupTimeHours * (machineRate + baseInput.directRate)) / baseInput.batchSize;
    const legacyCycleCostPerPart =
      baseInput.directRate * cycleTimePerPartHours + machineRate * cycleTimePerPartHours;
    const legacyTotal = legacySetupCostPerPart + legacyCycleCostPerPart;

    expect(result.totalCostPerPart).toBeCloseTo(legacyTotal, 4);
  });
});
