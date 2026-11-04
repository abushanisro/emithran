import { apiClient } from "./client";

// The backend's casting analysis API (backend/src/modules/sand-casting). The list has no results (a page polls it); one analysis carries its result.
export type CastingAnalysisStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "partial"
  | "failed";

export interface CastingAnalysisSummary {
  id: string;
  bomItemId: string;
  status: CastingAnalysisStatus;
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
