// Focused, heavily-mocked unit tests for the Currency & Ask Price scenario
// currency conversion added to getCostSummary/getRouteComparison —
// resolveDisplayCurrency and normalizeCostSummaryToCurrency (both private,
// exercised via `as any`, matching the established pattern in
// bom-items.usage-calculators.spec.ts / bom-items.true-nest-costing.spec.ts).
import { BOMItemsService } from '../../../modules/bom-items/bom-items.service';
import { type BlankOptimizerService } from '../../../modules/bom-items/costing/sheet-metal/machine/blank-optimizer.service';
import { type SheetMetalLookupService } from '../../../modules/bom-items/costing/sheet-metal/lookup/sheet-metal-lookup.service';
import { type CADAnalysisService } from '../../../modules/bom-items/services/cad-analysis.service';
import { type ExchangeRateService, type RateSnapshot } from '../../../common/exchange-rate/exchange-rate.service';
import { type SupabaseService } from '../../../common/supabase/supabase.service';
import { type InspectionKnowledgeService } from '../../../modules/manufacturing-knowledge/services/inspection-knowledge.service';
import type { CostSummaryDto } from '../../../modules/bom-items/dto/cost-breakdown.dto';

function buildService() {
  return new BOMItemsService(
    {} as unknown as SupabaseService,
    {} as unknown as InspectionKnowledgeService,
    {} as unknown as BlankOptimizerService,
    {} as unknown as SheetMetalLookupService,
    {} as unknown as ExchangeRateService,
    {} as unknown as CADAnalysisService,
  );
}

// Real INR-pivot arithmetic (same as exchange-rate.service.ts's makeSnapshot)
// so a test that expects "the budget fallback was used" is checking the same
// math production would actually apply, not a stubbed constant.
function makeRates(inrPerUnit: Record<string, number>): RateSnapshot {
  const rates = new Map(Object.entries({ INR: 1, ...inrPerUnit }));
  const convertOptional = (from: string, to: string): number | null => {
    if (from === to) return 1;
    const f = rates.get(from);
    const t = rates.get(to);
    if (f == null || t == null) return null;
    return f / t;
  };
  const convertStrict = (from: string, to: string): number => {
    const r = convertOptional(from, to);
    if (r == null) throw new Error(`No exchange rate on file for '${from}' → '${to}'`);
    return r;
  };
  return { convertOptional, convertStrict, toUsd: (amount, from) => amount * convertStrict(from, 'USD') };
}

function minimalCostSummary(overrides: Partial<CostSummaryDto> = {}): CostSummaryDto {
  return {
    materialCost: 100,
    materialCostPerKg: 10,
    processLines: [],
    totalProcessCost: 50,
    totalCost: 150,
    sustainability: { wasteCostInr: 5 } as any,
    ...overrides,
  } as unknown as CostSummaryDto;
}

