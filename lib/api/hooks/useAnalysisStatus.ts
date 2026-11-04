import { useQuery } from '@tanstack/react-query';

import type { AnalysisStatus } from '@/lib/analysis/analysis-status';

import { apiClient } from '../client';

const POLL_MS = 3000;

export const analysisStatusKey = (bomItemId: string | undefined) => ['bom-items', bomItemId, 'analysis-status'] as const;

/** Whether the part's required analyses are finished and current. Polled only while the casting analysis runs, so Apply unlocks when it ends. */
export function useAnalysisStatus(bomItemId: string | undefined) {
  return useQuery({
    queryKey: analysisStatusKey(bomItemId),
    queryFn: () => {
      if (!bomItemId) throw new Error('The analysis status needs a BOM item id');
      return apiClient.get<AnalysisStatus>(`/bom-items/${bomItemId}/analysis-status`);
    },
    enabled: !!bomItemId,
    refetchInterval: (q) => (q.state.data?.casting === 'running' ? POLL_MS : false),
    refetchOnWindowFocus: false,
  });
}
