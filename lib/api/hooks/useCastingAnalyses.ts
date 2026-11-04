/**
 * React Query hooks for a part's casting analysis. The list is polled only while the newest analysis is queued or running; when one finishes, the
 * part's cost summary is read again, because the route is then measured by it.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

import { isInFlight, isReady } from "@/lib/casting/analysis-view";
import { analysesForDirection, directionOf } from "@/lib/casting/draw-direction";

import { castingAnalysesApi, drawDirectionApi, type DrawAxis } from "../casting-analyses";

const keys = {
  forItem: (bomItemId: string) => ["casting-analyses", "item", bomItemId] as const,
  direction: (bomItemId: string) => ["casting-analyses", "direction", bomItemId] as const,
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

/** The item's draw direction (the engineer's axis, or none: the worker chooses). */
export function useDrawDirection(bomItemId: string | undefined) {
  return useQuery({
    queryKey: keys.direction(bomItemId ?? "none"),
    queryFn: () => drawDirectionApi.get(required(bomItemId)),
    enabled: !!bomItemId,
    refetchOnWindowFocus: false,
  });
}

/**
 * The analyses of the item along its current draw direction, newest first (an automatic analysis never answers an override, nor the other way
 * round). `data` is undefined until both the list and the direction are known.
 */
export function useCastingAnalyses(bomItemId: string | undefined) {
  const queryClient = useQueryClient();
  const direction = useDrawDirection(bomItemId);
  const wanted = directionOf(direction.data);
  const wantedRef = useRef(wanted);
  wantedRef.current = wanted;
  const query = useQuery({
    queryKey: keys.forItem(bomItemId ?? "none"),
    queryFn: () => castingAnalysesApi.list(required(bomItemId)),
    enabled: !!bomItemId,
    refetchInterval: (q) => {
      const newest = q.state.data
        ? analysesForDirection(q.state.data, wantedRef.current)[0]
        : undefined;
      return newest && isInFlight(newest.status) ? POLL_MS : false;
    },
    refetchOnWindowFocus: false,
  });
  const data = useMemo(
    () =>
      query.data && direction.data ? analysesForDirection(query.data, wanted) : undefined,
    [query.data, direction.data, wanted],
  );

  // A finished analysis changes the cost and the design checks: read them again once, when the newest analysis goes from in flight to ready.
  const wasInFlight = useRef(false);
  const newest = data?.[0];
  useEffect(() => {
    if (!newest || !bomItemId) return;
    if (isInFlight(newest.status)) wasInFlight.current = true;
    else if (wasInFlight.current) {
      wasInFlight.current = false;
      if (isReady(newest.status)) {
        void queryClient.invalidateQueries({
          queryKey: ["bom-items", bomItemId, "cost-summary"],
        });
        void queryClient.invalidateQueries({ queryKey: keys.dfm(bomItemId) });
      }
    }
  }, [newest, bomItemId, queryClient]);

  return {
    ...query,
    data,
    isLoading: query.isLoading || direction.isLoading,
    isError: query.isError || direction.isError,
  };
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

/** What a change of draw direction changes: the direction, the analyses (one was asked for), and what they measure. */
function useRefreshAfterDirectionChange(bomItemId: string | undefined) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.direction(bomItemId ?? "none") }),
      queryClient.invalidateQueries({ queryKey: keys.forItem(bomItemId ?? "none") }),
      queryClient.invalidateQueries({ queryKey: keys.dfm(bomItemId ?? "none") }),
      queryClient.invalidateQueries({
        queryKey: ["bom-items", bomItemId, "cost-summary"],
      }),
    ]);
}

/** Fixes the draw axis (with the reason) and asks for the analysis along it. */
export function useSetDrawDirection(bomItemId: string | undefined) {
  const refresh = useRefreshAfterDirectionChange(bomItemId);
  return useMutation({
    mutationFn: (body: { axis: DrawAxis; reason: string }) =>
      drawDirectionApi.set(required(bomItemId), body),
    onSuccess: refresh,
  });
}

/** Returns the part to the automatic draw direction. */
export function useClearDrawDirection(bomItemId: string | undefined) {
  const refresh = useRefreshAfterDirectionChange(bomItemId);
  return useMutation({
    mutationFn: () => drawDirectionApi.clear(required(bomItemId)),
    onSuccess: refresh,
  });
}
