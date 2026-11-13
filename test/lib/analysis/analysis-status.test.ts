import { describe, expect, it } from 'vitest';

import { analysisRunMessage, applyGate, type AnalysisStatus } from '@/lib/analysis/analysis-status';

const status = (over: Partial<AnalysisStatus> = {}): AnalysisStatus => ({
  cad: 'ready', drawing: 'not_required', casting: 'not_required', ready: true, missing: [], ...over,
});

// Apply never starts an analysis: Refresh analysis (the top bar) does. Apply runs on an analysed part, waits while the casting analysis runs, and
// otherwise sends the user to Refresh analysis.
describe('applyGate', () => {
  it('lets Apply run on an analysed part, and while the status is still loading (the backend refuses an unanalysed part anyway)', () => {
    expect(applyGate(status())).toEqual({ kind: 'ok' });
    expect(applyGate(undefined)).toEqual({ kind: 'ok' });
  });

  it('waits while the casting analysis runs', () => {
    expect(applyGate(status({ casting: 'running', ready: false, missing: ['casting_analysis'] }))).toMatchObject({ kind: 'wait', reason: expect.stringMatching(/running/) as string });
  });

  it('sends the user to Refresh analysis when the part is not analysed, saying what is missing', () => {
    const g = applyGate(status({ cad: 'none', ready: false, missing: ['cad_features'] }));
    expect(g.kind).toBe('analyse');
    expect(g.kind === 'analyse' && g.reason).toMatch(/Refresh analysis/);
    expect(g.kind === 'analyse' && g.reason).toMatch(/CAD features/);
    const c = applyGate(status({ casting: 'failed', ready: false, missing: ['casting_analysis'] }));
    expect(c.kind === 'analyse' && c.reason).toMatch(/casting analysis/);
  });
});

describe('analysisRunMessage', () => {
  it('says the analysis is current, or that nothing needed redoing', () => {
    expect(analysisRunMessage({ ran: ['cad_features'], status: status() })).toEqual({ ok: true, text: 'Analysis refreshed: the part is ready to apply.' });
    expect(analysisRunMessage({ ran: [], status: status() })).toEqual({ ok: true, text: 'The analysis is already current.' });
  });

  it('says what is left when the run could not finish everything', () => {
    const casting = { ready: false, missing: ['casting_analysis'] as AnalysisStatus['missing'] };
    expect(analysisRunMessage({ ran: ['casting_analysis'], status: status({ ...casting, casting: 'running' }) })).toMatchObject({ ok: true, text: expect.stringMatching(/started/) as string });
    expect(analysisRunMessage({ ran: [], status: status({ cad: 'none', ready: false, missing: ['cad_features'] }) })).toMatchObject({ ok: false, text: expect.stringMatching(/CAD features could not be extracted/) as string });
    expect(analysisRunMessage({ ran: [], status: status({ ...casting, casting: 'failed' }) })).toMatchObject({ ok: false, text: expect.stringMatching(/failed/) as string });
    expect(analysisRunMessage({ ran: [], status: status({ ...casting, casting: 'none' }) })).toMatchObject({ ok: false, text: expect.stringMatching(/could not be started/) as string });
  });
});
