/** React Query hooks for a part's own sand-casting variable values. A change recalculates the cost, so the cost summary is read again. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { sandVariableOverridesApi } from "../sand-variable-overrides";

/** A query or mutation only runs when its id is present; this keeps the type honest without an assertion. */
function required(id: string | undefined): string {
  if (!id) throw new Error("This needs a BOM item id");
  return id;
}

const key = (bomItemId: string) => ["sand-variable-overrides", bomItemId] as const;

export function useSandVariableOverrides(bomItemId: string | undefined) {
  return useQuery({
    queryKey: key(bomItemId ?? "none"),
    queryFn: () => sandVariableOverridesApi.list(required(bomItemId)),
    enabled: !!bomItemId,
    refetchOnWindowFocus: false,
  });
}

function useRefresh(bomItemId: string | undefined) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: key(bomItemId ?? "none") }),
      queryClient.invalidateQueries({ queryKey: ["bom-items", bomItemId, "cost-summary"] }),
    ]);
}

export function useSetSandVariableOverride(bomItemId: string | undefined) {
  const refresh = useRefresh(bomItemId);
  return useMutation({
    mutationFn: (a: { variable: string; value: string; reason: string }) =>
      sandVariableOverridesApi.set(required(bomItemId), a.variable, { value: a.value, reason: a.reason }),
    onSuccess: refresh,
  });
}

export function useClearSandVariableOverride(bomItemId: string | undefined) {
  const refresh = useRefresh(bomItemId);
  return useMutation({
    mutationFn: (variable: string) => sandVariableOverridesApi.clear(required(bomItemId), variable),
    onSuccess: refresh,
  });
}
