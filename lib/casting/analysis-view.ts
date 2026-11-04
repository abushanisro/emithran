// What the Cost Guide shows of a part's casting analysis: the newest one's state, what went wrong in words, and whether a request makes sense.
// Pure, so it is tested. An empty list is "not requested", never "done".
import type { CastingAnalysisStatus, CastingAnalysisSummary } from '@/lib/api/casting-analyses';

export type AnalysisKind = 'none' | 'in_flight' | 'ready' | 'failed';

export interface AnalysisState {
  kind: AnalysisKind;
  label: string;
  /** What to tell the user beyond the label: why it failed, or that it has been queued for a while. */
  detail: string | null;
  /** The button: null when asking again would change nothing. */
  requestLabel: string | null;
}

/** A queued analysis older than this has probably no worker to run it. */
export const STILL_QUEUED_MS = 120_000;

export const isInFlight = (status: CastingAnalysisStatus): boolean => status === 'queued' || status === 'running';
export const isReady = (status: CastingAnalysisStatus): boolean => status === 'succeeded' || status === 'partial';

/** The failure codes the backend's analysis runner stores, in words. */
export function failureText(code: string | null): string {
  switch (code) {
    case 'host_unreachable':
    case 'host_timeout':
    case 'worker_not_run':
      return 'The casting worker is not available (not running or busy). Try again later.';
    case 'unreadable_step':
      return 'The 3D file could not be read as a STEP file.';
    case 'no_solids':
      return 'The 3D file holds no solids.';
    case 'no_cad_file':
    case 'cad_file_missing':
      return 'This part has no stored 3D file to analyse.';
    case 'input_changed':
      return 'The 3D file changed after the request. Request the analysis again.';
    case 'worker_version_mismatch':
      return 'The casting worker is not the version this system expects. Contact support.';
    case 'deadline_exceeded':
    case 'worker_killed':
    case 'worker_failed':
    case 'invalid_result':
    case 'no_result':
      return 'The casting worker could not finish this part. Try again; if it repeats, the part may be too complex.';
    case 'host_protocol':
      return 'The casting worker answered in a way this system could not use. Try again later.';
    default:
      return code ? `The analysis failed (${code}).` : 'The analysis failed.';
  }
}

/** The state of a part's casting analysis from its list (newest first). */
export function analysisState(list: readonly CastingAnalysisSummary[] | undefined, now: number): AnalysisState {
  const newest = list?.[0];
  if (!newest) return { kind: 'none', label: 'Not requested', detail: null, requestLabel: 'Request casting analysis' };
  if (newest.status === 'queued') {
    const waited = now - new Date(newest.createdAt).getTime();
    return {
      kind: 'in_flight', label: 'Queued', requestLabel: null,
      detail: waited > STILL_QUEUED_MS ? 'Still queued: the casting worker may not be running.' : null,
    };
  }
  if (newest.status === 'running') return { kind: 'in_flight', label: 'Analysing…', detail: null, requestLabel: null };
  if (newest.status === 'partial') return { kind: 'ready', label: 'Done (part of the file could not be analysed)', detail: null, requestLabel: null };
  if (newest.status === 'succeeded') return { kind: 'ready', label: 'Done', detail: null, requestLabel: null };
  return { kind: 'failed', label: 'Failed', detail: failureText(newest.errorCode), requestLabel: 'Try again' };
}

/** Why asking for an analysis was refused, in words: the backend's problem details carry a stable code and a detail. */
export function requestFailure(error: unknown): string {
  const e = error as { code?: string; message?: string } | null;
  switch (e?.code) {
    case 'no_cad_file': return failureText('no_cad_file');
    case 'cad_file_missing': return failureText('cad_file_missing');
    default: return e?.message ? `Could not request the analysis: ${e.message}` : 'Could not request the analysis.';
  }
}
