import { describe, expect, it } from 'vitest';

import { applyBlockReason, type AnalysisStatus } from '@/lib/analysis/analysis-status';

const status = (over: Partial<AnalysisStatus> = {}): AnalysisStatus => ({
  cad: 'ready', drawing: 'not_required', casting: 'not_required', ready: true, missing: [], ...over,
});
const reason = (s: AnalysisStatus | undefined, over: { loading?: boolean; refreshing?: boolean } = {}) =>
  applyBlockReason({ status: s, loading: over.loading ?? false, refreshing: over.refreshing ?? false });

describe('applyBlockReason', () => {
  it('lets Apply go ahead when every required analysis is ready', () => {
    expect(reason(status())).toBeNull();
  });

  it('waits while an analysis is running or the status is being read, whatever the status says', () => {
    expect(reason(status(), { refreshing: true })).toMatch(/running/);
    expect(reason(undefined, { loading: true })).toMatch(/Checking/);
  });

  it('does not hold Apply back when the status could not be read: the backend refuses with the same reason', () => {
    expect(reason(undefined)).toBeNull();
  });

  it('asks for Refresh Analysis when the CAD features are missing, and says when they are out of date', () => {
    const none = status({ cad: 'none', ready: false, missing: ['cad_features'] });
    expect(reason(none)).toMatch(/Run Refresh Analysis first/);
    expect(reason(status({ cad: 'stale', ready: false, missing: ['cad_features'] }))).toMatch(/out of date/);
  });

  it('names the casting analysis when that is what is missing', () => {
    const base = { ready: false, missing: ['casting_analysis'] as AnalysisStatus['missing'] };
    expect(reason(status({ ...base, casting: 'running' }))).toMatch(/casting analysis is running/);
    expect(reason(status({ ...base, casting: 'failed' }))).toMatch(/failed/);
    expect(reason(status({ ...base, casting: 'none' }))).toMatch(/start the casting analysis/);
  });

  it('puts the CAD features first when both are missing', () => {
    expect(reason(status({ cad: 'none', casting: 'none', ready: false, missing: ['cad_features', 'casting_analysis'] }))).toMatch(/CAD features/);
  });
});
