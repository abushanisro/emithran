import { castingStatusOf, deriveAnalysisStatus, type AnalysisStatusInput } from './analysis-status';

const CURRENT = 4;
const analysed = (family: string, version = CURRENT): AnalysisStatusInput['featureGraph'] => ({
  classification: { family },
  feature_graph_version: version,
});
const part = (over: Partial<AnalysisStatusInput> = {}): AnalysisStatusInput => ({
  file3dPath: 'org/part.step',
  featureGraph: analysed('milled'),
  ...over,
});

describe('deriveAnalysisStatus', () => {
  it('a part with a current feature graph is ready', () => {
    expect(deriveAnalysisStatus(part(), 'none', CURRENT)).toEqual({
      cad: 'ready', drawing: 'not_required', casting: 'not_required', ready: true, missing: [],
    });
  });

  it('a part with a 3D file and no feature graph needs the CAD features', () => {
    const s = deriveAnalysisStatus(part({ featureGraph: null }), 'none', CURRENT);
    expect(s).toMatchObject({ cad: 'none', ready: false, missing: ['cad_features'] });
  });

  it('a feature graph without a classification is not an analysis (geometry only, or a cache)', () => {
    const s = deriveAnalysisStatus(part({ featureGraph: { feature_graph_version: CURRENT } }), 'none', CURRENT);
    expect(s).toMatchObject({ cad: 'none', ready: false });
  });

  it('a feature graph from an older engine is stale, and an unversioned one too', () => {
    expect(deriveAnalysisStatus(part({ featureGraph: analysed('milled', 3) }), 'none', CURRENT)).toMatchObject({ cad: 'stale', ready: false, missing: ['cad_features'] });
    expect(deriveAnalysisStatus(part({ featureGraph: { classification: { family: 'milled' } } }), 'none', CURRENT).cad).toBe('stale');
  });

  it('a part with no 3D file is not blocked: there is nothing to extract', () => {
    expect(deriveAnalysisStatus({ file3dPath: null, featureGraph: null }, 'none', CURRENT)).toMatchObject({ cad: 'not_required', ready: true });
  });

  describe('a sand-cast part', () => {
    const sand = (over: Partial<AnalysisStatusInput> = {}) => part({ featureGraph: analysed('sand_cast'), ...over });

    it('needs the casting analysis as well as the CAD features', () => {
      expect(deriveAnalysisStatus(sand(), 'none', CURRENT)).toMatchObject({ cad: 'ready', casting: 'none', ready: false, missing: ['casting_analysis'] });
      expect(deriveAnalysisStatus(sand({ featureGraph: null, familyClassification: 'sand_cast' }), 'none', CURRENT).missing).toEqual(['cad_features', 'casting_analysis']);
    });

    it('is ready only when the casting analysis is finished', () => {
      expect(deriveAnalysisStatus(sand(), 'running', CURRENT)).toMatchObject({ casting: 'running', ready: false });
      expect(deriveAnalysisStatus(sand(), 'failed', CURRENT)).toMatchObject({ casting: 'failed', ready: false });
      expect(deriveAnalysisStatus(sand(), 'ready', CURRENT)).toMatchObject({ casting: 'ready', ready: true, missing: [] });
    });

    it('does not need it when the engineer pinned another family', () => {
      expect(deriveAnalysisStatus(sand({ manufacturingFamilyOverride: 'milled' }), 'none', CURRENT)).toMatchObject({ casting: 'not_required', ready: true });
    });

    it('is decided by the stored family when the feature graph is missing', () => {
      expect(deriveAnalysisStatus(part({ featureGraph: null, familyClassification: 'sand_cast' }), 'ready', CURRENT).casting).toBe('ready');
    });
  });

  it('other casting families and other parts never wait for a casting analysis', () => {
    for (const family of ['die_cast', 'investment_cast', 'sheet_metal', 'plastic_molded']) {
      expect(deriveAnalysisStatus(part({ featureGraph: analysed(family) }), 'none', CURRENT).casting).toBe('not_required');
    }
  });

  it('the drawing is informational: a missing intelligence never blocks', () => {
    expect(deriveAnalysisStatus(part({ file2dPath: 'org/p.pdf' }), 'none', CURRENT)).toMatchObject({ drawing: 'none', ready: true });
    expect(deriveAnalysisStatus(part({ file2dPath: 'org/p.pdf', drawingIntelligence: { material: 'x' } }), 'none', CURRENT).drawing).toBe('ready');
  });
});

describe('castingStatusOf', () => {
  it('no rows is not requested, never ready', () => {
    expect(castingStatusOf([])).toBe('none');
  });
  it('a finished analysis wins over a newer request still in flight, because the cost route measures by it', () => {
    expect(castingStatusOf(['queued', 'succeeded'])).toBe('ready');
    expect(castingStatusOf(['running', 'partial'])).toBe('ready');
  });
  it('in flight beats failed, and failed is reported when nothing else exists', () => {
    expect(castingStatusOf(['failed', 'queued'])).toBe('running');
    expect(castingStatusOf(['failed'])).toBe('failed');
  });
});
