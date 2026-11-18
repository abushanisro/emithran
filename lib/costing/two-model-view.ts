import type { BOMItem, CostSummaryDto, StoredTwoModelComparison } from '@/lib/api/hooks/useBOMItems';
import type { FeatureGraph } from '@/lib/types/manufacturing';

/** The Process of a part machined from a source component (backend costing/two-model, migration 1067). */
export const TWO_MODEL_PROCESS_GROUP = '2-Model Machining';
/** The catalog operation of the features a part keeps as its source made them (memory/"2 Mold Molding"). */
export const AS_SUPPLIED_STEP = 'Source Component: As Supplied';

export type SourceComponentSummary = NonNullable<CostSummaryDto['sourceComponent']>;

/** Whether the part is costed as 2-Model Machining: its Process, or the cost the engine returned. */
export function isTwoModelPart(item: Pick<BOMItem, 'scenarioOverrides'>, cost: Pick<CostSummaryDto, 'family'> | null | undefined): boolean {
  return item.scenarioOverrides?.processGroup === TWO_MODEL_PROCESS_GROUP || cost?.family === 'two_model';
}

/**
 * The items the part can be machined from: the others of its BOM with a STEP model, never the part itself nor one machined from it (the
 * backend refuses both, migration 1066).
 */
export function sourceCandidates(items: readonly BOMItem[], part: Pick<BOMItem, 'id'>): BOMItem[] {
  return items.filter((i) => i.id !== part.id && !!i.fileStepPath && i.sourceItemId !== part.id);
}

/** The parts machined from an item: an item they name is counted inside them, not again in the BOM total. */
export function consumersOf(items: readonly BOMItem[], itemId: string): BOMItem[] {
  return items.filter((i) => i.sourceItemId === itemId);
}

/** The stored comparison when it was made from the part's current link and files (backend currentComparison), else null. */
export function currentComparison(item: Pick<BOMItem, 'sourceItemId' | 'fileStepPath' | 'twoModelComparison'>, source: Pick<BOMItem, 'fileStepPath'> | null | undefined): StoredTwoModelComparison | null {
  const c = item.twoModelComparison;
  if (!c || !item.sourceItemId || c.sourceItemId !== item.sourceItemId) return null;
  if (c.targetFile !== item.fileStepPath || c.sourceFile !== source?.fileStepPath) return null;
  return c;
}

/** What the comparison says, in one line for the Cost Guide. */
export function comparisonState(c: StoredTwoModelComparison | null): { tone: 'ok' | 'warn' | 'none'; text: string } {
  if (!c) return { tone: 'none', text: 'Not compared yet: link a source with a STEP model, or press Refresh analysis.' };
  const r = c.result;
  if (!r.aligned) return { tone: 'warn', text: `Not aligned: ${r.misalignment ?? 'the part lies outside its source'}. Export both models from the same assembly.` };
  const supplied = r.as_supplied_face_ids?.length ?? 0;
  const machined = r.machined_face_ids?.length ?? 0;
  return { tone: 'ok', text: `Aligned: ${machined} face${machined === 1 ? '' : 's'} machined, ${supplied} left as supplied.` };
}

export interface AsSuppliedOccurrence { featureId: string; featureType: string; occurrenceIndex: number; faceIds: number[] }

/**
 * The feature occurrences the part keeps as its source made them: every face on the source (the backend's machinedOnlyFeatureGraph). They
 * cost nothing; the rest are machined.
 */
export function asSuppliedOccurrences(fg: Pick<FeatureGraph, 'feature_graph_v2'> | null | undefined, asSuppliedFaceIds: readonly number[] | null | undefined): AsSuppliedOccurrence[] {
  if (!asSuppliedFaceIds?.length) return [];
  const set = new Set(asSuppliedFaceIds);
  return (fg?.feature_graph_v2?.features ?? []).flatMap((f) => f.occurrences.flatMap((o, i) => {
    const faces = o.face_ids;
    return faces.length > 0 && faces.every((id) => set.has(id)) ? [{ featureId: f.id, featureType: f.feature_type, occurrenceIndex: i, faceIds: faces }] : [];
  }));
}
