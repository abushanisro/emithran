import {
  featureInstances,
  featureKey,
  parseTolerancePolicy,
  resolveFeatureRequirements,
} from '../../../../../modules/bom-items/costing/shared/tolerance/feature-tolerances';
import type { GdtCallout } from '../../../../../modules/bom-items/costing/shared/physics/gdt-callouts';

// feature_graph_v2 in the shape the cad-engine extractors emit (die_casting/
// feature_extractor.py): per entry feature_type/variant, occurrences with
// face_ids and source_face_stable_ids.
const graph = (stableHole2 = 'h2a') => ({
  features: [
    {
      feature_type: 'SimpleHole', variant: 'through',
      occurrences: [
        { face_ids: [4, 5], source_face_stable_ids: ['h1a', 'h1b'], diameter_mm: 8, depth_mm: 12 },
        { face_ids: [6], source_face_stable_ids: [stableHole2], diameter_mm: 5, depth_mm: 10 },
      ],
    },
    { feature_type: 'MultiStepHole', variant: 'stepped', occurrences: [{ face_ids: [7, 8], source_face_stable_ids: ['m1', 'm2'], max_diameter_mm: 14 }] },
    { feature_type: 'PlanarFace', variant: 'default', occurrences: [{ face_ids: [0], source_face_stable_ids: ['p1'], area_mm2: 900, extent_mm: 42 }] },
    { feature_type: 'NotSupported', variant: 'default', occurrences: [{ face_ids: [9, 10] }] },
  ],
});

const callout = (type: string, tol: number, faceIds: string[], source: GdtCallout['source'] = 'step_pmi'): GdtCallout =>
  ({ type, toleranceMm: tol, datum: '', confidence: null, source, faceIds });

describe('featureInstances', () => {
  it('one instance per occurrence, numbered per type, NotSupported excluded, size from the occurrence', () => {
    const inst = featureInstances(graph());
    expect(inst.map((i) => i.label)).toEqual(['SimpleHole:1', 'SimpleHole:2', 'MultiStepHole:1', 'PlanarFace:1']);
    expect(inst.map((i) => i.sizeMm)).toEqual([8, 5, 14, 42]);
    expect(inst.map((i) => i.sizeSource)).toEqual(['diameter_mm', 'diameter_mm', 'max_diameter_mm', 'extent_mm']);
  });

  it('the key is the stable faces, not the order: same faces in any order, same key', () => {
    expect(featureKey('SimpleHole', ['h1b', 'h1a'])).toBe(featureKey('SimpleHole', ['h1a', 'h1b']));
    expect(featureInstances(graph())[0]!.key).toBe(featureKey('SimpleHole', ['h1a', 'h1b']));
  });

  it('an occurrence without a stable id per face has no key (not editable)', () => {
    const g = graph();
    (g.features[0]!.occurrences[0] as any).source_face_stable_ids = ['h1a', null];
    expect(featureInstances(g)[0]!.key).toBeNull();
  });
});

describe('parseTolerancePolicy', () => {
  it('absent is assume_achieved; valid shapes pass; bad ones name the problem', () => {
    expect(parseTolerancePolicy(undefined).policy).toEqual({ mode: 'assume_achieved' });
    expect(parseTolerancePolicy({ mode: 'uniform', values: { flatness: 0.05 } }).policy).toEqual({ mode: 'uniform', values: { flatness: 0.05 } });
    expect(parseTolerancePolicy({ mode: 'cad', replaceBelow: { thresholdMm: 0.254, withMm: 0.254 } }).policy?.mode).toBe('cad');
    expect(parseTolerancePolicy({ mode: 'uniform', values: { wobble: 1 } }).errors[0]).toMatch(/wobble/);
    expect(parseTolerancePolicy({ mode: 'uniform', values: { flatness: -1 } }).policy).toBeNull();
    expect(parseTolerancePolicy({ mode: 'whatever' }).policy).toBeNull();
  });
});

describe('resolveFeatureRequirements', () => {
  const inst = featureInstances(graph());
  const hole1 = inst[0]!.key!;

  it('assume_achieved: only Manual values', () => {
    const r = resolveFeatureRequirements({
      instances: inst, manual: [{ featureKey: hole1, category: 'diamTolerance', value: 0.01 }],
      policy: { mode: 'assume_achieved' }, callouts: [],
    });
    expect(r.instances[0]!.requirements).toEqual([{ category: 'diamTolerance', value: 0.01, source: 'manual' }]);
    expect(r.instances.slice(1).every((i) => i.requirements.length === 0)).toBe(true);
  });

  it('uniform: every feature gets the values; Manual wins for its category', () => {
    const r = resolveFeatureRequirements({
      instances: inst, manual: [{ featureKey: hole1, category: 'flatness', value: 0.02 }],
      policy: { mode: 'uniform', values: { flatness: 0.1, roughness: 3.2 } }, callouts: [],
    });
    expect(r.instances[0]!.requirements).toEqual([
      { category: 'flatness', value: 0.02, source: 'manual' },
      { category: 'roughness', value: 3.2, source: 'policy_uniform' },
    ]);
    expect(r.instances[3]!.requirements.map((q) => q.source)).toEqual(['policy_uniform', 'policy_uniform']);
  });

  it('cad: a model tolerance applies to the feature owning its face; finer than the threshold is replaced', () => {
    const r = resolveFeatureRequirements({
      instances: inst, manual: [],
      policy: { mode: 'cad', replaceBelow: { thresholdMm: 0.01, withMm: 0.05 } },
      callouts: [
        callout('position', 0.1, ['h1b']),
        callout('flatness', 0.005, ['p1']),
        callout('profile_of_line', 0.2, ['p1']),
        callout('flatness', 0.03, [], 'drawing'),
      ],
    });
    expect(r.instances[0]!.requirements).toEqual([{ category: 'positionTolerance', value: 0.1, source: 'cad_model' }]);
    expect(r.instances[3]!.requirements[0]).toMatchObject({ category: 'flatness', value: 0.05, source: 'cad_model_replaced' });
    expect(r.unappliedCad.map((u) => u.type)).toEqual(['profile_of_line', 'flatness']);
  });

  it('a Manual value for a feature that changed on re-analysis is orphaned, not moved', () => {
    const before = featureInstances(graph('h2a'))[1]!.key!;
    const after = featureInstances(graph('h2-changed'));
    const r = resolveFeatureRequirements({
      instances: after, manual: [{ featureKey: before, category: 'diamTolerance', value: 0.01 }],
      policy: { mode: 'assume_achieved' }, callouts: [],
    });
    expect(r.orphanedManual).toHaveLength(1);
    expect(r.instances.every((i) => i.requirements.length === 0)).toBe(true);
  });
});
