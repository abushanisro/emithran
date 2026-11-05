import { deriveAnalysisStatus } from '../../../modules/bom-items/analysis-status';
import { AnalysisRunService } from '../../../modules/bom-items/services/analysis-run.service';

const V = 4;
const graph = (family: string, version = V) => ({ classification: { family }, feature_graph_version: version });

describe('deriveAnalysisStatus: the chosen process against the analysed family', () => {
  const base = { file3dPath: 'p.step', featureGraph: graph('milled') };

  it('is ready when the stored features are the chosen process\'s, or the process has no extractor of its own', () => {
    expect(deriveAnalysisStatus({ ...base, chosenFamilyHint: 'milled' }, 'none', V).cad).toBe('ready');
    expect(deriveAnalysisStatus({ ...base, chosenFamilyHint: null }, 'none', V).cad).toBe('ready');
    expect(deriveAnalysisStatus(base, 'none', V).cad).toBe('ready');
  });

  it('is stale (analyse again) when the process needs another extractor than the stored features came from', () => {
    const s = deriveAnalysisStatus({ ...base, chosenFamilyHint: 'die_cast' }, 'none', V);
    expect(s.cad).toBe('stale');
    expect(s.missing).toEqual(['cad_features']);
  });

  it('never asks for an analysis of a part with no 3D file', () => {
    expect(deriveAnalysisStatus({ file3dPath: null, featureGraph: null, chosenFamilyHint: 'die_cast' }, 'none', V).ready).toBe(true);
  });
});

describe('AnalysisRunService.ensureCurrent', () => {
  const input = { bomItemId: 'i1', userId: 'u', organizationId: 'o', token: 't' };
  const ready = { cad: 'ready', drawing: 'not_required', casting: 'not_required', ready: true, missing: [] };
  const needsCad = { cad: 'none', drawing: 'none', casting: 'not_required', ready: false, missing: ['cad_features'] };
  const needsCasting = { cad: 'ready', drawing: 'not_required', casting: 'none', ready: false, missing: ['casting_analysis'] };

  function build(statuses: object[], item: object = { id: 'i1', file2dPath: null }) {
    const queue = [...statuses];
    const reanalysis = { reanalyze: jest.fn().mockResolvedValue({}), analyzeDrawing: jest.fn().mockResolvedValue({}) };
    const casting = { request: jest.fn().mockResolvedValue({}) };
    const svc = new AnalysisRunService(
      { findOne: jest.fn().mockResolvedValue(item) } as never,
      { forItem: jest.fn().mockImplementation(() => Promise.resolve(queue.length > 1 ? queue.shift() : queue[0])) } as never,
      reanalysis as never,
      casting as never,
    );
    return { svc, reanalysis, casting };
  }

  it('refuses to run without an organization context', async () => {
    const { svc, reanalysis } = build([needsCad]);
    await expect(svc.ensureCurrent({ ...input, organizationId: '' })).rejects.toThrow(/No organization context/);
    expect(reanalysis.reanalyze).not.toHaveBeenCalled();
  });

  it('does nothing when every analysis is current', async () => {
    const { svc, reanalysis, casting } = build([ready]);
    const r = await svc.ensureCurrent(input);
    expect(r.ran).toEqual([]);
    expect(r.status.ready).toBe(true);
    expect(reanalysis.reanalyze).not.toHaveBeenCalled();
    expect(casting.request).not.toHaveBeenCalled();
  });

  it('runs the CAD analysis when the features are missing, then reports the status after it', async () => {
    const { svc, reanalysis } = build([needsCad, ready]);
    const r = await svc.ensureCurrent(input);
    expect(reanalysis.reanalyze).toHaveBeenCalledTimes(1);
    expect(r.ran).toEqual(['cad_features']);
    expect(r.status.ready).toBe(true);
  });

  it('asks for the casting analysis only after the features have decided the family', async () => {
    const order: string[] = [];
    const { svc, reanalysis, casting } = build([needsCad, needsCasting, needsCasting]);
    reanalysis.reanalyze.mockImplementation(() => { order.push('cad'); return Promise.resolve({}); });
    casting.request.mockImplementation(() => { order.push('casting'); return Promise.resolve({}); });
    const r = await svc.ensureCurrent(input);
    expect(order).toEqual(['cad', 'casting']);
    expect(r.ran).toEqual(['cad_features', 'casting_analysis']);
  });

  it('reads the drawing when there is a PDF not read yet, and a drawing failure never fails the run', async () => {
    const { svc, reanalysis } = build([needsCad, ready], { id: 'i1', file2dPath: 'd.pdf' });
    reanalysis.analyzeDrawing.mockRejectedValue(new Error('not a vector PDF'));
    const r = await svc.ensureCurrent(input);
    expect(reanalysis.analyzeDrawing).toHaveBeenCalledTimes(1);
    expect(r.ran).toEqual(['cad_features']); // the drawing did not run, the geometry stands
  });

  it('fails the run when the CAD analysis fails: nothing after it means anything without the features', async () => {
    const { svc, reanalysis, casting } = build([needsCad]);
    reanalysis.reanalyze.mockRejectedValue(new Error('CAD engine unreachable'));
    await expect(svc.ensureCurrent(input)).rejects.toThrow('CAD engine unreachable');
    expect(casting.request).not.toHaveBeenCalled();
  });

  it('a casting analysis that is refused leaves the geometry analysis standing and the status says it is still missing', async () => {
    const { svc, casting } = build([needsCasting]);
    casting.request.mockRejectedValue(new Error('no worker'));
    const r = await svc.ensureCurrent(input);
    expect(r.ran).toEqual([]);
    expect(r.status.missing).toEqual(['casting_analysis']);
  });

  it('is single flight per item: a second call while one runs shares it, and a later call runs again', async () => {
    const { svc, reanalysis } = build([needsCad, ready]);
    let release!: () => void;
    reanalysis.reanalyze.mockReturnValue(new Promise((res) => { release = () => res({}); }));
    const first = svc.ensureCurrent(input);
    const second = svc.ensureCurrent(input);
    await new Promise((r) => setImmediate(r));
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(reanalysis.reanalyze).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    // the lock is released: the next call starts a new run
    reanalysis.reanalyze.mockResolvedValue({});
    const next = build([needsCad, ready]);
    await next.svc.ensureCurrent(input);
    expect(next.reanalysis.reanalyze).toHaveBeenCalledTimes(1);
  });

  it('different items do not wait for each other', async () => {
    const done = new Set<string>();
    const releases: Array<() => void> = [];
    const reanalyze = jest.fn().mockImplementation(
      (id: string) => new Promise((res) => { releases.push(() => { done.add(id); res({}); }); }),
    );
    const svc = new AnalysisRunService(
      { findOne: jest.fn().mockImplementation((id: string) => Promise.resolve({ id, file2dPath: null })) } as never,
      { forItem: jest.fn().mockImplementation((item: { id: string }) => Promise.resolve(done.has(item.id) ? ready : needsCad)) } as never,
      { reanalyze, analyzeDrawing: jest.fn() } as never,
      { request: jest.fn() } as never,
    );
    const a = svc.ensureCurrent(input);
    const b = svc.ensureCurrent({ ...input, bomItemId: 'i2' });
    await new Promise((r) => setImmediate(r));
    expect(reanalyze).toHaveBeenCalledTimes(2);
    releases.forEach((r) => r());
    await Promise.all([a, b]);
  });
});
