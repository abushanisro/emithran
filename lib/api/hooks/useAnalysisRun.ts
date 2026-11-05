import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { AnalysisRunResult } from '@/lib/analysis/analysis-status';

import { apiClient } from '../client';
import { analysisStatusKey } from './useAnalysisStatus';

/**
 * Makes the part's analysis current: the backend runs what its analysis status says is missing (CAD features, the drawing, the casting analysis)
 * and nothing else, so with everything current it does no work. It is the first step of Apply Scenario; nobody starts an analysis by hand.
 * The caller reads `status` of the result: that is the backend's answer, not something worked out here.
 */
export function useAnalysisRun(bomItemId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (): Promise<AnalysisRunResult> => {
      if (!bomItemId) throw new Error('The analysis run needs a BOM item id');
      // retry: false - a run is a long job; when the CAD engine is down the server answers 503 with the reason, and retrying would repeat the attempt.
      return apiClient.post<AnalysisRunResult>(`/bom-items/${bomItemId}/analysis-runs`, {}, { timeout: 150_000, retry: false });
    },
    onSuccess: (result) => {
      queryClient.setQueryData(analysisStatusKey(bomItemId), result.status);
      if (result.ran.length === 0) return; // nothing was redone: nothing derived from the analysis has changed
      // The run rewrote the feature graph (and maybe the drawing); the cost summary and route comparison are computed from it.
      for (const key of [
        ['bom-items', 'detail', bomItemId],
        ['bom-items', bomItemId, 'dfm-scores'],
        ['bom-items', bomItemId, 'cost-summary'],
        ['bom-items', bomItemId, 'route-comparison'],
        ...(result.ran.includes('drawing') ? [['bom-items', bomItemId, 'gdt-analysis']] : []),
      ]) void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
