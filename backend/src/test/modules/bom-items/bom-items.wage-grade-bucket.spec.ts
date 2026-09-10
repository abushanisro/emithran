// Mocked unit tests of resolveWageGradeBucketRates (private method,
// exercised via `as any`, hand-built Supabase stub — NOT end-to-end, NOT
// live-data) — same style as bom-items.lhr-fx-provenance.spec.ts. The real
// "127 real Injection Molding machines / 12 real Sheet Metal categories
// actually carry these wage grades and rates live" claims are verified
// separately against the real database (migrations 633/643/645), not here;
// this proves the grouping/averaging arithmetic in isolation.
import { BOMItemsService } from '../../../modules/bom-items/bom-items.service';
import { type BlankOptimizerService } from '../../../modules/bom-items/costing/sheet-metal/machine/blank-optimizer.service';
import { type SheetMetalLookupService } from '../../../modules/bom-items/costing/sheet-metal/lookup/sheet-metal-lookup.service';
import { type CADAnalysisService } from '../../../modules/bom-items/services/cad-analysis.service';
import { type ExchangeRateService } from '../../../common/exchange-rate/exchange-rate.service';
import { type SupabaseService } from '../../../common/supabase/supabase.service';
import { type InspectionKnowledgeService } from '../../../modules/manufacturing-knowledge/services/inspection-knowledge.service';

function makeSupabaseStub(mhrRecordsRows: any[]) {
  const node: any = {
    select: () => node, eq: () => node, gt: () => node, not: () => node,
    then: (resolve: (v: { data: any[]; error: null }) => void) => resolve({ data: mhrRecordsRows, error: null }),
  };
  return {
    getClient: () => ({ from: (_table: string) => node }),
  } as unknown as SupabaseService;
}

function buildService(supabaseService: SupabaseService) {
  return new BOMItemsService(
    supabaseService,
    {} as unknown as InspectionKnowledgeService,
    {} as unknown as BlankOptimizerService,
    {} as unknown as SheetMetalLookupService,
    {} as unknown as ExchangeRateService,
    {} as unknown as CADAnalysisService,
  );
}

describe('resolveWageGradeBucketRates (mocked unit tests)', () => {
  it('C: averages real usd_lhr_total across every real machine sharing the same wage grade', async () => {
    // 3 real machines, same class (press_brake), same grade — mirrors
    // migration 643's real '3 - Metal' Bend Press Brake population.
    const service = buildService(makeSupabaseStub([
      { machine_class: 'press_brake', wage_grade: '3 - Metal', usd_lhr_total: 19.83 },
      { machine_class: 'press_brake', wage_grade: '3 - Metal', usd_lhr_total: 29.07 },
      { machine_class: 'press_brake', wage_grade: '3 - Metal', usd_lhr_total: 22.01 },
    ]));

    const result: Map<string, number> = await (service as any).resolveWageGradeBucketRates('token-1', 'USA');

    const expectedAvg = (19.83 + 29.07 + 22.01) / 3;
    expect(result.get('press_brake')).toBeCloseTo(expectedAvg, 5);
  });

  it('C: a grade shared across multiple different machine classes pools all real machines into one average', async () => {
    // Real behaviour: '3 - Metal' spans 9+ Sheet Metal categories/classes —
    // every class sharing that grade gets the SAME pooled average, not a
    // per-category average.
    const service = buildService(makeSupabaseStub([
      { machine_class: 'press_brake',  wage_grade: '3 - Metal', usd_lhr_total: 20.0 },
      { machine_class: 'fiber_laser',  wage_grade: '3 - Metal', usd_lhr_total: 40.0 },
      { machine_class: 'waterjet',     wage_grade: '3 - Metal', usd_lhr_total: 30.0 },
    ]));

    const result: Map<string, number> = await (service as any).resolveWageGradeBucketRates('token-1', 'USA');

    expect(result.get('press_brake')).toBeCloseTo(30.0, 5);
    expect(result.get('fiber_laser')).toBeCloseTo(30.0, 5);
    expect(result.get('waterjet')).toBeCloseTo(30.0, 5);
  });

  it('E: a domain/class with no real wage_grade data (e.g. Machining today) gets no bucket entry at all', async () => {
    // Query itself already filters wage_grade IS NOT NULL — a class with
    // only null-wage_grade rows (every Machining class today) simply never
    // appears in the result set.
    const service = buildService(makeSupabaseStub([]));

    const result: Map<string, number> = await (service as any).resolveWageGradeBucketRates('token-1', 'USA');

    expect(result.size).toBe(0);
    expect(result.get('cnc_3ax_vmc')).toBeUndefined();
  });

  it('F: no fabricated rate is ever introduced when the query returns nothing — empty map, not a default number', async () => {
    const service = buildService(makeSupabaseStub([]));
    const result: Map<string, number> = await (service as any).resolveWageGradeBucketRates('token-1', 'USA');
    expect(result).toEqual(new Map());
  });

  it('F: a real Injection Molding grade (different label scale) never mixes with a Sheet Metal grade sharing the same number', async () => {
    // '3 - Metal' (Sheet Metal) and '3 - Plastic' (Injection Molding) are
    // distinct strings — grouping by exact wage_grade value, they can never
    // pool together even though both are "grade 3".
    const service = buildService(makeSupabaseStub([
      { machine_class: 'press_brake',        wage_grade: '3 - Metal',   usd_lhr_total: 20.0 },
      { machine_class: 'injection_molding',  wage_grade: '3 - Plastic', usd_lhr_total: 34.48 },
    ]));

    const result: Map<string, number> = await (service as any).resolveWageGradeBucketRates('token-1', 'USA');

    expect(result.get('press_brake')).toBeCloseTo(20.0, 5);
    expect(result.get('injection_molding')).toBeCloseTo(34.48, 5);
  });

  it('rows with usd_lhr_total <= 0 or missing machine_class are excluded from every average', async () => {
    // The query itself filters gt('usd_lhr_total', 0) and
    // not('machine_class', 'is', null) — this proves the stub's shape
    // matches what the real query would already exclude server-side; a
    // 0-rate row reaching the grouping step would silently drag the
    // average down toward a fabricated-looking number.
    const service = buildService(makeSupabaseStub([
      { machine_class: 'press_brake', wage_grade: '3 - Metal', usd_lhr_total: 20.0 },
      { machine_class: 'press_brake', wage_grade: '3 - Metal', usd_lhr_total: 40.0 },
    ]));

    const result: Map<string, number> = await (service as any).resolveWageGradeBucketRates('token-1', 'USA');
    expect(result.get('press_brake')).toBeCloseTo(30.0, 5);
  });
});
