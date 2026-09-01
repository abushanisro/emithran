import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ExchangeRateService } from '../exchange-rate/exchange-rate.service';
import {
  LOCATION_INFO,
  listCurrencies as listCurrenciesFromLocationInfo,
  listFactoryLocations,
} from '../../modules/bom-items/costing/shared/core/default-rates.constants';
import { FxRateCacheService } from './fx-rate-cache.service';

export type FxRateType = 'reference' | 'budget' | 'custom';

export interface FxRateResult {
  rate: number;
  base: string;
  quote: string;
  rateType: FxRateType;
  provider: string | null;
  source: string | null;
  /** YYYY-MM-DD the rate is FOR, when the source supplies one (null for budget/custom). */
  rateDate: string | null;
  retrievedAt: string;
  stale: boolean;
  customReason?: string;
}

/**
 * The one thing the rest of the app depends on for FX — the costing engine
 * and frontend never call FrankfurterFxProvider or ExchangeRateService
 * directly for scenario-currency purposes. Dispatches by rate type:
 *   - 'reference' → FxRateCacheService → fx_rate_snapshots cache → Frankfurter
 *   - 'budget'    → ExchangeRateService (existing, untouched — admin-set rates)
 *   - 'custom'    → the caller's own value + a required reason, never silent
 */
@Injectable()
export class FxService {
  constructor(
    private readonly fxRateCacheService: FxRateCacheService,
    private readonly exchangeRateService: ExchangeRateService,
  ) {}

  /** Digital Factory location → ISO 4217 currency + symbol. LOCATION_INFO is the sole source. */
  resolveFactoryCurrency(location: string): { code: string; symbol: string } {
    const info = LOCATION_INFO[location] ?? LOCATION_INFO['Other'];
    return { code: info.code, symbol: info.symbol };
  }

  /** Every Digital Factory location, for the location picker — never hardcoded client-side. */
  listFactories(): Array<{ location: string; code: string; symbol: string }> {
    return listFactoryLocations();
  }

  /** Every distinct scenario currency, for the Currency & Ask Price picker — never hardcoded client-side. */
  listCurrencies(): Array<{ code: string; symbol: string; name: string }> {
    return listCurrenciesFromLocationInfo();
  }

  async getRate(params: {
    base: string;
    quote: string;
    rateType: FxRateType;
    accessToken: string | null;
    customRate?: number;
    customReason?: string;
  }): Promise<FxRateResult> {
    const base = params.base.toUpperCase();
    const quote = params.quote.toUpperCase();
    const retrievedAt = new Date().toISOString();

    if (base === quote) {
      return {
        rate: 1, base, quote, rateType: params.rateType,
        provider: null, source: 'identity', rateDate: todayIso(), retrievedAt, stale: false,
      };
    }

    if (params.rateType === 'custom') {
      if (params.customRate == null || !(params.customRate > 0)) {
        throw new UnprocessableEntityException('A custom FX rate requires a positive rate value.');
      }
      if (!params.customReason?.trim()) {
        throw new UnprocessableEntityException('A custom FX rate requires a reason.');
      }
      return {
        rate: params.customRate, base, quote, rateType: 'custom',
        provider: null, source: 'user-entered', rateDate: todayIso(), retrievedAt, stale: false,
        customReason: params.customReason.trim(),
      };
    }

    if (params.rateType === 'budget') {
      // ExchangeRateService is INR-anchored (every admin-set row is
      // from_currency → INR) but derives a true cross-rate for ANY pair via
      // that pivot: convertStrict(base, quote) = (INR-per-base)/(INR-per-quote).
      // See exchange-rate.service.ts's makeSnapshot and migration 178's own
      // comment ("derives cross-rates via: from_rate / to_rate") — this is
      // the existing, deliberate design, not a gap to route around. What it
      // does NOT do is silently substitute another rate type when a currency
      // has no budget row on file — it fails, and we check per-currency here
      // so the failure names the specific missing side rather than the pair.
      const rates = await this.exchangeRateService.getSnapshot(params.accessToken);
      const missing = [base, quote].filter((c) => c !== 'INR' && !this.exchangeRateService.hasRate(c));
      if (missing.length > 0) {
        throw new UnprocessableEntityException(
          `Budget FX rate unavailable: no admin-set exchange_rates row for ${missing.join(' and ')} → INR. ` +
          `Add one via the exchange_rates table/admin settings, or select Reference or Custom instead.`,
        );
      }
      const rate = rates.convertStrict(base, quote);
      const viaPivot = base !== 'INR' && quote !== 'INR';
      return {
        rate, base, quote, rateType: 'budget',
        provider: null,
        source: viaPivot
          ? `exchange_rates (admin-set budget rate, ${base}→INR and ${quote}→INR cross-rate)`
          : 'exchange_rates (admin-set budget rate)',
        rateDate: null, retrievedAt, stale: false,
      };
    }

    const cached = await this.fxRateCacheService.getCachedOrFetch(base, quote);
    return {
      rate: cached.rate, base, quote, rateType: 'reference',
      provider: cached.provider, source: cached.providerSource,
      rateDate: cached.rateDate, retrievedAt: cached.retrievedAt, stale: cached.stale,
    };
  }

  /** Forces a live provider call for (base, quote) — backs the explicit "Refresh FX" action. */
  async refresh(base: string, quote: string): Promise<FxRateResult> {
    const from = base.toUpperCase();
    const to = quote.toUpperCase();
    if (from === to) {
      return {
        rate: 1, base: from, quote: to, rateType: 'reference',
        provider: null, source: 'identity', rateDate: todayIso(), retrievedAt: new Date().toISOString(), stale: false,
      };
    }
    const cached = await this.fxRateCacheService.refresh(from, to);
    return {
      rate: cached.rate, base: from, quote: to, rateType: 'reference',
      provider: cached.provider, source: cached.providerSource,
      rateDate: cached.rateDate, retrievedAt: cached.retrievedAt, stale: cached.stale,
    };
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