describe('BOMItemsService.resolveDisplayCurrency', () => {
  it('defaults to USD (pre-existing behavior) when no scenario FX snapshot is on file', () => {
    const service = buildService() as any;
    const rates = makeRates({ USD: 83.5 });
    const result = service.resolveDisplayCurrency(null, 'INR', rates);
    expect(result).toEqual({ currency: 'USD', currencySymbol: '$', rate: 1 / 83.5, usdToDisplayRate: 1, inrToDisplayRate: 1 / 83.5 });
  });

  it('is a true identity (rate 1) when the local currency is already USD and there is no snapshot', () => {
    const service = buildService() as any;
    const rates = makeRates({});
    const result = service.resolveDisplayCurrency(null, 'USD', rates);
    // inrToDisplayRate is undefined here, not a guessed 1 or thrown error —
    // this rates snapshot has no INR->USD leg on file (convertOptional, not
    // convertStrict — computing this purely-additive field must never make a
    // USD-native factory's cost-summary request fail).
    expect(result).toEqual({ currency: 'USD', currencySymbol: '$', rate: 1, usdToDisplayRate: 1, inrToDisplayRate: undefined });
  });

  it('uses the scenario fxSnapshot verbatim when its factoryCurrency matches — never re-derives from the live rate table', () => {
    const service = buildService() as any;
    // Live rates say EUR→INR should be 89 — but the snapshot says the
    // scenario locked in a rate of 100 (e.g. captured weeks ago). The stored
    // number must win, proving reproducibility across a later rate change.
    const rates = makeRates({ EUR: 200, USD: 83.5 });
    const scenarioOverrides = {
      fxSnapshot: {
        factoryCurrency: 'INR', scenarioCurrency: 'EUR',
        provider: 'frankfurter', source: 'ECB reference rates', rate: 0.011,
        rateDate: '2026-08-01', rateType: 'reference', retrievedAt: '2026-08-01T00:00:00Z',
      },
    };
    const result = service.resolveDisplayCurrency(scenarioOverrides, 'INR', rates);
    expect(result.currency).toBe('EUR');
    expect(result.currencySymbol).toBe('€');
    expect(result.rate).toBe(0.011);
    // usdToDisplayRate is a DIFFERENT rate (USD→EUR here), not re-derived from
    // the locked-in 0.011 (which is INR→EUR) — composed from the live USD→INR
    // budget rate × the locked-in INR→EUR scenario rate.
    expect(result.usdToDisplayRate).toBeCloseTo(83.5 * 0.011, 6);
  });

  it('ignores a stale snapshot whose factoryCurrency no longer matches (Digital Factory changed since) and falls back to USD', () => {
    const service = buildService() as any;
    const rates = makeRates({ USD: 83.5 });
    const scenarioOverrides = {
      fxSnapshot: {
        factoryCurrency: 'EUR', scenarioCurrency: 'GBP', // saved while the item was a Germany factory
        provider: 'frankfurter', source: 'ECB reference rates', rate: 0.85,
        rateDate: '2026-08-01', rateType: 'reference', retrievedAt: '2026-08-01T00:00:00Z',
      },
    };
    // Item's Digital Factory is now India (INR) — snapshot no longer applies.
    const result = service.resolveDisplayCurrency(scenarioOverrides, 'INR', rates);
    expect(result).toEqual({ currency: 'USD', currencySymbol: '$', rate: 1 / 83.5, usdToDisplayRate: 1, inrToDisplayRate: 1 / 83.5 });
  });

  it('resolves each factory currency independently — no shared global assumption across locations', () => {
    const service = buildService() as any;
    const rates = makeRates({ USD: 83.5, EUR: 89.0, CNY: 11.52 });
    expect(service.resolveDisplayCurrency(null, 'INR', rates).rate).toBeCloseTo(1 / 83.5, 6);
    expect(service.resolveDisplayCurrency(null, 'EUR', rates).rate).toBeCloseTo(89.0 / 83.5, 6);
    expect(service.resolveDisplayCurrency(null, 'CNY', rates).rate).toBeCloseTo(11.52 / 83.5, 6);
  });

  // The exact live bug: Digital Factory = India, Scenario Currency = INR
  // (identity — factory and scenario currency are the same). toUsdRate/rate
  // is correctly 1 here (no conversion needed for the engine's OWN embedded
  // figures), but usdToDisplayRate must still be the REAL USD→INR rate, not
  // 1 — otherwise a genuinely USD-stored raw-material unit_cost multiplied
  // by "fromUsd" (usdToDisplayRate) never actually converts, and $1.175/kg
  // gets relabeled ₹1.175/kg instead.
  it('India factory + INR scenario currency (identity) still yields a real, non-1 usdToDisplayRate', () => {
    const service = buildService() as any;
    const rates = makeRates({ USD: 83.5 });
    const scenarioOverrides = {
      fxSnapshot: {
        factoryCurrency: 'INR', scenarioCurrency: 'INR',
        provider: null, source: 'identity', rate: 1,
        rateDate: '2026-08-17', rateType: 'reference', retrievedAt: '2026-08-17T00:00:00Z',
      },
    };
    const result = service.resolveDisplayCurrency(scenarioOverrides, 'INR', rates);
    expect(result.currency).toBe('INR');
    expect(result.rate).toBe(1); // correct: no conversion needed for the DTO's own already-INR figures
    expect(result.usdToDisplayRate).toBeCloseTo(83.5, 6); // must NOT be 1
    // Prove the practical consequence: a real $1.175/kg raw-material figure
    // converts to a real ₹ amount, not itself relabeled.
    const rawMaterialUnitCostUsd = 1.175;
    const displayedUnitCost = rawMaterialUnitCostUsd * result.usdToDisplayRate;
    expect(displayedUnitCost).toBeCloseTo(1.175 * 83.5, 3);
    expect(displayedUnitCost).not.toBeCloseTo(1.175, 3);
  });
});

