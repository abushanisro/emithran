import { describe, expect, it } from 'vitest';

import { convertToInr, inrRatesFromUsdTable } from '@/lib/api/hooks/useExchangeRates';

/** Rows as GET /fx/exchange-rates returns them: 1 USD = rate CCY (migration 803). */
const row = (currency: string, rate: number) => ({
  currency,
  name: null,
  rate,
  effectiveDate: '2026-10-01',
  editedBy: null,
  editReason: null,
  sourceActive: true,
  sourceModifiedBy: null,
  sourceModifiedAt: null,
  updatedAt: '2026-10-01T00:00:00Z',
});

describe('inrRatesFromUsdTable', () => {
  it('gives INR per USD from the USD-quoted table, as the old direct read did', () => {
    expect(inrRatesFromUsdTable([row('INR', 83.5), row('EUR', 0.92)])).toEqual({ INR: 1, USD: 83.5 });
  });

  it('does not derive other currencies, which would change saved material costs (owner decision pending)', () => {
    expect(inrRatesFromUsdTable([row('INR', 84), row('EUR', 0.92)]).EUR).toBeUndefined();
  });

  it('converts nothing when there is no usable INR rate, rather than guessing', () => {
    expect(inrRatesFromUsdTable([row('EUR', 0.92)])).toEqual({ INR: 1 });
    expect(inrRatesFromUsdTable([row('INR', 0)])).toEqual({ INR: 1 });
  });
});

describe('convertToInr', () => {
  it('converts USD with the table rate and leaves INR and unknown currencies alone', () => {
    const rates = inrRatesFromUsdTable([row('INR', 84)]);
    expect(convertToInr(10, 'usd', rates)).toBe(840);
    expect(convertToInr(10, 'INR', rates)).toBe(10);
    expect(convertToInr(10, 'EUR', rates)).toBe(10);
  });
});
