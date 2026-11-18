import { withSourceComponent, twoModelGapSummary, TWO_MODEL_PROCESS_GROUP } from '../../../../../modules/bom-items/costing/two-model/two-model-cost';
import { costedProcessGroups } from '../../../../../modules/bom-items/costing/shared/core/part-family-process-group';
import type { CostSummaryDto } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';

describe('2-Model Machining', () => {
  it('is a costed process group (the folder name "2 Mold Molding" mapped to no family)', () => {
    expect(costedProcessGroups()).toContain(TWO_MODEL_PROCESS_GROUP);
    expect(costedProcessGroups()).not.toContain('2 Mold Molding');
  });

  it('makes the source the material: no bar stock blank, total = source + machining', () => {
    const machined = {
      materialCost: 40, materialCostPerKg: 4, grossWeightKg: 1.5, totalProcessCost: 25, totalCost: 65, blankSpec: { kind: 'bar' },
      processLines: [], warnings: ['Bar stock allowance 3 mm', 'kept'], family: 'milled',
    } as unknown as CostSummaryDto;
    const source = { itemId: '', name: 'Housing (derived sand casting blank)', basis: 'fully_burdened' as const, materialCost: 10, processCost: 5, toolingCost: 1, totalCost: 16, massKg: 2 };
    const out = withSourceComponent(machined, source, { asSuppliedCount: 3, removedVolumeMm3: 1200, warnings: [] }) as any;
    expect(out.blankSpec).toBeUndefined();
    expect(out.materialCost).toBe(16);
    expect(out.totalCost).toBe(41);
    expect(out.grossWeightKg).toBe(2);
    expect(out.family).toBe('two_model');
    expect(out.sourceComponent).toMatchObject({ totalCost: 16, asSuppliedFeatures: 3, removedVolumeMm3: 1200 });
    expect(out.warnings).toContain('kept');
    expect(out.warnings.some((w: string) => /bar stock/i.test(w))).toBe(false);
  });

  it('names the gap instead of pricing from bar stock', () => {
    const gap = twoModelGapSummary('a forging blank cannot be derived', { materialGrade: null, batchSize: 10, ratesSource: 'db' });
    expect(gap.totalCost).toBe(0);
    expect((gap.processLines[0].physicsGap as { reason: string }).reason).toContain('a forging blank cannot be derived');
  });
});