describe('BOMItemsService.normalizeCostSummaryToCurrency', () => {
  it('is numerically identical to the old normalizeCostSummaryToUsd for a USD-local item with no scenario currency', () => {
    const service = buildService() as any;
    const rates = makeRates({});
    const dto = minimalCostSummary();
    const result = service.normalizeCostSummaryToCurrency(dto, rates, 'USD', null);
    expect(result.currency).toBe('USD');
    expect(result.currencySymbol).toBe('$');
    expect(result.toUsdRate).toBe(1);
    expect(result.materialCost).toBe(100);
    expect(result.totalCost).toBe(150);
  });

  it('converts every money field through the resolved rate for a non-USD local item with no scenario currency (old default-to-USD path)', () => {
    const service = buildService() as any;
    const rates = makeRates({ USD: 83.5 });
    const dto = minimalCostSummary();
    const result = service.normalizeCostSummaryToCurrency(dto, rates, 'INR', null);
    const rate = 1 / 83.5;
    expect(result.currency).toBe('USD');
    expect(result.materialCost).toBeCloseTo(100 * rate, 6);
    expect(result.totalCost).toBeCloseTo(150 * rate, 6);
    expect(result.toUsdRate).toBeCloseTo(rate, 6);
  });

  it('converts to the scenario currency (not USD) when a matching fxSnapshot is on file', () => {
    const service = buildService() as any;
    const rates = makeRates({ USD: 83.5 });
    const dto = minimalCostSummary();
    const scenarioOverrides = {
      fxSnapshot: {
        factoryCurrency: 'INR', scenarioCurrency: 'EUR',
        provider: 'frankfurter', source: 'ECB reference rates', rate: 0.011,
        rateDate: '2026-08-01', rateType: 'reference', retrievedAt: '2026-08-01T00:00:00Z',
      },
    };
    const result = service.normalizeCostSummaryToCurrency(dto, rates, 'INR', scenarioOverrides);
    expect(result.currency).toBe('EUR');
    expect(result.currencySymbol).toBe('€');
    expect(result.materialCost).toBeCloseTo(100 * 0.011, 6);
    expect(result.toUsdRate).toBeCloseTo(0.011, 6);
  });

  // The exact live bug, reproduced end-to-end through the real DTO shape:
  // India factory + INR scenario currency (identity) must still carry a
  // real usdToDisplayRate on the returned DTO, so the frontend's separate
  // "convert USD-stored records" mechanism has something real to multiply
  // by, instead of silently defaulting to 1 (no-op) and relabeling.
  it('India factory + INR scenario currency (identity) returns a real usdToDisplayRate, not 1', () => {
    const service = buildService() as any;
    const rates = makeRates({ USD: 83.5 });
    const dto = minimalCostSummary();
    const scenarioOverrides = {
      fxSnapshot: {
        factoryCurrency: 'INR', scenarioCurrency: 'INR',
        provider: null, source: 'identity', rate: 1,
        rateDate: '2026-08-17', rateType: 'reference', retrievedAt: '2026-08-17T00:00:00Z',
      },
    };
    const result = service.normalizeCostSummaryToCurrency(dto, rates, 'INR', scenarioOverrides);
    expect(result.currency).toBe('INR');
    expect(result.toUsdRate).toBe(1); // correct for the DTO's OWN embedded figures
    expect(result.usdToDisplayRate).toBeCloseTo(83.5, 6); // must NOT be 1
  });
});
