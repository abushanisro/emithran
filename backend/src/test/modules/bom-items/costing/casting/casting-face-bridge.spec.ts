import { castingFaceBridge, featureCadFaces, stableFaceHash, type WorkerFeature } from '../../../../../modules/bom-items/costing/casting/sand/casting-face-bridge';

// The cad-engine's stable ids are sha256(key)[:16] of the same "<surface>|<area>|<cx>|<cy>|<cz>" key the worker writes (stable_face_id.py).
const ids = (keys: string[], order: number[] = keys.map((_, i) => i)) =>
  Object.fromEntries(order.map((cadId, i) => [String(cadId), stableFaceHash(keys[i]!)]));

describe('castingFaceBridge', () => {
  it('matches faces by geometry, not by index: a worker face finds the cad-engine face with its key wherever it is numbered', () => {
    const keys = ['plane|100.000|0.000|0.000|10.000', 'cylinder|62.832|5.000|5.000|5.000', 'plane|50.000|1.000|2.000|3.000'];
    // The cad-engine numbers the same three faces 7, 3, 9.
    const bridge = castingFaceBridge(keys, ids(keys, [7, 3, 9]));
    expect([...bridge!.entries()]).toEqual([[0, 7], [1, 3], [2, 9]]);
  });

  it('treats a coordinate that rounds to zero as unsigned (the cannula housing: -0.000 in the cad-engine, 0.000 in the worker)', () => {
    const cad = { '87': stableFaceHash('cone|14.717|-0.000|11.376|3.500') };
    expect([...castingFaceBridge(['cone|14.717|0.000|11.376|3.500'], cad)!.entries()]).toEqual([[0, 87]]);
  });

  it('never loosens anything else: a different area does not match', () => {
    const cad = { '0': stableFaceHash('plane|100.001|0.000|0.000|10.000') };
    expect(castingFaceBridge(['plane|100.000|0.000|0.000|10.000'], cad)!.size).toBe(0);
  });

  it('leaves a face unmatched when its key names two cad-engine faces, or two worker faces name one', () => {
    const k = 'plane|1.000|0.000|0.000|0.000';
    expect(castingFaceBridge([k], { '0': stableFaceHash(k), '1': stableFaceHash(k) })!.size).toBe(0);
    expect(castingFaceBridge([k, k], { '0': stableFaceHash(k) })!.size).toBe(0);
  });

  it('is null when either side has nothing to match by (a worker before 0.19.0, or no stable face ids)', () => {
    expect(castingFaceBridge(undefined, { '0': 'x' })).toBeNull();
    expect(castingFaceBridge(['plane|1.000|0.000|0.000|0.000'], null)).toBeNull();
    expect(castingFaceBridge(['plane|1.000|0.000|0.000|0.000'], {})).toBeNull();
  });
});

describe('featureCadFaces', () => {
  const f = (id: string, faces: number[] = [], parent: string | null = null, edgeFaces: number[] = []): WorkerFeature =>
    ({ id, type: id.split(':')[0]!, parent, faces, edgeFaces });
  // Worker face n is cad-engine face n + 100, except worker face 5, which found no match.
  const bridge = new Map([0, 1, 2, 3, 4, 6].map((n) => [n, n + 100]));

  it('gives a hole the faces of everything under it, and each child type its own (a hole has no faces of its own)', () => {
    const features = [
      f('SimpleHole:1'),
      f('CurvedWall:1', [0], 'SimpleHole:1'),
      f('Edge:1', [], 'SimpleHole:1', [0, 1]),
      f('PlanarFace:1', [2]),
    ];
    const { byFeature } = featureCadFaces(features, bridge);
    expect(byFeature.get('SimpleHole:1')).toEqual({ faces: [100, 101], childFaces: { CurvedWall: [100], Edge: [100, 101] } });
    expect(byFeature.get('PlanarFace:1')).toEqual({ faces: [102], childFaces: {} });
  });

  it('collects descendants at any depth (a multi-step hole\'s steps\' walls)', () => {
    const features = [f('MultiStepHole:1'), f('SimpleHole:2', [], 'MultiStepHole:1'), f('CurvedWall:2', [3], 'SimpleHole:2')];
    expect(featureCadFaces(features, bridge).byFeature.get('MultiStepHole:1')).toEqual({
      faces: [103], childFaces: { SimpleHole: [103], CurvedWall: [103] },
    });
  });

  it('shows a sharp edge by the faces meeting at it', () => {
    expect(featureCadFaces([f('SharpEdge:1', [], null, [4, 6])], bridge).byFeature.get('SharpEdge:1')!.faces).toEqual([104, 106]);
  });

  it('counts the worker faces used and matched, and lists no feature whose faces all went unmatched', () => {
    const r = featureCadFaces([f('PlanarFace:1', [5]), f('PlanarFace:2', [4])], bridge);
    expect(r.byFeature.has('PlanarFace:1')).toBe(false);
    expect({ used: r.used, matched: r.matched }).toEqual({ used: 2, matched: 1 });
  });
});
