/**
 * React Query hooks for a part's casting analysis. The list is polled only while the newest analysis is queued or running; when one finishes, the
 * part's cost summary is read again, because the route is then measured by it.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { isInFlight, isReady } from '@/lib/casting/analysis-view';

import { castingAnalysesApi, type CastingAnalysisSummary } from '../casting-analyses';

const keys = {
  forItem: (bomItemId: string) => ['casting-analyses', 'item', bomItemId] as const,
};

const POLL_MS = 3000;

/** A query or mutation only runs when its id is present; this keeps the type honest without an assertion. */
function required(id: string | undefined): string {
  if (!id) throw new Error('This needs a BOM item id');
  return id;
}

export function useCastingAnalyses(bomItemId: string | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: keys.forItem(bomItemId ?? 'none'),
    queryFn: () => castingAnalysesApi.list(required(bomItemId)),
    enabled: !!bomItemId,
    refetchInterval: (q) => {
      const newest: CastingAnalysisSummary | undefined = q.state.data?.[0];
      return newest && isInFlight(newest.status) ? POLL_MS : false;
    },
    refetchOnWindowFocus: false,
  });

  // A finished analysis changes the cost: read the cost summary again once, when the newest analysis goes from in flight to ready.
  const wasInFlight = useRef(false);
  const newest = query.data?.[0];
  useEffect(() => {
    if (!newest || !bomItemId) return;
    if (isInFlight(newest.status)) wasInFlight.current = true;
    else if (wasInFlight.current) {
      wasInFlight.current = false;
      if (isReady(newest.status)) void queryClient.invalidateQueries({ queryKey: ['bom-items', bomItemId, 'cost-summary'] });
    }
  }, [newest, bomItemId, queryClient]);

  return query;
}

export function useRequestCastingAnalysis(bomItemId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => castingAnalysesApi.request(required(bomItemId)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.forItem(bomItemId ?? 'none') }),
  });
}
