// The part's analysis status as the backend derives it (backend bom-items/analysis-status.ts). The backend is the authority: Apply Scenario asks it
// to make the analysis current (POST /bom-items/:id/analysis-runs), and it refuses a route apply on a part that is not analysed. This only words what
// the backend answered.

export type AnalysisKindStatus = 'none' | 'running' | 'ready' | 'stale' | 'failed' | 'not_required';
export type MissingAnalysis = 'cad_features' | 'casting_analysis';

/** GET /bom-items/:id/analysis-status. */
export interface AnalysisStatus {
  cad: AnalysisKindStatus;
  drawing: AnalysisKindStatus;
  casting: AnalysisKindStatus;
  ready: boolean;
  missing: MissingAnalysis[];
}

/** POST /bom-items/:id/analysis-runs: what the run did, in order, and the status after it. */
export interface AnalysisRunResult {
  ran: ('cad_features' | 'drawing' | 'casting_analysis')[];
  status: AnalysisStatus;
}

/**
 * Why Apply must wait while an analysis it started is still running, or null. Only the casting analysis is asynchronous (a worker); the CAD
 * features are finished when the run returns.
 */
export function applyBlockReason(status: AnalysisStatus | undefined): string | null {
  return status?.casting === 'running' ? 'The casting analysis is running: Apply Scenario is available when it finishes.' : null;
}

/**
 * What to tell the user when an analysis run returned and the part still is not ready: the run did what it could, and this says what is left.
 * Null when the part is ready.
 */
export function analysisNotReadyMessage(status: AnalysisStatus): string | null {
  if (status.ready) return null;
  if (status.missing.includes('cad_features')) return 'The CAD features could not be extracted, so the scenario was not applied.';
  if (status.casting === 'running') return 'The casting analysis has started. Apply the scenario again when it finishes (a few seconds).';
  if (status.casting === 'failed') return 'The casting analysis failed, so the scenario was not applied. Apply again to retry it.';
  return 'The casting analysis could not be started, so the scenario was not applied.';
}
