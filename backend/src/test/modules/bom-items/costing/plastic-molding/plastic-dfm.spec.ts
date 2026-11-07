import { evaluatePlasticDfm, holesOfPlasticGraph, type PlasticDfmPart } from '../../../../../modules/bom-items/costing/plastic-molding/dfm/plastic-dfm';
import { realDfmReference } from './real-plastic-reference';

// The DFM engine against the real staged rule data (memory/Plastic Modeling): the thresholds are the data's, never the code's.

const REF = realDfmReference();
const part = (over: Partial<PlasticDfmPart> = {}): PlasticDfmPart => ({ draftFaces: [], holes: [], ...over });
const draft = (face: number, deg: number, cls = 'drafted') => ({ face, deg, basis: 'least', cls });
const find = (r: ReturnType<typeof evaluatePlasticDfm>, rule: string) => r.findings.filter((f) => f.rule === rule);

describe('evaluatePlasticDfm: draft angle, graded by the data', () => {
  it('grades by the process and material row: injection ABS is major under 0.5 degrees and minor under 1', () => {
    const r = evaluatePlasticDfm(part({ draftFaces: [draft(1, 0.2), draft(2, 0.7), draft(3, 1.2), draft(4, 0.4)] }), 'Injection Molding', 'ABS', REF);
    const f = find(r, 'InsufficientDraftAngle');
    expect(f.map((x) => [x.severity, x.count, x.threshold]).sort()).toEqual([['Major', 2, 0.5], ['Minor', 1, 1]]);
    // the faces of the finding are the faces the viewer highlights
    expect(f.find((x) => x.severity === 'Major')!.faces.sort()).toEqual([1, 4]);
    expect(f.find((x) => x.severity === 'Major')!.measured).toBe(0.2);
  });

  it('a material that has its own row is not judged by the general one: nylon is minor under 1 degree', () => {
    const r = evaluatePlasticDfm(part({ draftFaces: [draft(1, 0.7)] }), 'Injection Molding', 'Nylon', REF);
    expect(find(r, 'InsufficientDraftAngle').map((x) => [x.severity, x.threshold])).toEqual([['Minor', 1]]);
  });

  it('another process has its own limit: compression molding wants 1.5', () => {
    const r = evaluatePlasticDfm(part({ draftFaces: [draft(1, 1.2)] }), 'Compression Molding', null, REF);
    expect(find(r, 'InsufficientDraftAngle')[0]).toMatchObject({ severity: 'Minor', threshold: 1.5 });
  });

  it('a face with enough draft passes, and an undercut face is not a draft shortfall', () => {
    const r = evaluatePlasticDfm(part({ draftFaces: [draft(1, 2), draft(2, 0, 'undercut')] }), 'Injection Molding', 'ABS', REF);
    expect(find(r, 'InsufficientDraftAngle')).toEqual([]);
    expect(r.passed).toContain('InsufficientDraftAngle');
  });

  it('writes the finding on the model in the data\'s words and numbers', () => {
    const r = evaluatePlasticDfm(part({ draftFaces: [draft(1, 0.2), draft(2, 0.3)] }), 'Injection Molding', 'ABS', REF);
    expect(find(r, 'InsufficientDraftAngle')[0]!.label).toBe('Draft Angle: 2 faces, worst 0.20 degrees (below major limit 0.50)');
    expect(find(r, 'InsufficientDraftAngle')[0]!.note).toMatch(/draft angle/i);
  });
});

