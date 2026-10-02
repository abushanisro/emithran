import { UnprocessableEntityException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { FxService } from '../../../common/fx/fx.service';
import { ExchangeRateService } from '../../../common/exchange-rate/exchange-rate.service';

// The real reference exchange rate table (memory/exchange_rate_table.csv) --
// the same rows migration 803 stores -- served to the REAL ExchangeRateService
// through a stand-in for the one Supabase query it makes, so these tests
// exercise the production USD-anchor arithmetic and name mapping, not a copy.
const REFERENCE_CSV = join(__dirname, '../../../../../memory/exchange_rate_table.csv');

interface ReferenceRow { to_currency: string; rate: number; currency_name: string }

function readReferenceRows(): ReferenceRow[] {
  const [header, ...lines] = readFileSync(REFERENCE_CSV, 'utf-8').trim().split(/\r?\n/);
  const cols = header.split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    const get = (name: string) => cells[cols.indexOf(name)];
    return { to_currency: get('currencyCode'), rate: Number(get('rate')), currency_name: get('description') };
  });
}

const REFERENCE = readReferenceRows();
const refRate = (code: string) => REFERENCE.find((r) => r.to_currency === code)!.rate; // 1 USD = refRate CCY

function makeExchangeRateService(rows: ReferenceRow[] = REFERENCE): ExchangeRateService {
  const query: any = {
    select: () => query,
    eq: () => query,
    then: (resolve: (v: { data: ReferenceRow[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
  };
  const supabaseService = { getUserClient: () => ({ from: () => query }) } as any;
  return new ExchangeRateService(supabaseService);
}

function makeFakeFxRateCacheService() {
  return { getCachedOrFetch: jest.fn(), refresh: jest.fn() } as any;
}

describe('FxService — budget rate type (reference exchange rate table, USD anchor)', () => {
  it('the reference table is what the test reads: 11 USD-quoted currencies', () => {
    expect(REFERENCE).toHaveLength(11);
    expect(REFERENCE.map((r) => r.to_currency)).toEqual(
      expect.arrayContaining(['INR', 'EUR', 'GBP', 'CNY', 'MXN']),
    );
  });

  it('USD → INR is the stored rate itself (direct, not a cross-rate)', async () => {
    const svc = new FxService(makeFakeFxRateCacheService(), makeExchangeRateService());
    const result = await svc.getRate({ base: 'USD', quote: 'INR', rateType: 'budget', accessToken: null });
    expect(result.rate).toBeCloseTo(refRate('INR'), 6);
    expect(result.rateType).toBe('budget');
    expect(result.source).toBe('exchange_rates (budget rate)');
  });

  it('INR → USD is the inverse of the stored rate', async () => {
    const svc = new FxService(makeFakeFxRateCacheService(), makeExchangeRateService());
    const result = await svc.getRate({ base: 'INR', quote: 'USD', rateType: 'budget', accessToken: null });
    expect(result.rate).toBeCloseTo(1 / refRate('INR'), 9);
  });

  it('EUR → GBP — neither side is the USD anchor, so it is a cross-rate through USD', async () => {
    const svc = new FxService(makeFakeFxRateCacheService(), makeExchangeRateService());
    const result = await svc.getRate({ base: 'EUR', quote: 'GBP', rateType: 'budget', accessToken: null });
    // 1 EUR = (1/EUR_per_USD) USD = GBP_per_USD/EUR_per_USD GBP
    expect(result.rate).toBeCloseTo(refRate('GBP') / refRate('EUR'), 9);
    expect(result.source).toContain('cross-rate');
    expect(result.source).toContain('USD→EUR');
    expect(result.source).toContain('USD→GBP');
  });

  it('INR → MXN — two factory currencies, derived from their own reference rows', async () => {
    const svc = new FxService(makeFakeFxRateCacheService(), makeExchangeRateService());
    const result = await svc.getRate({ base: 'INR', quote: 'MXN', rateType: 'budget', accessToken: null });
    expect(result.rate).toBeCloseTo(refRate('MXN') / refRate('INR'), 9);
  });

  it('USD → USD — identity, never queries the rate table, rate type stays budget', async () => {
    const exchangeRateService = makeExchangeRateService();
    const getSnapshot = jest.spyOn(exchangeRateService, 'getSnapshot');
    const svc = new FxService(makeFakeFxRateCacheService(), exchangeRateService);
    const result = await svc.getRate({ base: 'USD', quote: 'USD', rateType: 'budget', accessToken: null });
    expect(result.rate).toBe(1);
    expect(result.rateType).toBe('budget');
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it('a currency not in the table fails clearly, names it, never substitutes another rate type', async () => {
    const fxRateCacheService = makeFakeFxRateCacheService();
    const svc = new FxService(fxRateCacheService, makeExchangeRateService());
    // VND was in the old hand-written seed; it is not in the reference table.
    await expect(
      svc.getRate({ base: 'VND', quote: 'EUR', rateType: 'budget', accessToken: null }),
    ).rejects.toThrow(UnprocessableEntityException);
    await expect(
      svc.getRate({ base: 'VND', quote: 'EUR', rateType: 'budget', accessToken: null }),
    ).rejects.toThrow(/VND/);
    expect(fxRateCacheService.getCachedOrFetch).not.toHaveBeenCalled();
  });

  it('budget selection never falls through to reference for a supported pair either', async () => {
    const fxRateCacheService = makeFakeFxRateCacheService();
    const svc = new FxService(fxRateCacheService, makeExchangeRateService());
    await svc.getRate({ base: 'EUR', quote: 'USD', rateType: 'budget', accessToken: null });
    expect(fxRateCacheService.getCachedOrFetch).not.toHaveBeenCalled();
  });
});

describe('FxService — factory currency', () => {
  it('resolves every Digital Factory location to its LOCATION_INFO currency', async () => {
    const svc = new FxService(makeFakeFxRateCacheService(), makeExchangeRateService());
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
    const svc = new FxService(makeFakeFxRateCacheService(), makeExchangeRateService());
    const factories = svc.listFactories();
    expect(factories).toContainEqual({ location: 'India', code: 'INR', symbol: '₹' });
    expect(factories).toContainEqual({ location: 'UK', code: 'GBP', symbol: '£' });
    expect(factories).toContainEqual({ location: 'Vietnam', code: 'USD', symbol: '$' });
  });

  it('lists every currency in the exchange rate table plus the USD anchor, names from the table', async () => {
    const svc = new FxService(makeFakeFxRateCacheService(), makeExchangeRateService());
    const currencies = await svc.listCurrencies(null);
    const codes = currencies.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toHaveLength(REFERENCE.length + 1);
    // factory currency: LOCATION_INFO symbol, reference-table name
    expect(currencies).toContainEqual({ code: 'INR', symbol: '₹', name: 'Indian Rupee' });
    expect(currencies).toContainEqual({ code: 'MXN', symbol: 'MX$', name: 'Mexican Peso' });
    expect(currencies).toContainEqual({ code: 'CNY', symbol: '¥', name: 'Chinese Renminbi Yuan' });
    // non-factory currency: ISO symbol from the runtime, reference-table name
    expect(currencies).toContainEqual({ code: 'KRW', symbol: '₩', name: 'South Korean Won' });
    // the anchor has no row of its own: ISO display name
    expect(currencies).toContainEqual({ code: 'USD', symbol: '$', name: 'US Dollar' });
  });
});

describe('FxService — custom rate type', () => {
  it('requires a positive rate and a reason, never derives a value itself', async () => {
    const svc = new FxService(makeFakeFxRateCacheService(), makeExchangeRateService());
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
