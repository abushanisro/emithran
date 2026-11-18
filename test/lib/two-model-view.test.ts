import { describe, expect, it } from 'vitest';

import type { BOMItem, CostSummaryDto } from '@/lib/api/hooks/useBOMItems';
import { asSuppliedFaceIdsOf, asSuppliedOccurrences, isTwoModelPart, AS_SUPPLIED_STEP } from '@/lib/costing/two-model-view';
import { buildProcessTree } from '@/lib/features/process-tree';
import type { FeatureGraph, FeatureGraphSummary } from '@/lib/types/manufacturing';

const fg = {
  classification: { family: 'milled' },
  feature_graph_v2: { features: [
    { id: 'face', feature_type: 'PlanarFace', occurrences: [{ face_ids: [1] }, { face_ids: [2] }] },
    { id: 'hole', feature_type: 'SimpleHole', occurrences: [{ face_ids: [3, 4] }] },
  ] },
} as unknown as FeatureGraph;

const derivedCost = (asSuppliedFaceIds: number[]) => ({
  family: 'two_model', processLines: [{ process: 'Tapping', cycleTimeMin: 1, machineName: 'VMC' }],
  sourceComponent: {
    itemId: '', name: 'Back cover (derived sand casting blank)', derived: true, blankProcess: 'Sand Casting', asSuppliedFaceIds,
    basis: 'fully_burdened', materialCost: 1, processCost: 1, toolingCost: 0, totalCost: 2, asSuppliedFeatures: 2, removedVolumeMm3: 0,
  },
}) as unknown as CostSummaryDto;

describe('2-Model Machining', () => {
  it('is the part whose Process is 2-Model Machining, or whose cost the engine priced as one', () => {
    expect(isTwoModelPart({ scenarioOverrides: { processGroup: '2-Model Machining' } }, null)).toBe(true);
    expect(isTwoModelPart({}, { family: 'two_model' })).toBe(true);
    expect(isTwoModelPart({ scenarioOverrides: { processGroup: 'Machining' } }, { family: 'milled' })).toBe(false);
  });

  it('leaves an occurrence as supplied only when every face of it is one the blank holds', () => {
    expect(asSuppliedOccurrences(fg, [1, 3]).map((o) => `${o.featureId}#${o.occurrenceIndex}`)).toEqual(['face#0']);
    expect(asSuppliedOccurrences(fg, [])).toEqual([]);
    expect(asSuppliedFaceIdsOf(derivedCost([7]))).toEqual([7]);
    expect(asSuppliedFaceIdsOf(null)).toEqual([]);
  });

  it('lists the as supplied occurrences under their own first step, and drops a feature from machining when all of it is supplied', () => {
    const item = { id: 'part', name: 'Back cover', scenarioOverrides: { processGroup: '2-Model Machining' } } as unknown as BOMItem;
    const ops = (buildProcessTree(item, fg, {} as FeatureGraphSummary, 'Plant A', undefined, derivedCost([1, 2])).children ?? []).flatMap((g) => g.children ?? []);
    expect(ops[0]?.label).toBe(AS_SUPPLIED_STEP);
    expect(ops[0]?.machine).toBe('Back cover (derived sand casting blank)');
    expect(ops[0]?.children?.map((c) => c.v2Occurrences?.[0])).toEqual([{ featureId: 'face', occurrenceIndex: 0 }, { featureId: 'face', occurrenceIndex: 1 }]);
    const machinedIds = ops.slice(1).flatMap((o) => o.children ?? []).flatMap((c) => c.v2FeatureIds ?? []);
    expect(machinedIds).toContain('hole');
    expect(machinedIds).not.toContain('face');
  });
});
