// The part's analysis status as the backend derives it (backend bom-items/analysis-status.ts), and what it means for Apply.
// The backend is the authority: it refuses an apply on a part that is not analysed. This only tells the user why the button waits.

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

/**
 * Why Apply must wait, or null when it may go ahead. While the status cannot be read (an error) Apply is not held back here: the backend
 * checks again and refuses with the same reason.
 */
export function applyBlockReason(input: { status: AnalysisStatus | undefined; loading: boolean; refreshing: boolean }): string | null {
  if (input.refreshing) return 'Analysis is running…';
  if (input.loading) return 'Checking the analysis…';
  const s = input.status;
  if (!s || s.ready) return null;
  if (s.cad === 'stale') return 'The analysis is out of date: run Refresh Analysis first.';
  if (s.cad !== 'ready' && s.cad !== 'not_required') return 'Run Refresh Analysis first: the CAD features are needed to route the part.';
  if (s.casting === 'running') return 'The casting analysis is running…';
  if (s.casting === 'failed') return 'The casting analysis failed: run Refresh Analysis to try again.';
  return 'Run Refresh Analysis to start the casting analysis.';
}
