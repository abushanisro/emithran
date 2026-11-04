/**
 * React Query hooks for a part's casting analysis. The list is polled only while the newest analysis is queued or running; when one finishes, the
 * part's cost summary is read again, because the route is then measured by it.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { isInFlight, isReady } from "@/lib/casting/analysis-view";

import { castingAnalysesApi, type CastingAnalysisSummary } from "../casting-analyses";

const keys = {
  forItem: (bomItemId: string) => ["casting-analyses", "item", bomItemId] as const,
  detail: (id: string) => ["casting-analyses", "detail", id] as const,
  mesh: (id: string, name: string) => ["casting-analyses", "mesh", id, name] as const,
  dfm: (bomItemId: string) => ["casting-analyses", "dfm", bomItemId] as const,
};

const POLL_MS = 3000;

/** A query or mutation only runs when its id is present; this keeps the type honest without an assertion. */
function required(id: string | undefined): string {
  if (!id) throw new Error("This needs a BOM item id");
  return id;
}

export function useCastingAnalyses(bomItemId: string | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: keys.forItem(bomItemId ?? "none"),
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
      if (isReady(newest.status))
        void queryClient.invalidateQueries({
          queryKey: ["bom-items", bomItemId, "cost-summary"],
        });
    }
  }, [newest, bomItemId, queryClient]);

  return query;
}

export function useRequestCastingAnalysis(bomItemId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => castingAnalysesApi.request(required(bomItemId)),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.forItem(bomItemId ?? "none") }),
  });
}

/** One analysis with its result. A finished analysis never changes, so it is read once. */
export function useCastingAnalysisDetail(id: string | undefined) {
  return useQuery({
    queryKey: keys.detail(id ?? "none"),
    queryFn: () => castingAnalysesApi.get(required(id)),
    enabled: !!id,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

/** A signed URL for one of the analysis's 3D files. It lives five minutes; the viewer keys its load on the file, not the URL, so a refresh does not reload it. */
export function useCastingMeshUrl(
  id: string | undefined,
  name: string | null | undefined,
) {
  return useQuery({
    queryKey: keys.mesh(id ?? "none", name ?? "none"),
    queryFn: () => castingAnalysesApi.meshUrl(required(id), name ?? ""),
    enabled: !!id && !!name,
    staleTime: 4 * 60_000,
    refetchOnWindowFocus: false,
  });
}

/** The design-for-casting checks. They follow the item's analysis, so they are read again when its list changes (invalidated with it). */
export function useSandDfm(
  bomItemId: string | undefined,
  analysisId: string | undefined,
) {
  return useQuery({
    queryKey: [...keys.dfm(bomItemId ?? "none"), analysisId ?? "none"],
    queryFn: () => castingAnalysesApi.sandDfm(required(bomItemId)),
    enabled: !!bomItemId && !!analysisId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}
