// The part's analysis status as the backend derives it (backend bom-items/analysis-status.ts). The backend is the authority: Refresh analysis asks it
// to make the analysis current (POST /bom-items/:id/analysis-runs), and it refuses an apply on a part that is not analysed. This only words what the
// backend answered.

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

const MISSING_TEXT: Record<MissingAnalysis, string> = {
  cad_features: 'the CAD features are not extracted',
  casting_analysis: 'the casting analysis is not done',
};

/** Whether Apply (Scenario or Route) may run. Apply never starts an analysis: on a part that is not analysed it sends the user to Refresh analysis. */
export type ApplyGate = { kind: 'ok' } | { kind: 'wait'; reason: string } | { kind: 'analyse'; reason: string };

export function applyGate(status: AnalysisStatus | undefined): ApplyGate {
  // Still loading: let it through; the backend refuses an unanalysed part (409 analysis_not_ready) and says why.
  if (!status || status.ready) return { kind: 'ok' };
  if (status.casting === 'running') return { kind: 'wait', reason: 'The casting analysis is running: Apply is available when it finishes.' };
  const missing = status.missing.map((m) => MISSING_TEXT[m]).join(' and ');
  return { kind: 'analyse', reason: `This part is not analysed (${missing || 'not current'}). Click Refresh analysis at the top first.` };
}

/** What Refresh analysis tells the user after a run: done, started (the casting analysis finishes on its own), or what could not be done. */
export function analysisRunMessage(run: AnalysisRunResult): { ok: boolean; text: string } {
  const s = run.status;
  if (s.ready) return { ok: true, text: run.ran.length ? 'Analysis refreshed: the part is ready to apply.' : 'The analysis is already current.' };
  if (s.missing.includes('cad_features')) return { ok: false, text: 'The CAD features could not be extracted: check that the part has a 3D file and the CAD engine is running.' };
  if (s.casting === 'running') return { ok: true, text: 'The casting analysis has started: Apply is available when it finishes (a few seconds).' };
  if (s.casting === 'failed') return { ok: false, text: 'The casting analysis failed. Refresh analysis again to retry it.' };
  return { ok: false, text: 'The casting analysis could not be started: the casting worker may not be running.' };
}
