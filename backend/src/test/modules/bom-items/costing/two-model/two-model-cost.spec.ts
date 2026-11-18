import {
  machinedOnlyFeatureGraph, sourceComponentCost, withSourceComponent, twoModelGapSummary, TWO_MODEL_PROCESS_GROUP,
} from '../../../../../modules/bom-items/costing/two-model/two-model-cost';
import { currentComparison } from '../../../../../modules/bom-items/services/two-model.service';
import { costedProcessGroups } from '../../../../../modules/bom-items/costing/shared/core/part-family-process-group';
import type { CostSummaryDto } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';

describe('2-Model Machining', () => {
  it('is a costed process group (the folder name "2 Mold Molding" mapped to no family)', () => {
    expect(costedProcessGroups()).toContain(TWO_MODEL_PROCESS_GROUP);
    expect(costedProcessGroups()).not.toContain('2 Mold Molding');
  });

  describe('machinedOnlyFeatureGraph', () => {
    const fg = {
      feature_graph_v2: { features: [
        { id: 'h1', feature_type: 'hole', occurrences: [{ face_ids: [1, 2] }, { face_ids: [3] }] },
        { id: 'p1', feature_type: 'planar_face', occurrences: [{ face_ids: [4] }] },
        { id: 'x1', feature_type: 'pocket', occurrences: [{}] },
      ] },
      machining_features: { features: [{ id: 'l1', type: 'hole', face_ids: [1, 2] }, { id: 'l2', type: 'slot', face_ids: [9] }] },
    };

    it('drops the occurrences whose faces all lie on the source and keeps the machined ones', () => {
      const { fg: out, asSupplied } = machinedOnlyFeatureGraph(fg, [1, 2, 4]);
      expect(out.feature_graph_v2.features.map((f: any) => [f.id, f.occurrences.length])).toEqual([['h1', 1], ['x1', 1]]);
      expect(out.machining_features.features.map((f: any) => f.id)).toEqual(['l2']);
      expect(asSupplied.map((a) => a.featureId)).toEqual(['h1', 'p1']);
    });

    it('treats an occurrence partly on the source, or with no faces, as machined', () => {
      const { asSupplied } = machinedOnlyFeatureGraph(fg, [1]);
      expect(asSupplied).toEqual([]);
    });
  });

  it('brings the source cost to the part currency and adds its tooling per part only when fully burdened', () => {
    const summary = {
      materialCost: 830, totalProcessCost: 415, totalCost: 1245, grossWeightKg: 2, usdToDisplayRate: 83,
      family: 'sand_casting', tooling: undefined, dieTooling: undefined, coreboxTooling: undefined, patternTooling: undefined, forgingDies: undefined,
    } as any;
    const fb = sourceComponentCost({ itemId: 's', name: 'Casting', summary, fullyBurdened: true, usdToLocal: 1 });
    expect([fb.materialCost, fb.processCost, fb.toolingCost, fb.totalCost, fb.massKg]).toEqual([10, 5, 0, 15, 2]);
    const pp = sourceComponentCost({ itemId: 's', name: 'Casting', summary, fullyBurdened: false, usdToLocal: 83 });
    expect(pp.basis).toBe('piece_part');
    expect(pp.totalCost).toBeCloseTo(1245);
  });

  it('makes the source the material: no bar stock blank, total = source + machining', () => {
    const machined = {
      materialCost: 40, materialCostPerKg: 4, grossWeightKg: 1.5, totalProcessCost: 25, totalCost: 65, blankSpec: { kind: 'bar' },
      processLines: [], warnings: ['Bar stock allowance 3 mm', 'kept'], family: 'milled',
    } as unknown as CostSummaryDto;
    const source = { itemId: 's', name: 'Casting', basis: 'fully_burdened' as const, materialCost: 10, processCost: 5, toolingCost: 1, totalCost: 16, massKg: 2 };
    const out = withSourceComponent(machined, source, { asSuppliedCount: 3, removedVolumeMm3: 1200, warnings: [] }) as any;
    expect(out.blankSpec).toBeUndefined();
    expect(out.materialCost).toBe(16);
    expect(out.totalCost).toBe(41);
    expect(out.grossWeightKg).toBe(2);
    expect(out.family).toBe('two_model');
    expect(out.sourceComponent).toMatchObject({ itemId: 's', totalCost: 16, asSuppliedFeatures: 3, removedVolumeMm3: 1200 });
    expect(out.warnings).toContain('kept');
    expect(out.warnings.some((w: string) => /bar stock/i.test(w))).toBe(false);
  });

  it('names the gap instead of pricing from bar stock', () => {
    const gap = twoModelGapSummary('no source component', { materialGrade: null, batchSize: 10, ratesSource: 'db' });
    expect(gap.totalCost).toBe(0);
    expect((gap.processLines[0].physicsGap as { reason: string }).reason).toContain('no source component');
  });

  describe('currentComparison', () => {
    const stored = { sourceItemId: 's', targetFile: 't.step', sourceFile: 's.step', comparedAt: 'x', result: {} as any };
    it('reads only a comparison made from the current link and files', () => {
      expect(currentComparison({ sourceItemId: 's', fileStepPath: 't.step', twoModelComparison: stored }, 's.step')).toEqual({ comparison: stored });
      expect('missing' in currentComparison({ sourceItemId: 's', fileStepPath: 't.step', twoModelComparison: stored }, 's2.step')).toBe(true);
      expect('missing' in currentComparison({ sourceItemId: null, fileStepPath: 't.step', twoModelComparison: stored }, 's.step')).toBe(true);
      expect('missing' in currentComparison({ sourceItemId: 's', fileStepPath: null, twoModelComparison: null }, 's.step')).toBe(true);
    });
  });
});
