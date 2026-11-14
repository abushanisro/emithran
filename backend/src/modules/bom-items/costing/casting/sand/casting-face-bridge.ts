/**
 * The casting analysis's faces on the cad-engine's mesh. The worker numbers faces in its own order (TopExp::MapShapes on the XCAF shape),
 * the 3D viewer shows the cad-engine's STL addressed by its face_map (TopExp_Explorer order on its own read of the file). Nothing guarantees
 * the two numberings agree, and a wrong face lit is worse than none, so faces are matched by geometry: the worker writes each face's key
 * (casting-worker 0.19.0 `face_keys`: "<surface>|<area>|<cx>|<cy>|<cz>", 3 decimals) and the cad-engine stores the sha256 of the same key
 * per face (`feature_graph_v2.metadata.stable_face_ids`, cad-engine/shared/stable_face_id.py). A face is matched only when its key's hash
 * names exactly one cad-engine face and no other worker face has the same hash; anything else stays unmatched, never guessed.
 */
import { createHash } from 'crypto';

/** The cad-engine's stable face id of a key: the first 16 hex characters of its sha256. */
export function stableFaceHash(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/**
 * The hashes a worker key may have on the cad-engine side. A coordinate that rounds to zero carries no sign worth keeping: the two engines
 * compute the same centroid to within rounding noise, and a component of ±1e-15 prints as "0.000" in one and "-0.000" in the other. Every
 * sign of such a component is tried (at most 2^4 keys); nothing else is loosened.
 */
function candidateHashes(key: string): string[] {
  const parts = key.split('|');
  let keys: string[][] = [[]];
  for (const p of parts) {
    const options = p === '0.000' || p === '-0.000' ? ['0.000', '-0.000'] : [p];
    keys = keys.flatMap((k) => options.map((o) => [...k, o]));
  }
  return keys.map((k) => stableFaceHash(k.join('|')));
}

/**
 * Worker face index -> cad-engine face_id, for the faces matched one to one. Null when either side has nothing to match by (a worker before
 * 0.19.0, or a cad-engine result without stable face ids).
 */
export function castingFaceBridge(
  faceKeys: readonly string[] | null | undefined,
  stableFaceIds: Readonly<Record<string, string>> | null | undefined,
): Map<number, number> | null {
  if (!faceKeys?.length || !stableFaceIds || Object.keys(stableFaceIds).length === 0) return null;
  const cadByHash = new Map<string, number[]>();
  for (const [id, hash] of Object.entries(stableFaceIds)) {
    const n = Number(id);
    if (Number.isInteger(n)) cadByHash.set(hash, [...(cadByHash.get(hash) ?? []), n]);
  }
  const candidates = faceKeys.map((k) => {
    const ids = new Set(candidateHashes(k).flatMap((h) => cadByHash.get(h) ?? []));
    return ids.size === 1 ? [...ids][0]! : null;
  });
  // A cad-engine face claimed by two worker faces belongs to neither.
  const claims = new Map<number, number>();
  for (const c of candidates) if (c != null) claims.set(c, (claims.get(c) ?? 0) + 1);
  const out = new Map<number, number>();
  candidates.forEach((c, i) => {
    if (c != null && claims.get(c) === 1) out.set(i, c);
  });
  return out;
}

export interface WorkerFeature {
  id: string;
  type: string;
  parent: string | null;
  faces: readonly number[];
  edgeFaces: readonly number[];
}

/** A feature's worker faces: its own, the faces at its edges, and those of every feature under it (a hole's walls and edges). */
function workerFacesOf(id: string, all: readonly WorkerFeature[], childrenOf: Map<string, WorkerFeature[]>): number[] {
  const f = all.find((x) => x.id === id);
  if (!f) return [];
  const out = new Set<number>([...f.faces, ...f.edgeFaces]);
  for (const c of childrenOf.get(id) ?? []) for (const n of workerFacesOf(c.id, all, childrenOf)) out.add(n);
  return [...out];
}

export interface FeatureCadFaces {
  /** cad-engine face_ids of the whole feature, sorted. */
  faces: number[];
  /** cad-engine face_ids of the features under it, by their type ("Edge", "CurvedWall"), sorted. */
  childFaces: Record<string, number[]>;
}

/**
 * The cad-engine faces of each feature (by id), and how many of the worker faces the features use found a cad-engine face. Only features with
 * at least one matched face are listed.
 */
export function featureCadFaces(
  features: readonly WorkerFeature[],
  bridge: ReadonlyMap<number, number>,
): { byFeature: Map<string, FeatureCadFaces>; used: number; matched: number } {
  const childrenOf = new Map<string, WorkerFeature[]>();
  for (const f of features) if (f.parent) childrenOf.set(f.parent, [...(childrenOf.get(f.parent) ?? []), f]);
  const toCad = (faces: readonly number[]) =>
    [...new Set(faces.map((n) => bridge.get(n)).filter((n): n is number => n != null))].sort((a, b) => a - b);
  const byFeature = new Map<string, FeatureCadFaces>();
  const used = new Set<number>();
  for (const f of features) {
    const own = workerFacesOf(f.id, features, childrenOf);
    own.forEach((n) => used.add(n));
    const faces = toCad(own);
    if (faces.length === 0) continue;
    // Faces of each type below the feature, at any depth, each with everything under it (a multi-step hole's step is a SimpleHole with no
    // faces of its own: its walls and edges are what show it).
    const workerByType = new Map<string, number[]>();
    const walk = (id: string) => {
      for (const c of childrenOf.get(id) ?? []) {
        workerByType.set(c.type, [...(workerByType.get(c.type) ?? []), ...workerFacesOf(c.id, features, childrenOf)]);
        walk(c.id);
      }
    };
    walk(f.id);
    const childFaces: Record<string, number[]> = {};
    for (const [type, ws] of workerByType) {
      const cad = toCad(ws);
      if (cad.length > 0) childFaces[type] = cad;
    }
    byFeature.set(f.id, { faces, childFaces });
  }
  const matched = [...used].filter((n) => bridge.has(n)).length;
  return { byFeature, used: used.size, matched };
}
