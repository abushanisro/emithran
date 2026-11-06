import { apiClient } from "@/lib/api/client";

export type PullAxis = "x" | "y" | "z";

/** GET /bom-items/:id/pull-direction: the engineer's mold-opening axis with the reason, who and when, or none (the CAD engine chooses). */
export interface PlasticPullDirection {
  /** The axis the analysis runs along: the engineer's while it applies, null (automatic) otherwise. */
  axis: PullAxis | null;
  /** The axis the engineer chose, applied or not (held back when the item's file was replaced). */
  declaredAxis: PullAxis | null;
  reason: string | null;
  setBy: string | null;
  setAt: string | null;
  status: "automatic" | "in_force" | "needs_confirmation";
  /** Why it is held back, in words. */
  notice: string | null;
}

export const plasticPullDirectionApi = {
  get(bomItemId: string): Promise<PlasticPullDirection> {
    return apiClient.get<PlasticPullDirection>(`/bom-items/${encodeURIComponent(bomItemId)}/pull-direction`);
  },
  /** Fixes the axis (with the reason) and analyses the part again along it. */
  set(bomItemId: string, body: { axis: PullAxis; reason: string }): Promise<{ pullDirection: PlasticPullDirection }> {
    return apiClient.put(`/bom-items/${encodeURIComponent(bomItemId)}/pull-direction`, body);
  },
  /** Returns the part to the automatic pull direction and analyses it again. */
  clear(bomItemId: string): Promise<{ pullDirection: PlasticPullDirection }> {
    return apiClient.delete(`/bom-items/${encodeURIComponent(bomItemId)}/pull-direction`);
  },
};
