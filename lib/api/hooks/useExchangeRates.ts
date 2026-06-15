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

      const rates: ExchangeRateMap = { INR: 1 };

      if (!error) {
        for (const row of data ?? []) {
          if (row.from_currency && Number(row.rate) > 0) {
            rates[row.from_currency.toUpperCase()] = Number(row.rate);
          }
        }
      }

      // FY2026-27 fallback defaults — matches ExchangeRateService.applyDefaults()
      if (Object.keys(rates).length === 1) {
        rates.USD = 83.50;
        rates.EUR = 89.00;
        rates.GBP = 104.00;
        rates.AED = 22.75;
        rates.SGD = 61.50;
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
