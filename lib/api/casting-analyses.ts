import { apiClient } from "./client";

// The backend's casting analysis API (backend/src/modules/sand-casting). The list has no results (a page polls it); one analysis carries its result.
export type CastingAnalysisStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "partial"
  | "failed";

/** The draw direction an analysis was run with: chosen by the worker (auto) or fixed by an engineer. */
export type DrawDirection = "auto" | "x" | "y" | "z";
export type DrawAxis = Exclude<DrawDirection, "auto">;

export interface CastingAnalysisSummary {
  id: string;
  bomItemId: string;
  status: CastingAnalysisStatus;
  drawDirection: DrawDirection;
  workerVersion: string;
  schemaVersion: number;
  attempts: number;
  errorCode: string | null;
  errorDetail: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** One analysis with the worker's result (casting-worker/result.schema.json); read through lib/casting/result-view.ts. */
export interface CastingAnalysisDetail extends CastingAnalysisSummary {
  result: unknown;
}

export interface CastingMeshUrl {
  name: string;
  url: string;
  expiresInSeconds: number;
}

export type DfmSeverity = "Critical" | "Major" | "Minor";

export interface DfmFinding {
  rule: string;
  title: string;
  severity: DfmSeverity;
  measured: number;
  threshold: number;
  comparison: "<" | ">";
  unit: string | null;
  note: string | null;
  featureIds: string[];
  faces: number[];
}

/** GET /bom-items/:id/sand-dfm (backend sand-cost.service.ts `dfm`). */
export interface SandDfmView {
  status: "ok" | "no_analysis" | "unavailable";
  result: {
    rulesetVersion: string;
    materialType: string | null;
    findings: DfmFinding[];
    passed: string[];
    notEvaluated: Array<{ rule: string; reason: string }>;
  } | null;
  reasons: string[];
}

/** GET /bom-items/:id/draw-direction: the engineer's axis with the reason, who and when, or none (the worker chooses). */
export interface CastingDrawDirection {
  axis: DrawAxis | null;
  reason: string | null;
  setBy: string | null;
  setAt: string | null;
}

export const drawDirectionApi = {
  get(bomItemId: string): Promise<CastingDrawDirection> {
    return apiClient.get<CastingDrawDirection>(
      `/bom-items/${encodeURIComponent(bomItemId)}/draw-direction`,
    );
  },
  /** Fixes the axis (with the reason) and asks for the analysis along it. */
  set(
    bomItemId: string,
    body: { axis: DrawAxis; reason: string },
  ): Promise<{ drawDirection: CastingDrawDirection; analysis: CastingAnalysisSummary }> {
    return apiClient.put(
      `/bom-items/${encodeURIComponent(bomItemId)}/draw-direction`,
      body,
    );
  },
  /** Returns the part to the automatic draw direction. */
  clear(bomItemId: string): Promise<void> {
    return apiClient.delete(`/bom-items/${encodeURIComponent(bomItemId)}/draw-direction`);
  },
};

export const castingAnalysesApi = {
  /** The analyses of one BOM item, newest first. An empty list means not requested. */
  list(bomItemId: string): Promise<CastingAnalysisSummary[]> {
    return apiClient.get<CastingAnalysisSummary[]>(
      `/casting-analyses?bomItemId=${encodeURIComponent(bomItemId)}`,
    );
  },
  /** Asks for the analysis of the item's 3D file. It runs in the background; an identical request returns the existing analysis. */
  request(bomItemId: string): Promise<CastingAnalysisSummary> {
    return apiClient.post<CastingAnalysisSummary>("/casting-analyses", { bomItemId });
  },
  /** One analysis, with its result. */
  get(id: string): Promise<CastingAnalysisDetail> {
    return apiClient.get<CastingAnalysisDetail>(
      `/casting-analyses/${encodeURIComponent(id)}`,
    );
  },
  /** A short-lived signed URL for one 3D file the analysis's result lists. */
  meshUrl(id: string, name: string): Promise<CastingMeshUrl> {
    return apiClient.get<CastingMeshUrl>(
      `/casting-analyses/${encodeURIComponent(id)}/meshes?name=${encodeURIComponent(name)}`,
    );
  },
  /** The design-for-casting checks of the item's analysis of its current file. */
  sandDfm(bomItemId: string): Promise<SandDfmView> {
    return apiClient.get<SandDfmView>(
      `/bom-items/${encodeURIComponent(bomItemId)}/sand-dfm`,
    );
  },
};
