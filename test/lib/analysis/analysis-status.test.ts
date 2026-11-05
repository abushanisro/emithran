import { describe, expect, it } from 'vitest';

import { analysisNotReadyMessage, applyBlockReason, type AnalysisStatus } from '@/lib/analysis/analysis-status';

const status = (over: Partial<AnalysisStatus> = {}): AnalysisStatus => ({
  cad: 'ready', drawing: 'not_required', casting: 'not_required', ready: true, missing: [], ...over,
});

describe('applyBlockReason', () => {
  it('lets Apply go ahead whatever else is missing: Apply Scenario starts the analysis itself', () => {
    expect(applyBlockReason(status())).toBeNull();
    expect(applyBlockReason(status({ cad: 'none', ready: false, missing: ['cad_features'] }))).toBeNull();
    expect(applyBlockReason(status({ cad: 'stale', ready: false, missing: ['cad_features'] }))).toBeNull();
    expect(applyBlockReason(undefined)).toBeNull();
  });

  it('waits only while the casting analysis it started is running', () => {
    expect(applyBlockReason(status({ casting: 'running', ready: false, missing: ['casting_analysis'] }))).toMatch(/casting analysis is running/);
  });

  it('never mentions a separate refresh action', () => {
    for (const s of [status({ casting: 'running', ready: false, missing: ['casting_analysis'] })]) {
      expect(applyBlockReason(s) ?? '').not.toMatch(/refresh/i);
    }
  });
});

describe('analysisNotReadyMessage', () => {
  it('is null when the part is ready', () => {
    expect(analysisNotReadyMessage(status())).toBeNull();
  });

  it('says the scenario was not applied, and why, when the run left something missing', () => {
    expect(analysisNotReadyMessage(status({ cad: 'none', ready: false, missing: ['cad_features'] }))).toMatch(/CAD features could not be extracted/);
    const casting = { ready: false, missing: ['casting_analysis'] as AnalysisStatus['missing'] };
    expect(analysisNotReadyMessage(status({ ...casting, casting: 'running' }))).toMatch(/Apply the scenario again when it finishes/);
    expect(analysisNotReadyMessage(status({ ...casting, casting: 'failed' }))).toMatch(/failed/);
    expect(analysisNotReadyMessage(status({ ...casting, casting: 'none' }))).toMatch(/could not be started/);
  });

  it('puts the CAD features first when both are missing', () => {
    expect(analysisNotReadyMessage(status({ cad: 'none', casting: 'none', ready: false, missing: ['cad_features', 'casting_analysis'] }))).toMatch(/CAD features/);
  });

  it('never points the user at a refresh button', () => {
    const all = [
      status({ cad: 'none', ready: false, missing: ['cad_features'] }),
      status({ ready: false, missing: ['casting_analysis'], casting: 'running' }),
      status({ ready: false, missing: ['casting_analysis'], casting: 'failed' }),
      status({ ready: false, missing: ['casting_analysis'], casting: 'none' }),
    ];
    for (const s of all) expect(analysisNotReadyMessage(s) ?? '').not.toMatch(/refresh/i);
  });
});
