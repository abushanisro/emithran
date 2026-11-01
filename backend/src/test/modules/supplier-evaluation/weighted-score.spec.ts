import { computeWeightedScore, SupplierEvaluationService } from '../../../modules/supplier-evaluation/supplier-evaluation.service';

const evaluation = { technical_total_score: 350, technical_max_score: 700, cost_competitiveness_score: 80, vendor_rating_score: 60 };

describe('computeWeightedScore', () => {
  it('keeps a real 0 weight instead of replacing it with a default', () => {
    const r = computeWeightedScore(evaluation, { cost_competency_weight: 0, vendor_rating_weight: 50, technical_capability_weight: 50 });
    expect(r.weightedScore).toBeCloseTo(60 * 0.5 + 50 * 0.5, 9);
    expect(r.assumptions).toEqual([]);
  });

  it('uses the schema defaults when no weights row exists, and reports them', () => {
    const r = computeWeightedScore(evaluation, null);
    expect(r.weightedScore).toBeCloseTo(80 * 0.3 + 60 * 0.3 + 50 * 0.4, 9);
    expect(r.assumptions).toEqual([expect.stringContaining('no evaluation_criteria_weights row')]);
  });

  it('gives no score (not a division by zero, not a silent 700) for a 0 technical max score', () => {
    const r = computeWeightedScore({ ...evaluation, technical_max_score: 0 }, { cost_competency_weight: 30, vendor_rating_weight: 30, technical_capability_weight: 40 });
    expect(r.weightedScore).toBeNull();
    expect(r.assumptions[0]).toContain('technical max score is 0');
  });

  it('reports a missing technical max score default', () => {
    const r = computeWeightedScore({ ...evaluation, technical_max_score: null }, { cost_competency_weight: 30, vendor_rating_weight: 30, technical_capability_weight: 40 });
    expect(r.weightedScore).toBeCloseTo(80 * 0.3 + 60 * 0.3 + 50 * 0.4, 9);
    expect(r.assumptions).toEqual([expect.stringContaining('technical max score not set')]);
  });
});

describe('SupplierEvaluationService.calculateWeightedScore', () => {
  it('throws when the weights read fails instead of silently using defaults', async () => {
    const q: any = {
      from: () => q, select: () => q, eq: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => ({ data: null, error: { message: 'denied' } }),
    };
    const logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
    const service = new (SupplierEvaluationService as any)({ getClient: () => q }, logger);
    await expect(service.calculateWeightedScore({ id: 'e1', project_id: 'p1' }, 'u1', 't')).rejects.toThrow('denied');
  });
});
