import { UnprocessableEntityException } from '@nestjs/common';
import { FxService } from '../../../common/fx/fx.service';

// Mirrors the REAL RateSnapshot's INR-pivot math (exchange-rate.service.ts's
// makeSnapshot) rather than stubbing convertStrict to a constant — these
// tests exist specifically to prove the pivot arithmetic FxService relies on
// for Budget rates, so the fake must compute it the same way production does.
function makeRateSnapshot(inrPerUnit: Record<string, number>) {
  const rates = new Map(Object.entries({ INR: 1, ...inrPerUnit }));
  const convertOptional = (from: string, to: string): number | null => {
    if (from === to) return 1;
    const f = rates.get(from);
    const t = rates.get(to);
    if (f == null || t == null) return null;
    return f / t;
  };
  const convertStrict = (from: string, to: string): number => {
    const r = convertOptional(from, to);
    if (r == null) throw new Error(`No exchange rate on file for '${from}' → '${to}'`);
    return r;
  };
  return { convertOptional, convertStrict, toUsd: (amount: number, from: string) => amount * convertStrict(from, 'USD') };
}

function makeFakeExchangeRateService(inrPerUnit: Record<string, number>) {
  const rateMap = new Map(Object.entries({ INR: 1, ...inrPerUnit }));
  return {
    getSnapshot: jest.fn(async () => makeRateSnapshot(inrPerUnit)),
    hasRate: (currency: string) => rateMap.has(currency.toUpperCase()),
  } as any;
}

function makeFakeFxRateCacheService() {
  return { getCachedOrFetch: jest.fn(), refresh: jest.fn() } as any;
}

describe('FxService — budget rate type', () => {
  // All six LOCATION_INFO currencies + a couple more, INR-anchored — matches
  // what migrations 150 + 178 actually seed into exchange_rates.
  const SEEDED = { USD: 83.5, EUR: 89.0, GBP: 104.0, CNY: 11.52, MXN: 4.77 };

  it('INR → USD', async () => {
    const svc = new FxService(makeFakeFxRateCacheService(), makeFakeExchangeRateService(SEEDED));
    const result = await svc.getRate({ base: 'INR', quote: 'USD', rateType: 'budget', accessToken: null });
    expect(result.rate).toBeCloseTo(1 / 83.5, 6);
    expect(result.rateType).toBe('budget');
  });

  it('EUR → USD — neither side is the INR anchor, so this is a cross-rate too', async () => {
    const svc = new FxService(makeFakeFxRateCacheService(), makeFakeExchangeRateService(SEEDED));
    const result = await svc.getRate({ base: 'EUR', quote: 'USD', rateType: 'budget', accessToken: null });
    expect(result.rate).toBeCloseTo(89.0 / 83.5, 6);
    expect(result.source).toContain('cross-rate');
  });

  it('INR → USD is a direct lookup, not a cross-rate (INR is the pivot itself)', async () => {
    const svc = new FxService(makeFakeFxRateCacheService(), makeFakeExchangeRateService(SEEDED));
    const result = await svc.getRate({ base: 'INR', quote: 'USD', rateType: 'budget', accessToken: null });
    expect(result.source).toBe('exchange_rates (admin-set budget rate)');
  });

  it('CNY → USD', async () => {
    const svc = new FxService(makeFakeFxRateCacheService(), makeFakeExchangeRateService(SEEDED));
    const result = await svc.getRate({ base: 'CNY', quote: 'USD', rateType: 'budget', accessToken: null });
    expect(result.rate).toBeCloseTo(11.52 / 83.5, 6);
  });

  it('USD → USD — identity, never queries the rate table, rate type stays budget', async () => {
    const exchangeRateService = makeFakeExchangeRateService(SEEDED);
    const svc = new FxService(makeFakeFxRateCacheService(), exchangeRateService);
    const result = await svc.getRate({ base: 'USD', quote: 'USD', rateType: 'budget', accessToken: null });
    expect(result.rate).toBe(1);
    expect(result.rateType).toBe('budget');
    expect(exchangeRateService.getSnapshot).not.toHaveBeenCalled();
  });

  it('cross-rate derivation: EUR → GBP, neither side is INR or USD', async () => {
    const svc = new FxService(makeFakeFxRateCacheService(), makeFakeExchangeRateService(SEEDED));
    const result = await svc.getRate({ base: 'EUR', quote: 'GBP', rateType: 'budget', accessToken: null });
    expect(result.rate).toBeCloseTo(89.0 / 104.0, 6);
    expect(result.source).toContain('cross-rate');
    expect(result.source).toContain('EUR→INR');
    expect(result.source).toContain('GBP→INR');
  });

  it('unsupported pair — fails clearly, names the missing currency, never substitutes another rate type', async () => {
    const fxRateCacheService = makeFakeFxRateCacheService();
    // MXN seeded, JPY is not.
    const svc = new FxService(fxRateCacheService, makeFakeExchangeRateService({ MXN: 4.77 }));
    await expect(
      svc.getRate({ base: 'JPY', quote: 'MXN', rateType: 'budget', accessToken: null }),
    ).rejects.toThrow(UnprocessableEntityException);
    await expect(
      svc.getRate({ base: 'JPY', quote: 'MXN', rateType: 'budget', accessToken: null }),
    ).rejects.toThrow(/JPY/);
    // Confirms the failure is not silently papered over by falling back to
    // the reference-rate cache — the whole point of "never substitute".
    expect(fxRateCacheService.getCachedOrFetch).not.toHaveBeenCalled();
  });

  it('budget selection never falls through to reference for a supported pair either', async () => {
    const fxRateCacheService = makeFakeFxRateCacheService();
    const svc = new FxService(fxRateCacheService, makeFakeExchangeRateService(SEEDED));
    await svc.getRate({ base: 'EUR', quote: 'USD', rateType: 'budget', accessToken: null });
    expect(fxRateCacheService.getCachedOrFetch).not.toHaveBeenCalled();
  });
});

