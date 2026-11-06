import { useQuery } from "@tanstack/react-query";

import type { CostTable } from "@/lib/costing/cost-table";

import { apiClient } from "../client";

/**
 * The part's applied cost as a table. It is read from the stored records, so it changes when Apply (or an edit of a cost record) does: `refreshKey` is
 * the time the cost summary last updated, which every one of those ends with, and a new value reads the table again.
 */
export function useCostTable(bomItemId: string | undefined, refreshKey: number) {
  return useQuery({
    queryKey: ["bom-items", bomItemId, "cost-table", refreshKey],
    queryFn: () => {
      if (!bomItemId) throw new Error("The cost table needs a BOM item id");
      return apiClient.get<CostTable>(`/bom-items/${bomItemId}/cost-table`);
    },
    enabled: !!bomItemId,
    refetchOnWindowFocus: false,
  });
}
