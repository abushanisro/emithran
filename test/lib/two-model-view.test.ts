import { describe, expect, it } from 'vitest';

import type { BOMItem, CostSummaryDto, StoredTwoModelComparison } from '@/lib/api/hooks/useBOMItems';
import { asSuppliedFaceIdsOf, asSuppliedOccurrences, blankProcessOf, comparisonState, consumersOf, currentComparison, isTwoModelPart, sourceCandidates, AS_SUPPLIED_STEP } from '@/lib/costing/two-model-view';
import { buildProcessTree } from '@/lib/features/process-tree';
import type { FeatureGraph, FeatureGraphSummary } from '@/lib/types/manufacturing';

const bi = (id: string, extra: Partial<BOMItem> = {}) => ({ id, name: id, fileStepPath: `${id}.step`, ...extra }) as BOMItem;
const result = (r: Partial<StoredTwoModelComparison['result']>) => ({
  comparison_version: '1', aligned: true, misalignment: null, target_volume_mm3: 1, source_volume_mm3: 2, ...r,
});
const stored = (r: Partial<StoredTwoModelComparison['result']> = {}): StoredTwoModelComparison =>
  ({ sourceItemId: 'casting', targetFile: 'part.step', sourceFile: 'casting.step', comparedAt: 'x', result: result(r) });

const fg = {
  classification: { family: 'milled' },
  feature_graph_v2: { features: [
    { id: 'face', feature_type: 'PlanarFace', occurrences: [{ face_ids: [1] }, { face_ids: [2] }] },
    { id: 'hole', feature_type: 'SimpleHole', occurrences: [{ face_ids: [3, 4] }] },
  ] },
} as unknown as FeatureGraph;

describe('2-Model Machining', () => {
  it('is the part whose Process is 2-Model Machining, or whose cost the engine priced as one', () => {
    expect(isTwoModelPart({ scenarioOverrides: { processGroup: '2-Model Machining' } }, null)).toBe(true);
    expect(isTwoModelPart({}, { family: 'two_model' })).toBe(true);
    expect(isTwoModelPart({ scenarioOverrides: { processGroup: 'Machining' } }, { family: 'milled' })).toBe(false);
  });

  it('offers as source the other items of the BOM with a STEP model, never one machined from the part', () => {
    const items = [bi('part'), bi('casting'), bi('drawing-only', { fileStepPath: undefined }), bi('child', { sourceItemId: 'part' })];
    expect(sourceCandidates(items, { id: 'part' }).map((i) => i.id)).toEqual(['casting']);
    expect(consumersOf([bi('part', { sourceItemId: 'casting' }), bi('casting')], 'casting').map((i) => i.id)).toEqual(['part']);
  });

  it('reads only a comparison made from the current link and files', () => {
    const part = { sourceItemId: 'casting', fileStepPath: 'part.step', twoModelComparison: stored() };
    expect(currentComparison(part, { fileStepPath: 'casting.step' })).not.toBeNull();
    expect(currentComparison(part, { fileStepPath: 'casting-v2.step' })).toBeNull();
    expect(currentComparison({ ...part, sourceItemId: 'other' }, { fileStepPath: 'casting.step' })).toBeNull();
  });

  it('says whether the models line up, never moving them to fit', () => {
    expect(comparisonState(null).tone).toBe('none');
    expect(comparisonState(stored({ aligned: false, misalignment: '12% of the part outside' })).text).toContain('12% of the part outside');
    expect(comparisonState(stored({ as_supplied_face_ids: [1, 2], machined_face_ids: [3] })).text).toBe('Aligned: 1 face machined, 2 left as supplied.');
  });

  it('leaves an occurrence as supplied only when every face of it lies on the source', () => {
    expect(asSuppliedOccurrences(fg, [1, 3]).map((o) => `${o.featureId}#${o.occurrenceIndex}`)).toEqual(['face#0']);
    expect(asSuppliedOccurrences(fg, [])).toEqual([]);
  });

  it('lists the as supplied occurrences under their own first step, and drops a feature from machining when all of it is supplied', () => {
    const item = { id: 'part', name: 'Housing', scenarioOverrides: { processGroup: '2-Model Machining' }, twoModelComparison: stored({ as_supplied_face_ids: [1, 2] }) } as unknown as BOMItem;
    const cost = {
      family: 'two_model', processLines: [{ process: '3 Axis Milling', cycleTimeMin: 1, machineName: 'VMC' }],
      sourceComponent: { itemId: 'casting', name: 'Housing casting', basis: 'fully_burdened', materialCost: 1, processCost: 1, toolingCost: 0, totalCost: 2, asSuppliedFeatures: 2, removedVolumeMm3: 10 },
    } as unknown as CostSummaryDto;
    const tree = buildProcessTree(item, fg, {} as FeatureGraphSummary, 'Plant A', undefined, cost);
    const ops = (tree.children ?? []).flatMap((g) => g.children ?? []);
    expect(ops[0]?.label).toBe(AS_SUPPLIED_STEP);
    expect(ops[0]?.children?.map((c) => c.v2Occurrences?.[0])).toEqual([{ featureId: 'face', occurrenceIndex: 0 }, { featureId: 'face', occurrenceIndex: 1 }]);
    const machinedIds = ops.slice(1).flatMap((o) => o.children ?? []).flatMap((c) => c.v2FeatureIds ?? []);
    expect(machinedIds).toContain('hole');
    expect(machinedIds).not.toContain('face');
  });

  it('derives a sand casting blank unless the Cost Guide says otherwise', () => {
    expect(blankProcessOf(undefined)).toBe('Sand Casting');
    expect(blankProcessOf({ twoModelBlankProcess: 'Casting Investment' })).toBe('Casting Investment');
  });

  it('takes a derived blank\'s as-supplied faces from the cost, a linked blank\'s from the comparison', () => {
    const derivedCost = { sourceComponent: { derived: true, asSuppliedFaceIds: [7] } } as unknown as CostSummaryDto;
    expect(asSuppliedFaceIdsOf(derivedCost, stored({ as_supplied_face_ids: [1] }))).toEqual([7]);
    expect(asSuppliedFaceIdsOf({ sourceComponent: { derived: false } } as unknown as CostSummaryDto, stored({ as_supplied_face_ids: [1] }))).toEqual([1]);
  });

  it('lists a derived blank\'s as-supplied occurrences in the tree, with no comparison stored', () => {
    const item = { id: 'part', name: 'Back cover', scenarioOverrides: { processGroup: '2-Model Machining' } } as unknown as BOMItem;
    const cost = {
      family: 'two_model', processLines: [{ process: 'Tapping', cycleTimeMin: 1, machineName: 'VMC' }],
      sourceComponent: { itemId: '', name: 'Back cover (derived sand casting blank)', derived: true, asSuppliedFaceIds: [1, 2], basis: 'fully_burdened', materialCost: 1, processCost: 1, toolingCost: 0, totalCost: 2, asSuppliedFeatures: 2, removedVolumeMm3: 0 },
    } as unknown as CostSummaryDto;
    const ops = (buildProcessTree(item, fg, {} as FeatureGraphSummary, 'Plant A', undefined, cost).children ?? []).flatMap((g) => g.children ?? []);
    expect(ops[0]?.label).toBe(AS_SUPPLIED_STEP);
    expect(ops[0]?.machine).toBe('Back cover (derived sand casting blank)');
  });
});

