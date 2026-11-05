import type { FeatureRules } from '../../../../../modules/bom-items/costing/plastic-molding/plastic-reference';
import { resolvePlasticCatalogOperations, type PlasticFeature } from '../../../../../modules/bom-items/costing/plastic-molding/operation/plastic-catalog-operation-resolver';

// Rows as staged in process_taxonomy_operations.
const INJECTION = [
  'Injection Molding:As Molded//SimpleHole', 'Injection Molding:HoleLifter//SimpleHole', 'Injection Molding:HoleNoCore//SimpleHole',
  'Injection Molding:HoleSideCore//SimpleHole', 'Injection Molding:HoleUnscrewMandrel//SimpleHole',
  'Injection Molding:As Molded//PlanarFace', 'Injection Molding:As Molded//Rib', 'Injection Molding:No Cost Feature//Rib',
];
const INSERT_ONLY = ['Insert Injection Molding:As Molded//SimpleHole', 'Insert Injection Molding:HoleUnscrewMandrel//SimpleHole'];
const RULES: FeatureRules = { maxNoCoreInsertDiameterMm: 3, slideEpsilonDeg: 30, lifterEpsilonDeg: 10, autoManualFlashTrimming: true };

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
    expect(r.reason).toContain('needs a core');
  });

  it('a hole 20 degrees from square is out of a lifter\'s reach but within a slide\'s: a side core, resolved', () => {
    const [r] = run([hole('h1', 6.3, 70)]);
    expect(r).toMatchObject({ status: 'resolved', operations: ['HoleSideCore'] });
  });

  it('an oblique hole (outside both epsilons) is undecided with the reason, not given a core', () => {
    const [r] = run([hole('h1', 6.3, 40)]);
    expect(r.status).toBe('undecided');
    expect(r.reason).toMatch(/oblique/);
  });

  it('a hole within the along-the-pull limit is formed by the halves', () => {
    expect(run([hole('h1', 6.3, 4.9)])[0]).toMatchObject({ status: 'resolved', operations: ['As Molded'] });
  });

  it('never picks UnscrewMandrel: CAD does not see threads', () => {
    for (const d of [2.5, 6.3]) expect(run([hole('h', d, 90)])[0].operations).not.toContain('HoleUnscrewMandrel');
  });

  it('without the staged tolerance or the angle the hole is undecided and says why', () => {
    expect(run([hole('h1', 6.3, 90)], INJECTION, { maxNoCoreInsertDiameterMm: 3, slideEpsilonDeg: null, lifterEpsilonDeg: null, autoManualFlashTrimming: null })[0]).toMatchObject({ status: 'undecided' });
    expect(run([hole('h1', 6.3, null)])[0].reason).toMatch(/not known/);
  });

  it('without maxNoCoreInsertDiameter an obscured hole is undecided, not assumed to need a core', () => {
    const [r] = run([hole('h1', 2.5, 90)], INJECTION, { maxNoCoreInsertDiameterMm: null, slideEpsilonDeg: 30, lifterEpsilonDeg: 10, autoManualFlashTrimming: true });
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

  describe('voids, bundles and the parting line', () => {
    const SIDE = [
      'Injection Molding:As Molded//Void', 'Injection Molding:VoidNoCore//Void', 'Injection Molding:VoidSideCore//Void', 'Injection Molding:VoidLifter//Void',
      'Injection Molding:As Molded//ComboVoid', 'Injection Molding:ComboVoidNoCore//ComboVoid', 'Injection Molding:ComboVoidSideCore//ComboVoid', 'Injection Molding:ComboVoidLifter//ComboVoid',
      'Injection Molding:Lifters//LifterBundle', 'Injection Molding:Slides//SlideBundle',
    ];
    const feature = (feature_type: string, over: Partial<PlasticFeature> = {}): PlasticFeature => ({ id: feature_type, feature_type, variant: 'side', occurrences: [{ face_ids: [1] }], ...over });

    it('a big void square to the pull needs a core: side core or lifter, undecided', () => {
      const [r] = run([feature('Void', { diameter_mm: 40, attributes: { angle_to_pull_deg: 90 } })], SIDE);
      expect(r).toMatchObject({ status: 'undecided', operations: ['VoidLifter', 'VoidSideCore'] });
    });

    it('a tiny void is an insert; a void 20 degrees from square is a side core', () => {
      expect(run([feature('Void', { diameter_mm: 2, attributes: { angle_to_pull_deg: 90 } })], SIDE)[0]).toMatchObject({ status: 'resolved', operations: ['VoidNoCore'] });
      expect(run([feature('Void', { diameter_mm: 40, attributes: { angle_to_pull_deg: 70 } })], SIDE)[0]).toMatchObject({ status: 'resolved', operations: ['VoidSideCore'] });
    });

    it('a combo is never judged an insert', () => {
      const [r] = run([feature('ComboVoid', { attributes: { angle_to_pull_deg: 90 } })], SIDE);
      expect(r.operations).toEqual(['ComboVoidLifter', 'ComboVoidSideCore']);
      expect(r.reason).toContain('The group');
    });

    it('a slide bundle is Slides; a lifter bundle is undecided between Lifters and Slides', () => {
      expect(run([feature('SlideBundle', { attributes: { count: 3 } })], SIDE)[0]).toMatchObject({ status: 'resolved', operations: ['Slides'], count: 3 });
      const [r] = run([feature('LifterBundle', { attributes: { count: 2, slide_alternative: true } })], SIDE);
      expect(r).toMatchObject({ status: 'undecided', operations: ['Lifters', 'Slides'] });
      expect(r.reason).toMatch(/clearance/);
    });

    it('a bundle over the staged action length or stroke is undecided: it would have to be split', () => {
      const [r] = run([feature('SlideBundle', { attributes: { count: 4, exceeds_max_action_length: true, width_mm: 612 } })], SIDE);
      expect(r.status).toBe('undecided');
      expect(r.reason).toContain('612 mm wide');
    });

    it('flash trimming on the parting line: included for a part without cutouts, undecided with them', () => {
      const CM = ['Compression Molding:Manual Flash Trimming//PartingLine'];
      const parting = (internal_cutouts: number) => feature('PartingLine', { variant: 'flat', attributes: { internal_cutouts } });
      expect(run([parting(0)], CM)[0]).toMatchObject({ status: 'resolved', operations: ['Manual Flash Trimming'] });
      const withHoles = run([parting(2)], CM)[0];
      expect(withHoles.status).toBe('undecided');
      expect(withHoles.reason).toContain('2 through holes');
      expect(run([parting(0)], CM, { maxNoCoreInsertDiameterMm: 3, slideEpsilonDeg: 30, lifterEpsilonDeg: 10, autoManualFlashTrimming: null })[0].status).toBe('undecided');
    });

    it('injection molding has no parting-line operation: the feature is left out', () => {
      expect(run([feature('PartingLine', { attributes: { internal_cutouts: 0 } })], SIDE)).toEqual([]);
    });
  });
});
