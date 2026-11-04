import { apiClient } from './client';

// The backend's casting analysis API (backend/src/modules/sand-casting). The list has no results (a page polls it); one analysis carries its result.
export type CastingAnalysisStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';

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

export const castingAnalysesApi = {
  /** The analyses of one BOM item, newest first. An empty list means not requested. */
  list(bomItemId: string): Promise<CastingAnalysisSummary[]> {
    return apiClient.get<CastingAnalysisSummary[]>(`/casting-analyses?bomItemId=${encodeURIComponent(bomItemId)}`);
  },
  /** Asks for the analysis of the item's 3D file. It runs in the background; an identical request returns the existing analysis. */
  request(bomItemId: string): Promise<CastingAnalysisSummary> {
    return apiClient.post<CastingAnalysisSummary>('/casting-analyses', { bomItemId });
  },
};
