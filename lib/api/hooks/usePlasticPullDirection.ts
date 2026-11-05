import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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

/** The change analyses the part again, so what is read from the analysis (features, draft, cost) is read again. */
function useRefreshAfterChange(bomItemId: string | undefined) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: key(bomItemId ?? "none") }),
      queryClient.invalidateQueries({ queryKey: ["bom-items", "detail", bomItemId] }),
      queryClient.invalidateQueries({ queryKey: ["bom-items", bomItemId, "cost-summary"] }),
    ]);
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
