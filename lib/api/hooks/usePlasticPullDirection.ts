import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { plasticPullDirectionApi, type PullAxis } from "@/lib/api/plastic-pull-direction";

function required(id: string | undefined): string {
  if (!id) throw new Error("This needs a BOM item id");
  return id;
}

const key = (id: string) => ["plastic-pull-direction", id] as const;

export function usePlasticPullDirection(bomItemId: string | undefined) {
  return useQuery({
    queryKey: key(bomItemId ?? "none"),
    queryFn: () => plasticPullDirectionApi.get(required(bomItemId)),
    enabled: !!bomItemId,
    refetchOnWindowFocus: false,
  });
}

/**
 * The change analyses the part again, so what is read from the analysis is read again. The mutation settles when what the panel itself shows is
 * current (the direction and the item with its new features); the cost summary and the route comparison are computed from the analysis too, take
 * tens of seconds, and refetch on their own without holding the button on "Analysing…" for all of it.
 */
export function refreshAfterPullDirectionChange(queryClient: Pick<QueryClient, "invalidateQueries">, bomItemId: string | undefined): Promise<unknown> {
  for (const queryKey of [
    ["bom-items", bomItemId, "cost-summary"],
    ["bom-items", bomItemId, "route-comparison"],
    ["bom-items", bomItemId, "dfm-scores"],
  ]) void queryClient.invalidateQueries({ queryKey });
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: key(bomItemId ?? "none") }),
    queryClient.invalidateQueries({ queryKey: ["bom-items", "detail", bomItemId] }),
  ]);
}

function useRefreshAfterChange(bomItemId: string | undefined) {
  const queryClient = useQueryClient();
  return () => refreshAfterPullDirectionChange(queryClient, bomItemId);
}

export function useSetPlasticPullDirection(bomItemId: string | undefined) {
  const refresh = useRefreshAfterChange(bomItemId);
  return useMutation({
    mutationFn: (body: { axis: PullAxis; reason: string }) => plasticPullDirectionApi.set(required(bomItemId), body),
    onSuccess: refresh,
  });
}

export function useClearPlasticPullDirection(bomItemId: string | undefined) {
  const refresh = useRefreshAfterChange(bomItemId);
  return useMutation({
    mutationFn: () => plasticPullDirectionApi.clear(required(bomItemId)),
    onSuccess: refresh,
  });
}
