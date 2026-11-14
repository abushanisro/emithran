// Which feature_graph_v2 occurrence a CAD feature is. The machining recogniser lists one feature per hole (machining_features,
// "bore_4"); feature_graph_v2, which the 3D viewer highlights, groups them ("SimpleHole-blind_d4.0_c4", one occurrence per hole). Both
// carry the CAD face ids they were recognised on, so a feature is the occurrence it shares a face with: an exact link, never a match by
// diameter or position. Pure.
import type { SourceRef } from '../../dto/cost-breakdown.dto';

export interface FeatureOccurrenceRef {
  featureId: string;
  occurrenceIndex: number;
}

type GraphFeature = { id?: unknown; occurrences?: ReadonlyArray<{ face_ids?: readonly unknown[] }> };

/** face id -> the feature_graph_v2 occurrence that face belongs to (the first, when two occurrences list the same face). */
export function occurrenceByFace(features: ReadonlyArray<GraphFeature> | null | undefined): Map<number, FeatureOccurrenceRef> {
  const out = new Map<number, FeatureOccurrenceRef>();
  for (const f of features ?? []) {
    if (typeof f.id !== 'string') continue;
    (f.occurrences ?? []).forEach((o, occurrenceIndex) => {
      for (const face of o.face_ids ?? []) {
        if (typeof face === 'number' && !out.has(face)) out.set(face, { featureId: f.id as string, occurrenceIndex });
      }
    });
  }
  return out;
}

/** The occurrences a feature's faces belong to, each once, in face order. */
export function occurrencesOfFaces(faceIds: readonly unknown[] | null | undefined, byFace: ReadonlyMap<number, FeatureOccurrenceRef>): FeatureOccurrenceRef[] {
  const seen = new Set<string>();
  const out: FeatureOccurrenceRef[] = [];
  for (const face of faceIds ?? []) {
    const o = typeof face === 'number' ? byFace.get(face) : undefined;
    if (!o) continue;
    const key = `${o.featureId}#${o.occurrenceIndex}`;
    if (!seen.has(key)) { seen.add(key); out.push(o); }
  }
  return out;
}

/** The calculator dialog's ref for a value counted or measured on these occurrences; undefined when none is known. */
export function featuresRef(label: string, occurrences: readonly FeatureOccurrenceRef[] | null | undefined): SourceRef | undefined {
  return occurrences && occurrences.length > 0 ? { kind: 'features', label, features: occurrences.map((o) => ({ ...o })) } : undefined;
}
