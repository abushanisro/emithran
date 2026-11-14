/**
 * The instances a machining DFM finding points at, as the node the viewer highlights: the same occurrences
 * (centroid and faces) the feature tree highlights. A finding about the part as a whole points at nothing.
 */
import type { FeatureNodeV2 } from '@/lib/types/manufacturing';

interface FindingRef { rule: string; severity: string; occurrences: readonly { featureId: string; occurrenceIndex: number }[] }

export function machiningDfmHighlight(finding: FindingRef, features: readonly FeatureNodeV2[]): FeatureNodeV2 | null {
  const byId = new Map(features.map((f) => [f.id, f]));
  const hit = finding.occurrences.flatMap((ref) => {
    const feature = byId.get(ref.featureId);
    const occurrence = feature?.occurrences[ref.occurrenceIndex];
    return feature && occurrence ? [{ feature, occurrence }] : [];
  });
  const first = hit[0];
  if (!first) return null;
  return {
    id: `dfm_${finding.rule}_${finding.severity}`,
    feature_type: first.feature.feature_type,
    occurrences: hit.map(({ occurrence }) => ({ centroid: occurrence.centroid, face_ids: occurrence.face_ids })),
  };
}
