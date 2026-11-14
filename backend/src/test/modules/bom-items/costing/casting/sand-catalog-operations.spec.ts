import { resolveSandCatalogOperations, sandFeaturesFromCastingResult, type SandFeature } from '../../../../../modules/bom-items/costing/casting/sand/sand-catalog-operations';
import { stableFaceHash } from '../../../../../modules/bom-items/costing/casting/sand/casting-face-bridge';

// The sand-casting report: each recognised feature under the catalog operation that makes it (memory/Sand casting/Processes/operations.csv,
// staged as process_taxonomy_operations). Faces are "As Cast" by the moulding process; holes, voids, rings and sharp edges are made by the
// mould ("Sand Casting") unless a core forms them, then by the coring process ("No Bake//SimpleHole", with "As Cored" below). Which
// features a core forms is known only from the casting analysis; without it a hole is undecided between the two, never guessed.
const MOULDING = [
  'Horizontal Automatic:As Cast//CurvedSurface',
  'Horizontal Automatic:As Cast//CurvedWall',
  'Horizontal Automatic:As Cast//PlanarFace',
  'Horizontal Automatic:Sand Casting//MultiStepHole',
  'Horizontal Automatic:Sand Casting//SharpEdge',
  'Horizontal Automatic:Sand Casting//SimpleHole',
  'Horizontal Automatic:Sand Casting//SimpleHole:As Cast//Edge',
  'Horizontal Automatic:Sand Casting//Void',
];
const CORING = [
  'No Bake:No Bake Coring',
  'No Bake:No Bake Coring:No Bake//MultiStepHole',
  'No Bake:No Bake Coring:No Bake//SimpleHole',
  'No Bake:No Bake Coring:No Bake//SimpleHole:As Cored//CurvedWall',
  'No Bake:No Bake Coring:No Bake//SimpleHole:As Cored//Edge',
  'No Bake:No Bake Coring:No Bake//Void',
];
const f = (id: string, type: string, core: number | null = null, diameterMm: number | null = null): SandFeature => ({ id, type, core, diameterMm });
const run = (features: SandFeature[], coresLinked: boolean) =>
  resolveSandCatalogOperations({ mouldingCatalog: MOULDING, coringCatalog: CORING, features, coresLinked });

describe('resolveSandCatalogOperations', () => {
  it('puts faces under As Cast and uncored holes and sharp edges under Sand Casting, by the moulding process', () => {
    const { moulding, coring } = run([f('p1', 'PlanarFace'), f('p2', 'PlanarFace'), f('w1', 'CurvedWall'), f('h1', 'SimpleHole', null, 3.2), f('e1', 'SharpEdge')], true);
    expect(moulding.map((o) => [o.operations[0], o.featureType, o.count, o.status])).toEqual([
      ['As Cast', 'CurvedWall', 1, 'resolved'],
      ['As Cast', 'PlanarFace', 2, 'resolved'],
      ['Sand Casting', 'SharpEdge', 1, 'resolved'],
      ['Sand Casting', 'SimpleHole', 1, 'resolved'],
    ]);
    expect(moulding.find((o) => o.featureType === 'PlanarFace')!.featureIds).toEqual(['p1', 'p2']);
    expect(moulding.find((o) => o.featureType === 'SimpleHole')!.children).toEqual([{ operation: 'As Cast', featureType: 'Edge' }]);
    expect(coring).toEqual([]);
  });

  it('puts a hole a core forms under the coring process, with its As Cored steps', () => {
    const { moulding, coring } = run([f('h1', 'SimpleHole', 1), f('h2', 'SimpleHole', 2), f('h3', 'SimpleHole', null)], true);
    expect(coring).toEqual([expect.objectContaining({ operations: ['No Bake'], featureType: 'SimpleHole', count: 2, featureIds: ['h1', 'h2'], status: 'resolved',
      children: [{ operation: 'As Cored', featureType: 'CurvedWall' }, { operation: 'As Cored', featureType: 'Edge' }] })]);
    expect(moulding).toEqual([expect.objectContaining({ operations: ['Sand Casting'], featureType: 'SimpleHole', featureIds: ['h3'] })]);
  });

  it('without the casting analysis, a hole is undecided between moulding and coring, never guessed; faces are still As Cast', () => {
    const { moulding, coring } = run([f('h1', 'SimpleHole'), f('p1', 'PlanarFace')], false);
    const hole = moulding.find((o) => o.featureType === 'SimpleHole')!;
    expect(hole).toMatchObject({ status: 'undecided', operations: ['Sand Casting', 'No Bake'], featureIds: ['h1'] });
    expect(hole.reason).toMatch(/casting analysis/);
    expect(moulding.find((o) => o.featureType === 'PlanarFace')).toMatchObject({ status: 'resolved', operations: ['As Cast'] });
    expect(coring).toEqual([]);
  });

  it('leaves out a feature type neither process lists (the step does not make it)', () => {
    expect(run([f('x1', 'Thread')], true)).toEqual({ moulding: [], coring: [] });
  });

  it('has no coring operations when the route makes no cores', () => {
    const r = resolveSandCatalogOperations({ mouldingCatalog: MOULDING, coringCatalog: [], features: [f('h1', 'SimpleHole', 1)], coresLinked: true });
    expect(r.coring).toEqual([]);
    expect(r.moulding).toEqual([expect.objectContaining({ operations: ['Sand Casting'], featureType: 'SimpleHole' })]);
  });
});

