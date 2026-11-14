/** React Query hooks for a part's own calculator field values. A change recalculates the cost, so the cost and the route comparison are read again. */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { calculatorFieldOverridesApi } from "../calculator-field-overrides";

function required(id: string | undefined): string {
  if (!id) throw new Error("This needs a BOM item id");
  return id;
}

function useRefresh(bomItemId: string | undefined) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["bom-items", bomItemId, "cost-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["bom-items", bomItemId, "route-comparison"] }),
    ]);
}

export function useSetCalculatorFieldOverride(bomItemId: string | undefined) {
  const refresh = useRefresh(bomItemId);
  return useMutation({
    mutationFn: (a: { calculator: string; field: string; value: number; reason: string }) => calculatorFieldOverridesApi.set(required(bomItemId), a),
    onSuccess: refresh,
  });
}

export function useClearCalculatorFieldOverride(bomItemId: string | undefined) {
  const refresh = useRefresh(bomItemId);
  return useMutation({
    mutationFn: (a: { calculator: string; field: string }) => calculatorFieldOverridesApi.clear(required(bomItemId), a.calculator, a.field),
    onSuccess: refresh,
  });
}
