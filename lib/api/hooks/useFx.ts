import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';
import { useAuthEnabledWith } from './useAuthEnabled';

export interface FactoryCurrencyInfo {
  code: string;
  symbol: string;
}

export interface FactoryLocationInfo {
  location: string;
  code: string;
  symbol: string;
}

export interface CurrencyInfo {
  code: string;
  symbol: string;
  name: string;
}

export type FxRateType = 'reference' | 'budget' | 'custom';

export interface FxRateResult {
  rate: number;
  base: string;
  quote: string;
  rateType: FxRateType;
  provider: string | null;
  source: string | null;
  /** YYYY-MM-DD the rate is FOR, when the source supplies one (null for budget/custom). */
  rateDate: string | null;
  retrievedAt: string;
  stale: boolean;
  customReason?: string;
}

/** Digital Factory location → ISO 4217 currency + symbol. Backed by LOCATION_INFO — never inferred client-side. */
export function useFactoryCurrency(location: string | undefined) {
  return useQuery({
    queryKey: ['fx', 'factory-currency', location],
    queryFn: () => apiClient.get<FactoryCurrencyInfo>(`/fx/factory-currency?location=${encodeURIComponent(location!)}`),
    enabled: useAuthEnabledWith(!!location),
    staleTime: Infinity, // LOCATION_INFO is a static map — never changes at runtime
  });
}

/** Every Digital Factory location the backend knows about — backs the location picker, never a hardcoded option list. */
export function useFactories() {
  return useQuery({
    queryKey: ['fx', 'factories'],
    queryFn: () => apiClient.get<FactoryLocationInfo[]>('/fx/factories'),
    enabled: useAuthEnabledWith(true),
    staleTime: Infinity, // LOCATION_INFO is a static map — never changes at runtime
  });
}

/** Every scenario currency the backend can resolve/convert — backs the Currency & Ask Price picker, never a hardcoded option list. */
export function useCurrencies() {
  return useQuery({
    queryKey: ['fx', 'currencies'],
    queryFn: () => apiClient.get<CurrencyInfo[]>('/fx/currencies'),
    enabled: useAuthEnabledWith(true),
    staleTime: Infinity, // derived from the same static LOCATION_INFO map
  });
}

/**
 * The resolved FX rate for one (base, quote, rateType) — drives the Currency
 * & Ask Price widget's "Exchange Rate" display. For rateType='custom', the
 * caller doesn't need this hook at all (the value is entered directly, see
 * the widget) — pass enabled:false to skip the network round trip.
 */
export function useFxRate(params: {
  base: string | undefined;
  quote: string | undefined;
  rateType: FxRateType;
  enabled?: boolean;
}) {
  const { base, quote, rateType, enabled = true } = params;
  return useQuery({
    queryKey: ['fx', 'rate', base, quote, rateType],
    queryFn: () =>
      apiClient.get<FxRateResult>(
        `/fx/rate?base=${encodeURIComponent(base!)}&quote=${encodeURIComponent(quote!)}&rateType=${rateType}`,
      ),
    enabled: useAuthEnabledWith(!!base && !!quote && enabled),
    staleTime: 60 * 1000,
  });
}

/**
 * Live USD->quote reference rates for a distinct set of currency codes in one
 * call — e.g. a table with many rows spanning a handful of currencies, where
 * calling useFxRate once per row would violate the rules of hooks (a
 * variable-length hook call per row) and one useFxRate per distinct code
 * would too (the set of codes changes as data loads). Uses the exact same
 * queryKey/queryFn shape as useFxRate so cache entries are shared, not
 * duplicated. Returns a plain {code: rate} map (USD always 1) to look up
 * during render or inside a plain event handler — never a hardcoded number.
 */
export function useFxRatesForCurrencies(codes: string[]): Record<string, number | undefined> {
  const authEnabled = useAuthEnabledWith(true);
  const distinctCodes = Array.from(new Set(codes.filter((c) => c && c !== 'USD')));
  const results = useQueries({
    queries: distinctCodes.map((quote) => ({
      queryKey: ['fx', 'rate', 'USD', quote, 'reference'] as const,
      // silent: true — the reference provider (Frankfurter/ECB) simply
      // doesn't cover every currency (e.g. VND); that's a real, expected "no
      // rate available" outcome for this specific pair, not an
      // infrastructure failure worth retrying or surfacing as a query error.
      // Callers already treat a missing entry in the returned map as "rate
      // unknown" (see mhrCurrencyOf's `?? 1` loading/unavailable fallback).
      queryFn: () =>
        apiClient.get<FxRateResult>(`/fx/rate?base=USD&quote=${encodeURIComponent(quote)}&rateType=reference`, { silent: true }),
      enabled: authEnabled,
      retry: false,
      throwOnError: false,
      staleTime: 60 * 1000,
    })),
  });
  const map: Record<string, number | undefined> = { USD: 1 };
  distinctCodes.forEach((code, i) => {
    map[code] = results[i]?.data?.rate;
  });
  return map;
}

/** Forces a live reference-provider fetch for (base, quote) — backs the explicit "Refresh FX" button. */
export function useRefreshFxRate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ base, quote }: { base: string; quote: string }) =>
      apiClient.post<FxRateResult>('/fx/refresh', { base, quote }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['fx', 'rate', variables.base, variables.quote] });
    },
  });
}

/**
 * One-off, imperative reference-rate fetch for an arbitrary pair — used only
 * to convert an already-entered Ask Price when the user changes Scenario
 * Currency (old-currency → new-currency isn't necessarily the factory→
 * scenario pair useFxRate tracks). A mutation, not a query: this is a single
 * user-triggered "Convert now" action, not a value the UI reactively displays.
 */
export function useFxRateOnDemand() {
  return useMutation({
    mutationFn: ({ base, quote }: { base: string; quote: string }) =>
      apiClient.get<FxRateResult>(
        `/fx/rate?base=${encodeURIComponent(base)}&quote=${encodeURIComponent(quote)}&rateType=reference`,
      ),
  });
}