// Real features from the casting analysis of the cannula end bearing housing (worker 0.17): SimpleHole:5 is formed by core 2; SimpleHole:3 is a
// step of MultiStepHole:1 (a child, part of its parent, not a feature of its own).
describe('sandFeaturesFromCastingResult', () => {
  const result = { parts: [{ features: [
    { id: 'SimpleHole:5', type: 'SimpleHole', parent: null, parameters: { diameter_mm: 2.529, through: 1, core: 2 } },
    { id: 'SimpleHole:1', type: 'SimpleHole', parent: null, parameters: { diameter_mm: 3.2, through: 1 } },
    { id: 'SimpleHole:3', type: 'SimpleHole', parent: 'MultiStepHole:1', parameters: { diameter_mm: 15 } },
    { id: 'MultiStepHole:1', type: 'MultiStepHole', parent: null, parameters: {} },
  ] }] };

  it('reads the top-level features with the core that forms each', () => {
    expect(sandFeaturesFromCastingResult(result)).toEqual([
      { id: 'SimpleHole:5', type: 'SimpleHole', core: 2, diameterMm: 2.529 },
      { id: 'SimpleHole:1', type: 'SimpleHole', core: null, diameterMm: 3.2 },
      { id: 'MultiStepHole:1', type: 'MultiStepHole', core: null, diameterMm: null },
    ]);
  });

  it('finds each feature on the cad-engine mesh by its face keys (worker 0.19.0), the child steps by their own faces', () => {
    const keys = ['cylinder|10.000|1.000|2.000|3.000', 'plane|20.000|4.000|5.000|6.000'];
    const withFaces = { parts: [{ face_keys: keys, features: [
      { id: 'SimpleHole:1', type: 'SimpleHole', parent: null, faces: [], edge_faces: [], parameters: { diameter_mm: 3.2 } },
      { id: 'CurvedWall:1', type: 'CurvedWall', parent: 'SimpleHole:1', faces: [0], edge_faces: [], parameters: {} },
      { id: 'Edge:1', type: 'Edge', parent: 'SimpleHole:1', faces: [], edge_faces: [0, 1], parameters: {} },
    ] }] };
    // The cad-engine numbers the two faces the other way round.
    const stable = { '0': stableFaceHash(keys[1]!), '1': stableFaceHash(keys[0]!) };
    const features = sandFeaturesFromCastingResult(withFaces, stable)!;
    expect(features).toEqual([expect.objectContaining({ id: 'SimpleHole:1', faces: { faces: [0, 1], childFaces: { CurvedWall: [1], Edge: [0, 1] } } })]);
    const { moulding } = run(features, true);
    const hole = moulding.find((o) => o.featureType === 'SimpleHole')!;
    expect(hole.featureFaceIds).toEqual([[0, 1]]);
    expect(hole.children).toEqual([{ operation: 'As Cast', featureType: 'Edge', featureFaceIds: [[0, 1]] }]);
  });

  it('gives no faces without face keys (a worker before 0.19.0): the row is listed, not highlighted', () => {
    const { moulding } = run(sandFeaturesFromCastingResult(result, { '0': 'abc' })!, true);
    expect(moulding.every((o) => o.featureFaceIds === undefined)).toBe(true);
  });

  it('is null for a result without parts or features (nothing to report, not "no features")', () => {
    expect(sandFeaturesFromCastingResult({})).toBeNull();
    expect(sandFeaturesFromCastingResult(null)).toBeNull();
  });
});
