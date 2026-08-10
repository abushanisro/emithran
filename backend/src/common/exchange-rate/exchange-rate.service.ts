import { Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Immutable view over the rates loaded for ONE request. Captured once by
 * `ExchangeRateService.getSnapshot()` at the top of a costing request and
 * threaded down as a plain parameter — every conversion within that request
 * uses these exact numbers, even if the service's own live cache reloads
 * (TTL expiry, an admin edit) while the request is still in flight. Without
 * this, two conversions in the same generated quote could silently use two
 * different rates.
 */
export interface RateSnapshot {
  convertOptional(fromCurrency: string, toCurrency: string): number | null;
  convertStrict(fromCurrency: string, toCurrency: string): number;
  toUsd(amount: number, fromCurrency: string): number;
}

function makeSnapshot(rates: ReadonlyMap<string, number>): RateSnapshot {
  const convertOptional = (fromCurrency: string, toCurrency: string): number | null => {
    const from = fromCurrency.toUpperCase();
    const to = toCurrency.toUpperCase();
    if (from === to) return 1;
    const fromRate = rates.get(from);
    const toRate = rates.get(to);
    if (fromRate == null || toRate == null) return null;
    return fromRate / toRate;
  };
  const convertStrict = (fromCurrency: string, toCurrency: string): number => {
    const rate = convertOptional(fromCurrency, toCurrency);
    if (rate == null) {
      throw new UnprocessableEntityException(
        `No exchange rate on file for '${fromCurrency}' → '${toCurrency}' — add one via the exchange_rates table/admin settings.`,
      );
    }
    return rate;
  };
  return {
    convertOptional,
    convertStrict,
    toUsd: (amount: number, fromCurrency: string) => amount * convertStrict(fromCurrency, 'USD'),
  };
}

/**
 * Loads the active budget exchange rates from the `exchange_rates` table and
 * provides cost conversion between currencies. Shared by every module that
 * prices in a non-INR currency (MHR, LHR, bom-items, process-plan-generator)
 * so there is exactly one FX source of truth in the app — the DB table an
 * admin maintains, not a hardcoded constant that drifts out of date in code.
 *
 * Rates are admin-set (budget rates for the financial year), NOT live FX.
 * This is the correct approach for manufacturing cost engineering:
 *   - Live rates introduce noise and break reproducibility
 *   - Every generated plan/quote snapshots the rates it used so costs remain
 *     stable when reopened months later
 *
 * No method here ever substitutes a guessed/hardcoded rate when a real one
 * is missing — either the caller gets a real number or the call fails
 * loudly (`convertStrict`/`toUsd`/`loadRates`), or the caller explicitly
 * asked for the non-throwing check (`convertOptional`, for batch/import
 * flows that report gaps per-row instead of aborting the whole batch).
 *
 * All rates are from_currency → INR. INR itself has a rate of 1.
 */
@Injectable()
export class ExchangeRateService {
  private readonly logger = new Logger(ExchangeRateService.name);

  // In-memory cache — reloaded once per TTL window (stateless across requests).
  // This is a cross-request cache for reducing DB load, NOT a guarantee that
  // one request sees one consistent rate throughout — see getSnapshot().
  private rateMap: Map<string, number> = new Map([['INR', 1]]);
  private lastLoaded: number = 0;
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Load the active budget rates from DB (cached per TTL).
   * Always call this before converting anything. Throws if the table can't
   * be read or has no active rates — never silently substitutes a hardcoded
   * default, since a stale/guessed FX rate is worse than a blocked request.
   */
  async loadRates(accessToken: string | null): Promise<void> {
    const now = Date.now();
    if (now - this.lastLoaded < ExchangeRateService.CACHE_TTL_MS && this.rateMap.size > 1) {
      return;
    }

    const client = this.supabaseService.getClient(accessToken ?? undefined);
    const { data, error } = await client
      .from('exchange_rates')
      .select('from_currency, to_currency, rate')
      .eq('is_active', true)
      .eq('to_currency', 'INR');

    if (error) {
      throw new ServiceUnavailableException(`Exchange rates unavailable — failed to read exchange_rates: ${error.message}`);
    }

    const nextRateMap = new Map([['INR', 1]]);
    for (const row of data ?? []) {
      if (row.from_currency && typeof row.rate === 'number' && row.rate > 0) {
        nextRateMap.set(row.from_currency, row.rate);
      }
    }

    if (nextRateMap.size === 1) {
      throw new ServiceUnavailableException('Exchange rates unavailable — exchange_rates table has no active rates.');
    }

    this.rateMap = nextRateMap;
    this.lastLoaded = now;
    this.logger.log(`Exchange rates loaded: ${JSON.stringify(Object.fromEntries(this.rateMap))}`);
  }

  /**
   * Units of `toCurrency` equal to 1 unit of `fromCurrency`, derived via the
   * INR anchor (rateMap values are always "1 unit of X = rate INR").
   * Returns null — never a guessed default — when either currency's rate is
   * missing. Use this ONLY when the caller genuinely wants a non-throwing
   * check (e.g. a bulk import reporting per-row gaps instead of aborting the
   * whole batch) — everywhere else, use `convertStrict`/`toUsd` so a missing
   * rate can't be silently ignored.
   */
  convertOptional(fromCurrency: string, toCurrency: string): number | null {
    return makeSnapshot(this.rateMap).convertOptional(fromCurrency, toCurrency);
  }

  /** Same lookup as `convertOptional`, but throws instead of returning null. */
  convertStrict(fromCurrency: string, toCurrency: string): number {
    return makeSnapshot(this.rateMap).convertStrict(fromCurrency, toCurrency);
  }

  /** `amount` (in `fromCurrency`) converted to USD. Throws if no rate is on file. */
  toUsd(amount: number, fromCurrency: string): number {
    return makeSnapshot(this.rateMap).toUsd(amount, fromCurrency);
  }

  hasRate(currency: string): boolean {
    return this.rateMap.has(currency.toUpperCase());
  }

  /**
   * Returns the current rate map as a plain object suitable for snapshotting
   * on a generation/import record (e.g. process-plan-generator stamps this
   * onto each generation for reproducibility).
   */
  snapshot(): Record<string, number> {
    return Object.fromEntries(this.rateMap);
  }

  /**
   * Loads rates once and returns an immutable view bound to the rates AS OF
   * THIS CALL — later reloads of the live cache (TTL expiry, a concurrent
   * request, an admin edit) can never change an already-issued snapshot's
   * answers. Call this ONCE at the top of a costing request and thread the
   * returned `RateSnapshot` through every helper that needs to convert,
   * instead of each helper calling this service independently.
   */
  async getSnapshot(accessToken: string | null): Promise<RateSnapshot> {
    await this.loadRates(accessToken);
    return makeSnapshot(new Map(this.rateMap));
  }
}
