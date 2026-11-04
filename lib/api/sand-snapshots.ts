import { apiClient } from "./client";

/** A frozen cost result of a sand-cast part (backend/src/modules/bom-items/sand-snapshots.controller.ts). */
export interface SandSnapshot {
  id: string;
  label: string;
  createdBy: string;
  createdAt: string;
  status: "submitted" | "approved" | "rejected";
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  figures: { pieceCost: number | null; materialCost: number | null; mouldingMachine: string | null; cavities: number | null };
  context: {
    location: string;
    batchSize: number | null;
    productionLifeYears: number | null;
    plantOverrides: { variable: string; value: string }[];
    referenceSourceVersion: string;
  };
}

export const sandSnapshotsApi = {
  list(bomItemId: string): Promise<{ snapshots: SandSnapshot[] }> {
    return apiClient.get<{ snapshots: SandSnapshot[] }>(
      `/bom-items/${encodeURIComponent(bomItemId)}/sand-snapshots`,
    );
  },
  /** Freezes the cost the server computes now for this location and batch size. */
  create(
    bomItemId: string,
    body: { label: string; location: string; batchSize?: number; productionLifeYears?: number },
  ): Promise<{ snapshot: SandSnapshot }> {
    return apiClient.post(`/bom-items/${encodeURIComponent(bomItemId)}/sand-snapshots`, body);
  },
  /** A different member approves or rejects a submitted snapshot, with a note. */
  review(
    snapshotId: string,
    body: { decision: "approved" | "rejected"; note: string },
  ): Promise<{ snapshot: SandSnapshot }> {
    return apiClient.post(`/sand-snapshots/${encodeURIComponent(snapshotId)}/review`, body);
  },
};
