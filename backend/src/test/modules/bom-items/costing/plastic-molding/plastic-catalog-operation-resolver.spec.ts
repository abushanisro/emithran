import type { FeatureRules } from '../../../../../modules/bom-items/costing/plastic-molding/plastic-reference';
import { resolvePlasticCatalogOperations, type PlasticFeature } from '../../../../../modules/bom-items/costing/plastic-molding/operation/plastic-catalog-operation-resolver';

// Rows as staged in process_taxonomy_operations.
const INJECTION = [
  'Injection Molding:As Molded//SimpleHole', 'Injection Molding:HoleLifter//SimpleHole', 'Injection Molding:HoleNoCore//SimpleHole',
  'Injection Molding:HoleSideCore//SimpleHole', 'Injection Molding:HoleUnscrewMandrel//SimpleHole',
  'Injection Molding:As Molded//PlanarFace', 'Injection Molding:As Molded//Rib', 'Injection Molding:No Cost Feature//Rib',
];
const INSERT_ONLY = ['Insert Injection Molding:As Molded//SimpleHole', 'Insert Injection Molding:HoleUnscrewMandrel//SimpleHole'];
const RULES: FeatureRules = { maxNoCoreInsertDiameterMm: 3, axisToleranceDeg: 10 };

const hole = (id: string, diameter: number, angle: number | null): PlasticFeature => ({
  id, feature_type: 'SimpleHole', variant: 'through', diameter_mm: diameter, attributes: { angle_to_pull_deg: angle }, occurrences: [{ face_ids: [1] }],
});
const run = (features: PlasticFeature[], catalogRaw = INJECTION, rules: FeatureRules | null = RULES) => resolvePlasticCatalogOperations({ catalogRaw, features, rules });

describe('resolvePlasticCatalogOperations', () => {
  it('a hole along the pull is formed by the mold halves', () => {
    const [r] = run([hole('h1', 6.3, 2)]);
    expect(r).toMatchObject({ status: 'resolved', operations: ['As Molded'], featureType: 'SimpleHole' });
  });

  it('an obscured hole up to maxNoCoreInsertDiameter is an insert with no core', () => {
    const [r] = run([hole('h1', 2.5, 90)]);
    expect(r).toMatchObject({ status: 'resolved', operations: ['HoleNoCore'] });
  });

  it('an obscured hole above it needs a side core or a lifter, and which one is left undecided', () => {
    const [r] = run([hole('h1', 6.3, 90)]);
    expect(r.status).toBe('undecided');
    expect(r.operations).toEqual(['HoleLifter', 'HoleSideCore']);
    expect(r.reason).toContain('above maxNoCoreInsertDiameter');
  });

  it('never picks UnscrewMandrel: CAD does not see threads', () => {
    for (const d of [2.5, 6.3]) expect(run([hole('h', d, 90)])[0].operations).not.toContain('HoleUnscrewMandrel');
  });

  it('without the staged tolerance or the angle the hole is undecided and says why', () => {
    expect(run([hole('h1', 6.3, 5)], INJECTION, { maxNoCoreInsertDiameterMm: 3, axisToleranceDeg: null })[0]).toMatchObject({ status: 'undecided' });
    expect(run([hole('h1', 6.3, null)])[0].reason).toMatch(/not known/);
  });

  it('without maxNoCoreInsertDiameter an obscured hole is undecided, not assumed to need a core', () => {
    const [r] = run([hole('h1', 2.5, 90)], INJECTION, { maxNoCoreInsertDiameterMm: null, axisToleranceDeg: 10 });
    expect(r.status).toBe('undecided');
    expect(r.reason).toContain('not staged');
  });

  it('a multi-step hole is judged by its widest step', () => {
    const f: PlasticFeature = { ...hole('m1', 2, 90), feature_type: 'MultiStepHole', attributes: { angle_to_pull_deg: 90, steps: [{ diameter_mm: 2 }, { diameter_mm: 5 }] } };
    const catalog = ['Injection Molding:HoleNoCore//MultiStepHole', 'Injection Molding:HoleSideCore//MultiStepHole', 'Injection Molding:As Molded//MultiStepHole'];
    expect(run([f], catalog)[0]).toMatchObject({ status: 'resolved', operations: ['HoleSideCore'] });
  });

  it('faces and ribs are As Molded; No Cost Feature is never chosen; counts come from the feature', () => {
    const rib: PlasticFeature = { id: 'rib', feature_type: 'Rib', variant: 'legacy_antiparallel_pairs', attributes: { count: 7 }, occurrences: [] };
    const face: PlasticFeature = { id: 'pf', feature_type: 'PlanarFace', variant: null, attributes: { faces: 131 }, occurrences: [{ face_ids: [1, 2] }] };
    const out = run([rib, face]);
    expect(out.map((o) => [o.featureType, o.operations, o.count])).toEqual([['PlanarFace', ['As Molded'], 131], ['Rib', ['As Molded'], 7]]);
  });

  it('a feature type the process does not list is left out', () => {
    expect(run([{ id: 'v', feature_type: 'Void', variant: null, occurrences: [] }])).toEqual([]);
  });

  it('an obscured hole in a process with only an unscrewing operation is undecided, not infeasible; with nothing at all it is infeasible', () => {
    expect(run([hole('h', 6.3, 90)], INSERT_ONLY)[0]).toMatchObject({ status: 'undecided', operations: ['HoleUnscrewMandrel'] });
    expect(run([hole('h', 6.3, 90)], ['X:As Molded//SimpleHole'])[0]).toMatchObject({ status: 'infeasible', operations: [] });
  });
});
