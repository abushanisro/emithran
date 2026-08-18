import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

export type ExchangeRateMap = Record<string, number>;

export function useExchangeRates() {
  return useQuery<ExchangeRateMap>({
    queryKey: ['exchange-rates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exchange_rates')
        .select('from_currency, rate')
        .eq('is_active', true)
        .eq('to_currency', 'INR');

      if (error) {
        throw new Error(`Exchange rates unavailable — failed to read exchange_rates: ${error.message}`);
      }

      // No hardcoded fallback table: a currency missing from exchange_rates
      // must read as "conversion unavailable for this currency" to the
      // caller, never a guessed FY-fixed number — see the identical rule in
      // backend ExchangeRateService.loadRates(). INR is 1 by definition
      // (every row is from_currency -> INR), not a guess.
      const rates: ExchangeRateMap = { INR: 1 };
      for (const row of data ?? []) {
        if (row.from_currency && Number(row.rate) > 0) {
          rates[row.from_currency.toUpperCase()] = Number(row.rate);
        }
      }

      return rates;
    },
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