describe('FxService — resolveFactoryCurrency', () => {
  it('resolves every Digital Factory location to its LOCATION_INFO currency', async () => {
    const svc = new FxService(makeFakeFxRateCacheService(), makeFakeExchangeRateService({}));
    expect(svc.resolveFactoryCurrency('India')).toEqual({ code: 'INR', symbol: '₹' });
    expect(svc.resolveFactoryCurrency('USA')).toEqual({ code: 'USD', symbol: '$' });
    expect(svc.resolveFactoryCurrency('Germany')).toEqual({ code: 'EUR', symbol: '€' });
    expect(svc.resolveFactoryCurrency('China')).toEqual({ code: 'CNY', symbol: '¥' });
    expect(svc.resolveFactoryCurrency('Mexico')).toEqual({ code: 'MXN', symbol: 'MX$' });
    expect(svc.resolveFactoryCurrency('UK')).toEqual({ code: 'GBP', symbol: '£' });
    expect(svc.resolveFactoryCurrency('Nowhereland')).toEqual({ code: 'USD', symbol: '$' });
  });
});

describe('FxService — listFactories / listCurrencies', () => {
  it('lists every Digital Factory location with its native currency, sourced from LOCATION_INFO', () => {
    const svc = new FxService(makeFakeFxRateCacheService(), makeFakeExchangeRateService({}));
    const factories = svc.listFactories();
    expect(factories).toContainEqual({ location: 'India', code: 'INR', symbol: '₹' });
    expect(factories).toContainEqual({ location: 'UK', code: 'GBP', symbol: '£' });
    expect(factories).toContainEqual({ location: 'Vietnam', code: 'USD', symbol: '$' });
  });

  it('lists each distinct scenario currency exactly once, with a display name', () => {
    const svc = new FxService(makeFakeFxRateCacheService(), makeFakeExchangeRateService({}));
    const currencies = svc.listCurrencies();
    const codes = currencies.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length); // no duplicates across the many locations sharing EUR/USD
    expect(currencies).toContainEqual({ code: 'INR', symbol: '₹', name: 'Indian Rupee' });
    expect(currencies).toContainEqual({ code: 'EUR', symbol: '€', name: 'Euro' });
  });
});

describe('FxService — custom rate type', () => {
  it('requires a positive rate and a reason, never derives a value itself', async () => {
    const svc = new FxService(makeFakeFxRateCacheService(), makeFakeExchangeRateService({}));
    await expect(
      svc.getRate({ base: 'EUR', quote: 'USD', rateType: 'custom', accessToken: null }),
    ).rejects.toThrow(UnprocessableEntityException);
    await expect(
      svc.getRate({ base: 'EUR', quote: 'USD', rateType: 'custom', accessToken: null, customRate: 1.1 }),
    ).rejects.toThrow(/reason/i);
    const result = await svc.getRate({
      base: 'EUR', quote: 'USD', rateType: 'custom', accessToken: null,
      customRate: 1.1, customReason: 'Contract-locked rate for Q3 quote',
    });
    expect(result.rate).toBe(1.1);
    expect(result.customReason).toBe('Contract-locked rate for Q3 quote');
  });
});
