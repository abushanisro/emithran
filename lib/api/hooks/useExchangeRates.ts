import { useQuery } from '@tanstack/react-query';

import { apiClient } from '../client';

import type { ExchangeRateRow } from './useFx';

export type ExchangeRateMap = Record<string, number>;

/**
 * INR per one unit of each currency, from the budget table the backend serves (GET /fx/exchange-rates, quoted as 1 USD = rate CCY
 * since migration 803). No hardcoded fallback table: a currency with no rate must read as "conversion unavailable" to the caller, never
 * a guessed number — the same rule as the backend ExchangeRateService.
 *
 * Only USD is converted. That is exactly what the old direct read of exchange_rates (to_currency = 'INR') could find after migration
 * 803 deleted every other row, and material costs priced in this dialog are saved, so other currencies are not derived here until the
 * owner approves that change to costing results.
 */
export function inrRatesFromUsdTable(rows: readonly ExchangeRateRow[]): ExchangeRateMap {
  const inrPerUsd = rows.find((row) => row.currency.toUpperCase() === 'INR')?.rate;
  return inrPerUsd && inrPerUsd > 0 ? { INR: 1, USD: inrPerUsd } : { INR: 1 };
}

export function useExchangeRates() {
  return useQuery({
    // Same key and source as useFx's table query, so editing a rate refreshes this too.
    queryKey: ['fx', 'exchange-rates'],
    queryFn: () => apiClient.get<ExchangeRateRow[]>('/fx/exchange-rates'),
    select: inrRatesFromUsdTable,
    staleTime: 5 * 60 * 1000, // 5-minute TTL — matches backend cache
  });
}

export function convertToInr(
  amount: number,
  fromCurrency: string | null | undefined,
  rates: ExchangeRateMap,
): number {
  if (!fromCurrency || fromCurrency.toUpperCase() === 'INR') return amount;
  const rate = rates[fromCurrency.toUpperCase()];
  return rate ? amount * rate : amount;
}
