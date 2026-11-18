import type { BOMItem, CostSummaryDto } from '@/lib/api/hooks/useBOMItems';
import type { FeatureGraph } from '@/lib/types/manufacturing';

/** The Process of a part machined from a cast blank derived from its own model (backend costing/two-model, migration 1067). */
export const TWO_MODEL_PROCESS_GROUP = '2-Model Machining';
/** The catalog operation of the features a part keeps as its blank made them (memory/"2 Mold Molding"). */
export const AS_SUPPLIED_STEP = 'Source Component: As Supplied';

export type SourceComponentSummary = NonNullable<CostSummaryDto['sourceComponent']>;

/** The Cost Guide key of the process the blank is made by (backend derived-blank.ts TWO_MODEL_BLANK_PROCESS_KEY), and its default. */
export const BLANK_PROCESS_KEY = 'twoModelBlankProcess';
export const DEFAULT_BLANK_PROCESS = 'Sand Casting';
/** The processes a blank can be derived for from the part's machined analysis (backend DERIVABLE_BLANK_FAMILY). */
export const DERIVABLE_BLANK_PROCESSES: readonly string[] = ['Sand Casting', 'Casting Investment'];

/** The blank process chosen in the Cost Guide, else the default. */
export function blankProcessOf(overrides: Record<string, unknown> | null | undefined): string {
  const v = overrides?.[BLANK_PROCESS_KEY];
  return typeof v === 'string' && v ? v : DEFAULT_BLANK_PROCESS;
}

/** The faces the part keeps as its derived blank made them: the features the blank's casting holds (the cost's machining need). */
export function asSuppliedFaceIdsOf(cost: Pick<CostSummaryDto, 'sourceComponent'> | null | undefined): number[] {
  return cost?.sourceComponent?.asSuppliedFaceIds ?? [];
}

/** Whether the part is costed as 2-Model Machining: its Process, or the cost the engine returned. */
export function isTwoModelPart(item: Pick<BOMItem, 'scenarioOverrides'>, cost: Pick<CostSummaryDto, 'family'> | null | undefined): boolean {
  return item.scenarioOverrides?.processGroup === TWO_MODEL_PROCESS_GROUP || cost?.family === 'two_model';
}

export interface AsSuppliedOccurrence { featureId: string; featureType: string; occurrenceIndex: number; faceIds: number[] }

/** The feature occurrences whose faces are all as supplied. They cost nothing; the rest are machined. */
export function asSuppliedOccurrences(fg: Pick<FeatureGraph, 'feature_graph_v2'> | null | undefined, asSuppliedFaceIds: readonly number[] | null | undefined): AsSuppliedOccurrence[] {
  if (!asSuppliedFaceIds?.length) return [];
  const set = new Set(asSuppliedFaceIds);
  return (fg?.feature_graph_v2?.features ?? []).flatMap((f) => f.occurrences.flatMap((o, i) => {
    const faces = o.face_ids;
    return faces.length > 0 && faces.every((id) => set.has(id)) ? [{ featureId: f.id, featureType: f.feature_type, occurrenceIndex: i, faceIds: faces }] : [];
  }));
}
