import { routeToolingItems } from '../../../../../modules/bom-items/costing/shared/route-tooling';

const mold = { moldClass: 'Class104', moldLifeShotRating: 100000, moldCostUsd: 9808.59, moldCostPerPartUsd: 1.9617, annualVolume: 1000, productionLifeYears: 5, moldsRequired: 1, moldToolLifeShots: 144000, moldBomSubtotalUsd: 4180 };

describe('routeToolingItems', () => {
  it('the injection mold is one tool: the whole investment spread over annual volume x production life', () => {
    const [m] = routeToolingItems({ family: 'plastic_molded', tooling: mold } as never);
    expect(m).toMatchObject({ key: 'mold', investmentUsd: 9808.59, amortizationParts: 5000, description: 'Injection mold (SPI Class104)' });
    expect(m!.investmentUsd / m!.amortizationParts).toBeCloseTo(mold.moldCostPerPartUsd, 3); // the per-part figure the engine reports
  });

  it('a route with no priced tooling has none', () => {
    expect(routeToolingItems({ family: 'plastic_molded' } as never)).toEqual([]);
    expect(routeToolingItems({ family: 'plastic_molded', tooling: { ...mold, moldCostUsd: 0 } } as never)).toEqual([]);
  });

  it('a mold with no volume to spread over is not written: the engine already says it cannot size it', () => {
    expect(routeToolingItems({ family: 'plastic_molded', tooling: { ...mold, annualVolume: 0 } } as never)).toEqual([]);
  });
});

describe('routeToolingItems: casting', () => {
  const die = { ok: true, complexity: 'Average', diesRequired: 2, dieSizeMm: [400, 300, 250.4], shotsPerDie: 100000, dieCostUsd: 21000, totalToolingUsd: 42000, perPartUsd: 0.84 };

  it('the die is one investment spread over the parts its per-part cost implies', () => {
    const [d] = routeToolingItems({ family: 'die_casting', dieTooling: die } as never);
    expect(d).toMatchObject({ key: 'die', description: 'Die casting die (Average)', investmentUsd: 42000, amortizationParts: 50000 });
    expect(d!.investmentUsd / d!.amortizationParts).toBeCloseTo(0.84, 4);
  });

  it('the coreboxes are a tool of their own, for die and sand casting alike', () => {
    const items = routeToolingItems({ family: 'die_casting', dieTooling: die, coreboxTooling: { boxes: 2, costUsd: 3000, perPartUsd: 0.06, detail: 'core 1: sand, 2 boxes' } } as never);
    expect(items.map((i) => i.key)).toEqual(['die', 'corebox']);
    expect(items[1]).toMatchObject({ investmentUsd: 3000, amortizationParts: 50000 });
  });

  it('a die that could not be priced, or amortised, is not written', () => {
    expect(routeToolingItems({ family: 'die_casting', dieTooling: { ...die, ok: false } } as never)).toEqual([]);
    expect(routeToolingItems({ family: 'die_casting', dieTooling: { ...die, perPartUsd: null } } as never)).toEqual([]);
  });

  it('a tool too cheap per part to recover a reliable count from is not written (rounding would change its amortisation by more than 0.1%)', () => {
    expect(routeToolingItems({ family: 'die_casting', dieTooling: { ...die, perPartUsd: 0.0123 } } as never)).toEqual([]);
  });
});
