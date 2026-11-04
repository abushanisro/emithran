import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import type { AnalysisStatus } from '@/lib/analysis/analysis-status';
import { requestFailure } from '@/lib/casting/analysis-view';

import { apiClient } from '../client';
import { analysisStatusKey } from './useAnalysisStatus';
import { useRequestCastingAnalysis } from './useCastingAnalyses';

/**
 * "Refresh Analysis": one action that runs every analysis the part needs. The CAD features come first (they decide the part family); the 2D
 * drawing is read when there is a PDF; then, when the backend says the part also needs its casting analysis (a sand-cast part), that is
 * requested. Nothing is asked twice: the backend reuses an analysis that already exists.
 */
export function useRefreshAnalysis(bomItemId: string | undefined, file2dPath: string | undefined) {
  const queryClient = useQueryClient();
  const requestCasting = useRequestCastingAnalysis(bomItemId);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async (): Promise<boolean> => {
    if (!bomItemId || refreshing) return false;
    setRefreshing(true);
    try {
      // retry: false — a re-analysis is a long, non-idempotent job; when the CAD engine is down the server answers 503 with the reason,
      // and retrying would only repeat the whole attempt before showing it.
      await apiClient.post(`/bom-items/${bomItemId}/reanalyze`, {}, { timeout: 150_000, retry: false });
      // The drawing's title block, thread callouts and tolerances (vector PDF only). A drawing failure never undoes the geometry refresh.
      if (file2dPath?.toLowerCase().endsWith('.pdf')) {
        try {
          await apiClient.post(`/bom-items/${bomItemId}/drawing-analyses`, {}, { timeout: 60_000 });
          // gdt-analysis reads drawing_intelligence directly; without this a re-parsed drawing kept showing the old GD&T result.
          void queryClient.invalidateQueries({ queryKey: ['bom-items', bomItemId, 'gdt-analysis'] });
        } catch (e: unknown) {
          toast.error(`Drawing analysis failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
      }
      // What else the part needs is the backend's call, from the family the analysis just found.
      const status = await apiClient.get<AnalysisStatus>(`/bom-items/${bomItemId}/analysis-status`);
      if (status.missing.includes('casting_analysis') && (status.casting === 'none' || status.casting === 'failed')) {
        // A refused request (no worker, no file) says why and leaves the geometry refresh standing: Apply stays locked until it is retried.
        try {
          await requestCasting.mutateAsync();
        } catch (e: unknown) {
          toast.error(requestFailure(e));
        }
      }
      // Reanalyze rewrites the feature graph; the cost summary and route comparison are separate queries computed from it, and would keep
      // showing the old numbers until a reload without these.
      void queryClient.invalidateQueries({ queryKey: ['bom-items', 'detail', bomItemId] });
      void queryClient.invalidateQueries({ queryKey: ['bom-items', bomItemId, 'dfm-scores'] });
      void queryClient.invalidateQueries({ queryKey: ['bom-items', bomItemId, 'cost-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['bom-items', bomItemId, 'route-comparison'] });
      void queryClient.invalidateQueries({ queryKey: analysisStatusKey(bomItemId) });
      toast.success('Analysis refreshed');
      return true;
    } catch (e: unknown) {
      toast.error(`Refresh failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
      return false;
    } finally {
      setRefreshing(false);
    }
  };

  return { refresh, refreshing };
}
