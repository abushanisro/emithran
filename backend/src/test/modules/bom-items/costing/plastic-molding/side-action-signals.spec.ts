import type { PlasticFeatureGraph } from '../../../../../modules/bom-items/costing/plastic-molding/operation/plastic-catalog-operations.service';
import { sideActionSignals } from '../../../../../modules/bom-items/costing/plastic-molding/side-action-signals';
import { computeMoldToolingCost } from '../../../../../modules/bom-items/costing/plastic-molding/process/mold-tooling-engine';
import { realPlasticReference } from './real-plastic-reference';

const REF = realPlasticReference();

const item = (feature_type: string, attributes: Record<string, unknown> = {}) => ({ id: `${feature_type}-${Math.random()}`, feature_type, variant: null, attributes, occurrences: [] });
const graph = (items: ReturnType<typeof item>[], not_yet_recognized: string[] = ['SharpEdge']): PlasticFeatureGraph =>
  ({ schema: 'plastic_feature_graph_v1', items, not_yet_recognized, unclassified_faces: 0 }) as PlasticFeatureGraph;

describe('sideActionSignals', () => {
  it('counts features that need a side action, however many faces they have', () => {
    const s = sideActionSignals(graph([
      item('Void', { angle_to_pull_deg: 90 }), item('Void', { angle_to_pull_deg: 90 }), item('ComboVoid'),
      item('SimpleHole', { angle_to_pull_deg: 90 }), item('SimpleHole', { angle_to_pull_deg: 2 }), item('MultiStepHole', { angle_to_pull_deg: 60 }),
      item('PlanarFace', { faces: 131 }), item('Rib', { count: 7 }),
    ]));
    // 2 voids + 1 combo + the side hole + the angled multi-step hole; the hole along the pull and the faces do not count
    expect(s?.undercutFeatures).toBe(5);
  });

  it('separates the bundles only a slide can serve from those a lifter could serve too', () => {
    const s = sideActionSignals(graph([item('SlideBundle'), item('LifterBundle'), item('LifterBundle')]));
    expect(s).toMatchObject({ slideBundles: 1, slideOrLifterBundles: 2 });
  });

  it('counts the slide and lifter blocks by the size class the CAD engine gave each bundle (a bundle with none is unsized, never guessed)', () => {
    const s = sideActionSignals(graph([
      item('SlideBundle', { size_class: 'large' }), item('LifterBundle', { size_class: 'small' }), item('LifterBundle', { size_class: 'small' }),
      item('LifterBundle', { size_class: 'medium' }), item('LifterBundle'),
    ]));
    expect(s?.blocks).toEqual({ slide: { small: 0, medium: 0, large: 1 }, lifter: { small: 2, medium: 1, large: 0 }, unsized: 1 });
  });

  it('says nothing when the graph cannot give the count (no graph, other schema, or an engine that did not look for voids)', () => {
    expect(sideActionSignals(null)).toBeNull();
    expect(sideActionSignals({ ...graph([]), schema: 'other' } as PlasticFeatureGraph)).toBeNull();
    expect(sideActionSignals(graph([item('SimpleHole', { angle_to_pull_deg: 90 })], ['Void', 'SharpEdge']))).toBeNull();
  });

  it('a part with no side features is a real zero, not unknown', () => {
    expect(sideActionSignals(graph([item('PlanarFace', { faces: 6 })]))).toEqual({
      undercutFeatures: 0, slideBundles: 0, slideOrLifterBundles: 0,
      blocks: { slide: { small: 0, medium: 0, large: 0 }, lifter: { small: 0, medium: 0, large: 0 }, unsized: 0 },
    });
  });
});

describe('slide hardware in the mold tooling', () => {
  const base = { moldBaseAreaMm2: 50_000, cavityCount: 1, tables: REF.tooling, toolroomRates: null, location: 'India', scope: { runner: 'cold' as const, classUsesInserts: false, cavityTexture: 'None', sideActionsPriced: false } };
  const has = (r: ReturnType<typeof computeMoldToolingCost>, name: string) => r.items.some((i) => i.componentName === name);

  it('is priced when a slide bundle was recognised, at the staged one-set quantity, and says so', () => {
    const r = computeMoldToolingCost({ ...base, undercutCount: 3, slideBundles: 1, slideOrLifterBundles: 0 });
    expect(has(r, 'Hydraulic Cylinder') && has(r, 'Side Lock')).toBe(true);
    expect(r.warnings.some((w) => w.includes('staged quantity for one mold set'))).toBe(true);
  });

  it('is not priced for bundles a lifter could serve, and the warning says why', () => {
    const r = computeMoldToolingCost({ ...base, undercutCount: 22, slideBundles: 0, slideOrLifterBundles: 11 });
    expect(has(r, 'Hydraulic Cylinder')).toBe(false);
    expect(r.warnings.some((w) => w.includes('11 side-action bundles could be lifters or slides'))).toBe(true);
  });

  it('keeps following the undercut count when the features were not recognised (older engine)', () => {
    expect(has(computeMoldToolingCost({ ...base, undercutCount: 2, slideBundles: null, slideOrLifterBundles: 0 }), 'Hydraulic Cylinder')).toBe(true);
    expect(has(computeMoldToolingCost({ ...base, undercutCount: 0, slideBundles: null, slideOrLifterBundles: 0 }), 'Hydraulic Cylinder')).toBe(false);
  });
});
