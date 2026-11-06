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
