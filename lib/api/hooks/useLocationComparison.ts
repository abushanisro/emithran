import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../client';

export interface LocationProcessLine {
  operation: string;
  processGroup: string;
  mhrUsd: number;
  lhrUsd: number;
  setupCostUsd: number;
  cycleCostUsd: number;
  totalCostUsd: number;
}

export interface LocationCostEntry {
  location: string;
  currency: string;
  currencySymbol: string;
  avgMhrUsd: number;
  avgLhrUsd: number;
  machineCostUsd: number;
  labourCostUsd: number;
  processCostUsd: number;
  processCostLocal: number;
  rawMaterialCostUsd: number;
  totalMfgCostUsd: number;
  sgaCostUsd: number;
  sellingPriceUsd: number;
  vsCurrentPct: number;
  ratesSource: 'db' | 'default' | 'mixed';
  processLines: LocationProcessLine[];
}

export interface LocationComparisonData {
  bomItemId: string;
  currentLocation: string;
  processLinesCount: number;
  locations: LocationCostEntry[];
  cheapestLocation: string;
  mostExpensiveLocation: string;
}

export function useLocationComparison(bomItemId?: string) {
  return useQuery<LocationComparisonData>({
    queryKey: ['location-comparison', bomItemId],
    queryFn: () =>
      apiClient.get<LocationComparisonData>(
        `/cost-analysis/bom-item/${bomItemId}/location-comparison`,
      ),
    enabled: !!bomItemId,
    staleTime: 60_000,
    retry: 1,
  });
}
