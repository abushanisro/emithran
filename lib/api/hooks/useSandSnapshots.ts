/** React Query hooks for a part's frozen cost results. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { sandSnapshotsApi } from "../sand-snapshots";

const key = (bomItemId: string) => ["sand-snapshots", bomItemId] as const;

/** A query or mutation only runs when its id is present; this keeps the type honest without an assertion. */
function required(id: string | undefined): string {
  if (!id) throw new Error("This needs a BOM item id");
  return id;
}

export function useSandSnapshots(bomItemId: string | undefined) {
  return useQuery({
    queryKey: key(bomItemId ?? "none"),
    queryFn: () => sandSnapshotsApi.list(required(bomItemId)),
    enabled: !!bomItemId,
    refetchOnWindowFocus: false,
  });
}

export function useCreateSandSnapshot(bomItemId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { label: string; location: string; batchSize?: number; productionLifeYears?: number }) =>
      sandSnapshotsApi.create(required(bomItemId), body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(bomItemId ?? "none") }),
  });
}

export function useReviewSandSnapshot(bomItemId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (a: { snapshotId: string; decision: "approved" | "rejected"; note: string }) =>
      sandSnapshotsApi.review(a.snapshotId, { decision: a.decision, note: a.note }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(bomItemId ?? "none") }),
  });
}
