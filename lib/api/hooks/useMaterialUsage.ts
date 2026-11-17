import { useQuery } from '@tanstack/react-query';

import { apiClient } from '../client';

import { useAuthEnabledWith } from './useAuthEnabled';
import type { CalculationTraceStep } from './useBOMItems';

/** How one usage figure was reached: the reference calculator that ran or the rule, and every value it read (inputs first, the result last). */
export interface UsageJustification {
  title: string;
  calculatorId: string | null;
  calculatorVersion: number | null;
  trace: CalculationTraceStep[];
  /** A stated allowance, not a result of the engine. */
  estimate: boolean;
}

export type MaterialUsageSource = 'sheet_nesting' | 'stock_blank' | 'casting_charge' | 'molding_allowance' | 'scrap_allowance_fallback' | 'none';

/** The part's material usage as Apply records it (backend costing/shared/material-usage-explanation.ts), in kg and %. */
export interface MaterialUsageExplanation {
  netUsage: number;
  grossUsage: number;
  scrapPct: number;
  source: MaterialUsageSource;
  net: UsageJustification;
  gross: UsageJustification;
  scrap: UsageJustification;
}

/**
 * Under the cost-summary prefix on purpose: the usage is read from the cost summary, so whatever invalidates the summary (a new material, an Apply, a
 * re-analysis) must refetch it too.
 */
export function materialUsageQueryKey(itemId: string | undefined, batchSize: number | undefined, location: string) {
  return ['bom-items', itemId, 'cost-summary', 'material-usage', batchSize, location] as const;
}

export function materialUsageUrl(itemId: string, batchSize: number | undefined, location: string): string {
  const params = new URLSearchParams({ location });
  if (batchSize !== undefined) params.set('batchSize', String(batchSize));
  return `/bom-items/${itemId}/material-usage?${params.toString()}`;
}

/** The engine's net and gross usage of a part with the working behind them; fetched only while `enabled` (the material dialog is open). */
export function useMaterialUsage(itemId: string | undefined, batchSize: number | undefined, location: string | undefined, enabled = true) {
  return useQuery({
    queryKey: materialUsageQueryKey(itemId, batchSize, location ?? ''),
    // The server costs the part to answer (the same computation as the cost summary), so the timeout and the no-retry rule are the summary's.
    queryFn: () => apiClient.get<MaterialUsageExplanation>(materialUsageUrl(itemId ?? '', batchSize, location ?? ''), { timeout: 180000 }),
    enabled: useAuthEnabledWith(enabled && !!itemId && !!location),
    staleTime: 1000 * 60 * 5,
    retry: false,
  });
}
