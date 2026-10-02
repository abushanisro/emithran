import { Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/** One active budget rate with its provenance (see listRates). */
export interface ExchangeRateRow {
  currency: string;
  name: string | null;
  /** 1 USD = rate `currency`. */
  rate: number;
  effectiveDate: string;
  /** Email of the user who last edited the rate; null while it is the reference value. */
  editedBy: string | null;
  editReason: string | null;
  sourceActive: boolean | null;
  sourceModifiedBy: string | null;
  sourceModifiedAt: string | null;
  updatedAt: string;
}

/** The currency every exchange_rates row is quoted from (migration 803). */
export const ANCHOR_CURRENCY = 'USD';

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
 * converts between currencies (MHR, LHR, bom-items, process-plan-generator)
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
 * Rows are the reference exchange rate table (migration 803), quoted as
 * "1 USD = rate CCY" (from_currency USD → to_currency CCY). USD is the
 * anchor; every cross-rate is derived from it.
 *
 * Intended default (not yet implemented — there is currently no admin UI or
 * write endpoint for exchange_rates at all; every row today comes from a
 * hand-written SQL migration): when an admin CREATES a new Budget rate for a
 * currency pair, it should default/prefill to the live Reference rate
 * (common/fx/fx.service.ts's 'reference' rate type, via FxRateCacheService)
 * minus 2% — a conservative planning buffer, standard practice for FX
 * budget rates. This is a one-time suggested DEFAULT only: once saved, the
 * row is independently admin-controlled and stable for the fiscal year
 * exactly as today — Budget must never become a live-derived, silently
 * recalculated rate (that would defeat the entire point of this table; see
 * FxService's own "Reference ≠ Budget ≠ Custom, never silently substitute"
 * rule). Build this once a real admin surface for exchange_rates exists.
 */
@Injectable()
export class ExchangeRateService {
  private readonly logger = new Logger(ExchangeRateService.name);

  // In-memory cache — reloaded once per TTL window (stateless across requests).
  // This is a cross-request cache for reducing DB load, NOT a guarantee that
  // one request sees one consistent rate throughout — see getSnapshot().
  // Values are "USD per 1 unit of the currency" (USD itself is 1).
  private rateMap: Map<string, number> = new Map([[ANCHOR_CURRENCY, 1]]);
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

    const client = this.supabaseService.getUserClient(accessToken ?? undefined);
    const { data, error } = await client
      .from('exchange_rates')
      .select('to_currency, rate')
      .eq('is_active', true)
      .eq('from_currency', ANCHOR_CURRENCY);

    if (error) {
      throw new ServiceUnavailableException(`Exchange rates unavailable — failed to read exchange_rates: ${error.message}`);
    }

    const nextRateMap = new Map([[ANCHOR_CURRENCY, 1]]);
    for (const row of data ?? []) {
      const rate = Number(row.rate);
      if (row.to_currency && rate > 0) {
        // Stored as "1 USD = rate CCY"; the map holds USD per 1 CCY.
        nextRateMap.set(row.to_currency, 1 / rate);
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
   * USD anchor (rateMap values are always "1 unit of X = rate USD").
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
   * Every currency with a rate on file (the anchor included), with its
   * reference-table name -- backs the Currency picker. The anchor has no row
   * of its own, so its name comes from the ISO 4217 display names the
   * runtime ships (Intl), never a hand-kept label.
   */
  async listCurrencies(accessToken: string | null): Promise<Array<{ code: string; name: string }>> {
    await this.loadRates(accessToken);
    // Names are display-only, so they are read here and never by loadRates:
    // costing conversions must not depend on a label column.
    const { data, error } = await this.supabaseService
      .getUserClient(accessToken ?? undefined)
      .from('exchange_rates')
      .select('to_currency, currency_name')
      .eq('is_active', true)
      .eq('from_currency', ANCHOR_CURRENCY);
    if (error) {
      throw new ServiceUnavailableException(`Currency names unavailable — failed to read exchange_rates: ${error.message}`);
    }
    const names = new Map((data ?? []).map((r) => [r.to_currency as string, r.currency_name as string | null]));
    const isoNames = new Intl.DisplayNames(['en'], { type: 'currency' });
    return [...this.rateMap.keys()]
      .sort()
      .map((code) => ({ code, name: names.get(code) ?? isoNames.of(code) ?? code }));
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
   * The active budget rates as stored ("1 USD = rate CCY"), with where each
   * value came from: the reference table (sourceModifiedBy/At, sourceActive)
   * and, once edited on the Process page, who changed it, when, and why.
   * Backs the Process page Exchange Rates panel.
   */
  async listRates(accessToken: string | null): Promise<ExchangeRateRow[]> {
    const client = this.supabaseService.getUserClient(accessToken ?? undefined);
    const { data, error } = await client
      .from('exchange_rates')
      .select('to_currency, currency_name, rate, effective_date, set_by, notes, source_active, source_modified_by, source_modified_at, updated_at')
      .eq('is_active', true)
      .eq('from_currency', ANCHOR_CURRENCY)
      .order('to_currency');
    if (error) {
      throw new ServiceUnavailableException(`Exchange rates unavailable — failed to read exchange_rates: ${error.message}`);
    }
    const editorIds = [...new Set((data ?? []).map((r) => r.set_by).filter((id): id is string => !!id))];
    const editorEmails = new Map<string, string | null>();
    for (const id of editorIds) {
      const { data: user } = await this.supabaseService.getPrivilegedClient('auth-admin: resolve rate editor email for audit display').auth.admin.getUserById(id);
      editorEmails.set(id, user?.user?.email ?? null);
    }
    return (data ?? []).map((r) => ({
      currency: r.to_currency,
      name: r.currency_name,
      rate: Number(r.rate),
      effectiveDate: r.effective_date,
      editedBy: r.set_by ? editorEmails.get(r.set_by) ?? r.set_by : null,
      editReason: r.set_by ? r.notes : null,
      sourceActive: r.source_active,
      sourceModifiedBy: r.source_modified_by,
      sourceModifiedAt: r.source_modified_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Sets a new budget rate (1 USD = rate `currency`) through
   * set_budget_exchange_rate() (migration 803): the replaced rate is kept as
   * inactive history, and the new row records `userId` and `reason`. Table
   * writes are service-role-only, so this uses the admin client; the caller
   * is the authenticated user the controller resolved.
   */
  async setRate(currency: string, rate: number, reason: string, userId: string): Promise<void> {
    const { error } = await this.supabaseService.getPrivilegedClient('system-write: exchange_rates writes are service-role-only (migration 803), caller authenticated by controller').rpc('set_budget_exchange_rate', {
      p_currency: currency,
      p_rate: rate,
      p_set_by: userId,
      p_reason: reason,
    });
    if (error) {
      throw new UnprocessableEntityException(`Could not update the ${currency.toUpperCase()} exchange rate: ${error.message}`);
    }
    // Force the next conversion to read the new rate instead of the cache.
    this.lastLoaded = 0;
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
