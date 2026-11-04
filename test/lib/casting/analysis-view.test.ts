import { describe, expect, it } from 'vitest';

import type { CastingAnalysisSummary } from '@/lib/api/casting-analyses';
import { STILL_QUEUED_MS, analysisState, failureText, isInFlight, isReady, requestFailure } from '@/lib/casting/analysis-view';

const NOW = Date.parse('2026-11-04T12:00:00Z');
const analysis = (over: Partial<CastingAnalysisSummary> = {}): CastingAnalysisSummary => ({
  id: 'a', bomItemId: 'i', status: 'queued', workerVersion: '0.12.0', schemaVersion: 1, attempts: 0, errorCode: null, errorDetail: null,
  createdAt: new Date(NOW - 5_000).toISOString(), finishedAt: null, ...over,
});

describe('analysisState', () => {
  it('no analysis is "not requested", never "done", and points to Refresh Analysis (no separate request button)', () => {
    for (const none of [undefined, []]) {
      expect(analysisState(none, NOW)).toEqual({ kind: 'none', label: 'Not requested', detail: 'Run Refresh Analysis to start it.', requestLabel: null });
    }
  });

  it('queued and running are in flight: no button; a queue that has waited too long says the worker may not be running', () => {
    expect(analysisState([analysis()], NOW)).toMatchObject({ kind: 'in_flight', label: 'Queued', detail: null, requestLabel: null });
    const old = analysis({ createdAt: new Date(NOW - STILL_QUEUED_MS - 1000).toISOString() });
    expect(analysisState([old], NOW).detail).toMatch(/may not be running/);
    expect(analysisState([analysis({ status: 'running' })], NOW)).toMatchObject({ kind: 'in_flight', label: 'Analysing…', requestLabel: null });
  });

  it('succeeded and partial are ready (partial says part of the file could not be analysed), with nothing to ask for', () => {
    expect(analysisState([analysis({ status: 'succeeded' })], NOW)).toMatchObject({ kind: 'ready', label: 'Done', requestLabel: null });
    expect(analysisState([analysis({ status: 'partial' })], NOW).label).toMatch(/could not be analysed/);
  });

  it('failed says why in words and offers to try again', () => {
    const s = analysisState([analysis({ status: 'failed', errorCode: 'unreadable_step' })], NOW);
    expect(s).toMatchObject({ kind: 'failed', label: 'Failed', requestLabel: 'Try again' });
    expect(s.detail).toMatch(/could not be read as a STEP file/);
  });

  it('is decided by the newest analysis only (the list is newest first)', () => {
    expect(analysisState([analysis({ status: 'succeeded' }), analysis({ id: 'old', status: 'failed' })], NOW).kind).toBe('ready');
  });
});

describe('failureText and requestFailure', () => {
  it('every code the runner stores has words, and an unknown one still says something', () => {
    for (const code of ['host_unreachable', 'host_timeout', 'worker_not_run', 'unreadable_step', 'no_solids', 'no_cad_file', 'cad_file_missing', 'input_changed', 'worker_version_mismatch', 'deadline_exceeded', 'worker_killed', 'worker_failed', 'invalid_result', 'no_result', 'host_protocol']) {
      expect(failureText(code)).not.toMatch(/^The analysis failed/);
    }
    expect(failureText('something_new')).toBe('The analysis failed (something_new).');
    expect(failureText(null)).toBe('The analysis failed.');
  });

  it('a refused request is explained: no stored file, or the server\'s own message', () => {
    expect(requestFailure({ code: 'no_cad_file' })).toMatch(/no stored 3D file/);
    expect(requestFailure({ message: 'Network down' })).toBe('Could not request the analysis: Network down');
    expect(requestFailure(null)).toBe('Could not request the analysis.');
  });

  it('classifies statuses', () => {
    expect(['queued', 'running'].every((s) => isInFlight(s as never))).toBe(true);
    expect(['succeeded', 'partial'].every((s) => isReady(s as never))).toBe(true);
    expect(isReady('failed') || isInFlight('failed')).toBe(false);
  });
});