describe('evaluatePlasticDfm: hole length to diameter', () => {
  const holes = [
    { id: 'small-blind', through: false, diameterMm: 3, depthMm: 7.5, faces: [10, 11] },      // small (<= 4.7625 mm), L/D 2.5: over blind-small 2 (minor), under 3 (major)
    { id: 'large-blind', through: false, diameterMm: 8, depthMm: 40, faces: [20] },          // large, L/D 5: over blind-large 4 (major)
    { id: 'small-through', through: true, diameterMm: 4, depthMm: 20, faces: [30] },          // small, L/D 5: over through-small 4 (minor), under 6
    { id: 'ok', through: true, diameterMm: 10, depthMm: 20, faces: [40] },                   // large through, L/D 2
  ];
  const r = evaluatePlasticDfm(part({ holes }), 'Injection Molding', 'ABS', REF);

  it('uses the data\'s hole size border and its ratios, per hole', () => {
    const f = [...find(r, 'HighBlindHoleLengthToDiameterRatio'), ...find(r, 'HighHoleLengthToDiameterRatio')];
    expect(f.map((x) => [x.featureIds[0], x.severity, x.threshold, x.measured]).sort()).toEqual([
      ['large-blind', 'Major', 4, 5],
      ['small-blind', 'Minor', 2, 2.5],
      ['small-through', 'Minor', 4, 5],
    ]);
  });

  it('carries the hole\'s faces and says which hole', () => {
    const f = find(r, 'HighBlindHoleLengthToDiameterRatio').find((x) => x.featureIds[0] === 'small-blind')!;
    expect(f.faces).toEqual([10, 11]);
    expect(f.label).toContain('Blind Hole LD Ratio');
  });

  it('reads the hole size border from the staged variable, and names its absence', () => {
    const noBorder = evaluatePlasticDfm(part({ holes }), 'Injection Molding', 'ABS', { ...REF, smallHoleDiamBorderMm: null });
    expect(noBorder.notEvaluated.find((n) => n.rule === 'HighHoleLengthToDiameterRatio')!.reason).toMatch(/smallHoleDiamBorder/);
  });

  it('reads the holes of the recognised plastic graph (a hole with no depth is left out, a non-hole is ignored)', () => {
    const holes2 = holesOfPlasticGraph({ items: [
      { id: 'hole-1', feature_type: 'SimpleHole', variant: 'through', depth_mm: 1.6, diameter_mm: 1.8, occurrences: [{ face_ids: [4, 5] }] },
      { id: 'hole-2', feature_type: 'SimpleHole', variant: 'blind', diameter_mm: 3, occurrences: [{ face_ids: [6] }] },
      { id: 'void-1', feature_type: 'Void', depth_mm: 5, diameter_mm: 6 },
    ] });
    expect(holes2).toEqual([{ id: 'hole-1', through: true, diameterMm: 1.8, depthMm: 1.6, faces: [4, 5] }]);
    expect(holesOfPlasticGraph(null)).toBeNull();
  });
});

describe('evaluatePlasticDfm: what is not measured is said, never passed', () => {
  const r = evaluatePlasticDfm(part(), 'Injection Molding', 'ABS', REF);

  it('lists each rule the analysis cannot judge with its reason', () => {
    const why = Object.fromEntries(r.notEvaluated.map((n) => [n.rule, n.reason]));
    expect(why['ThinSection']).toMatch(/wall at each face/);
    expect(why['ThickSection']).toMatch(/wall at each face/);
    expect(why['SharpInternalEdge']).toMatch(/radius/);
    expect(why['HighFlowRatio']).toMatch(/gate/);
    expect(r.passed).not.toContain('ThinSection');
  });

  it('every rule of the data is accounted for: a finding, a pass, or a stated reason', () => {
    const rules = [...new Set(REF.severity.map((x) => x['Rule Name']!))];
    for (const rule of rules) {
      const accounted = r.findings.some((f) => f.rule === rule) || r.passed.includes(rule) || r.notEvaluated.some((n) => n.rule === rule);
      expect({ rule, accounted }).toEqual({ rule, accounted: true });
    }
  });

  it('a part with no per-face draft is not evaluated for draft (not passed)', () => {
    const none = evaluatePlasticDfm(part({ draftFaces: null }), 'Injection Molding', 'ABS', REF);
    expect(none.notEvaluated.find((n) => n.rule === 'InsufficientDraftAngle')!.reason).toMatch(/per face/);
    expect(none.passed).not.toContain('InsufficientDraftAngle');
  });

  it('a rule the advice rules do not list is on (InsufficientDraftAngle is graded by the severity table and is not in the advice rules)', () => {
    expect(REF.adviceRules.some((a) => a['advice_rule_name'] === 'InsufficientDraftAngle')).toBe(false);
    expect(REF.adviceRules.every((a) => a['enabled'] === 'True')).toBe(true);
    const x = evaluatePlasticDfm(part({ draftFaces: [draft(1, 0.1)] }), 'Injection Molding', 'ABS', REF);
    expect(find(x, 'InsufficientDraftAngle')).toHaveLength(1);
  });

  it('a rule switched off in the advice rules is not run', () => {
    const off = { ...REF, adviceRules: REF.adviceRules.map((a) => (a['advice_rule_name'] === 'HighHoleLengthToDiameterRatio' ? { ...a, enabled: 'False' } : a)) };
    const x = evaluatePlasticDfm(part({ holes: [{ id: 'h', through: true, diameterMm: 3, depthMm: 30, faces: [1] }] }), 'Injection Molding', 'ABS', off);
    expect(x.notEvaluated.find((n) => n.rule === 'HighHoleLengthToDiameterRatio')!.reason).toMatch(/not enabled/);
    expect(find(x, 'HighHoleLengthToDiameterRatio')).toEqual([]);
  });
});
