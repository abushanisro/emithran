import { createHash } from 'crypto';
import { ForbiddenException, Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { UserDirectory } from '../database/user-directory';
import { DatabaseService } from '../database/database.service';
import { currentRequestAuth } from '../request-context/request-auth-context';

/** One effective budget rate for an organization with its provenance (see listRates). */
export interface ExchangeRateRow {
  currency: string;
  name: string | null;
  /** 1 USD = rate `currency`: the organization's own rate when it set one, else the global default. */
  rate: number;
  /** Where `rate` comes from: the organization's own budget rate, or the global default (migrations/operators). */
  source: 'organization' | 'default';
  /** The global default (1 USD = defaultRate `currency`), shown next to an organization's own rate. */
  defaultRate: number;
  effectiveDate: string;
  /** Email of the member who set the organization's rate; null while the global default applies. */
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
 * (TTL expiry, an edit) while the request is still in flight. Without
 * this, two conversions in the same generated quote could silently use two
 * different rates.
 */
export interface RateSnapshot {
  convertOptional(fromCurrency: string, toCurrency: string): number | null;
  convertStrict(fromCurrency: string, toCurrency: string): number;
  toUsd(amount: number, fromCurrency: string): number;
  /** True when a rate is on file for `currency` (USD always is). */
  has(currency: string): boolean;
  /** The rates as "USD per 1 unit of the currency", for stamping on a generation/import record. */
  rates(): Record<string, number>;
  /** The organization whose budget rates these are; null when only the global defaults were used (no organization context). */
  organizationId: string | null;
}

function makeSnapshot(rates: ReadonlyMap<string, number>, organizationId: string | null): RateSnapshot {
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
    has: (currency: string) => rates.has(currency.toUpperCase()),
    rates: () => Object.fromEntries(rates),
    organizationId,
  };
}

/**
 * The organization a stored row belongs to (its `organization_id`), for `getSnapshot`: null when the row has none, in which case
 * the global default rates apply.
 */
export function organizationIdOf(row: unknown): string | null {
  const value = (row as { organization_id?: unknown } | null | undefined)?.organization_id;
  return typeof value === 'string' && value !== '' ? value : null;
}

/** "1 USD = rate CCY" rows → USD per 1 unit of each currency (USD itself is 1). */
function toUsdPerUnit(rows: ReadonlyArray<{ currency: string; rate: number }>): Map<string, number> {
  const map = new Map([[ANCHOR_CURRENCY, 1]]);
  for (const row of rows) {
    if (row.currency && row.rate > 0) map.set(row.currency, 1 / row.rate);
  }
  return map;
}

interface CacheEntry<T> {
  value: T;
  loadedAt: number;
}

/**
 * Budget exchange rates, per organization. The global `exchange_rates` table
 * (migration 803) is the read-only default, maintained by migrations and
 * operators; an organization can set its own budget rate for a currency
 * (`organization_exchange_rates`, migration 940), which then applies to that
 * organization's costing only. The effective rate of a currency for an
 * organization is its own active rate, else the global default.
 *
 * Rates are budget rates for the financial year, NOT live FX:
 *   - Live rates introduce noise and break reproducibility
 *   - Every generated plan/quote snapshots the rates it used so costs remain
 *     stable when reopened months later
 *
 * No method here ever substitutes a guessed/hardcoded rate when a real one
 * is missing — either the caller gets a real number or the call fails
 * loudly (`convertStrict`/`toUsd`), or the caller explicitly asked for the
 * non-throwing check (`convertOptional`, for batch/import flows that report
 * gaps per-row instead of aborting the whole batch).
 *
 * Rows are quoted as "1 USD = rate CCY". USD is the anchor; every cross-rate
 * is derived from it.
 */
@Injectable()
export class ExchangeRateService {
  private readonly logger = new Logger(ExchangeRateService.name);

  // Cross-request caches that only reduce DB load. The global defaults are the
  // same for everyone. An organization's own rates are cached per organization
  // AND per caller token: a cached entry is only ever handed back to a caller
  // whose own read of that organization (get_organization_exchange_rates,
  // which refuses non-members) succeeded.
  private globalDefaults: CacheEntry<Map<string, number>> | null = null;
  private readonly organizationRates = new Map<string, CacheEntry<Map<string, number>>>();
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly directory: UserDirectory,
  ) {}

  /**
   * Loads rates once and returns an immutable view bound to the rates AS OF
   * THIS CALL. Call this ONCE at the top of a costing request and thread the
   * returned `RateSnapshot` through every helper that needs to convert.
   *
   * `organizationId` is the organization whose data is being costed: its own
   * budget rates override the global defaults. Pass null only where there is
   * no organization context; the snapshot then holds the global defaults and
   * says so (`organizationId: null`) — never another organization's rates.
   */
  async getSnapshot(accessToken: string | null, organizationId: string | null): Promise<RateSnapshot> {
    const defaults = await this.loadGlobalDefaults(accessToken);
    if (!organizationId) return makeSnapshot(new Map(defaults), null);
    const own = await this.loadOrganizationRates(accessToken, organizationId);
    return makeSnapshot(new Map([...defaults, ...own]), organizationId);
  }

  /**
   * Every currency with a global default rate (the anchor included), with its
   * reference-table name -- backs the Currency picker. An organization can only
   * set rates for these currencies, so the list is the same for everyone. The
   * anchor has no row of its own, so its name comes from the ISO 4217 display
   * names the runtime ships (Intl), never a hand-kept label.
   */
  async listCurrencies(accessToken: string | null): Promise<Array<{ code: string; name: string }>> {
    const defaults = await this.loadGlobalDefaults(accessToken);
    // Names are display-only, so they are read here and never by the rate
    // loaders: costing conversions must not depend on a label column.
    const { data, error } = await this.databaseService
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
    return [...defaults.keys()]
      .sort()
      .map((code) => ({ code, name: names.get(code) ?? isoNames.of(code) ?? code }));
  }

  /**
   * The organization's effective budget rates as stored ("1 USD = rate CCY"):
   * one row per currency with a global default, carrying the organization's own
   * rate (who set it, when, why) where it set one. Backs the Process page
   * Exchange Rates panel.
   */
  async listRates(accessToken: string | null, organizationId: string): Promise<ExchangeRateRow[]> {
    const client = this.databaseService.getUserClient(accessToken ?? undefined);
    const { data, error } = await client
      .from('exchange_rates')
      .select('to_currency, currency_name, rate, effective_date, source_active, source_modified_by, source_modified_at, updated_at')
      .eq('is_active', true)
      .eq('from_currency', ANCHOR_CURRENCY)
      .order('to_currency');
    if (error) {
      throw new ServiceUnavailableException(`Exchange rates unavailable — failed to read exchange_rates: ${error.message}`);
    }
    const own = await this.readOrganizationRows(accessToken, organizationId);
    const ownByCurrency = new Map(own.map((r) => [r.currency, r]));
    const editorIds = [...new Set(own.map((r) => r.set_by).filter((id): id is string => !!id))];
    const editors = await this.directory.findByIds(editorIds);
    return (data ?? []).map((r) => {
      const mine = ownByCurrency.get(r.to_currency);
      return {
        currency: r.to_currency,
        name: r.currency_name,
        rate: Number(mine ? mine.rate : r.rate),
        source: mine ? 'organization' : 'default',
        defaultRate: Number(r.rate),
        effectiveDate: mine ? mine.effective_date : r.effective_date,
        editedBy: mine ? (mine.set_by ? editors.get(mine.set_by)?.email ?? mine.set_by : null) : null,
        editReason: mine ? mine.reason : null,
        sourceActive: r.source_active,
        sourceModifiedBy: r.source_modified_by,
        sourceModifiedAt: r.source_modified_at,
        updatedAt: mine ? mine.updated_at : r.updated_at,
      };
    });
  }

  /**
   * Sets the organization's own budget rate (1 USD = rate `currency`) through
   * set_organization_exchange_rate() (migration 940), as the caller: RLS lets a
   * member write only their own organization's rates, the replaced rate is kept
   * as inactive history, and the row records the caller and `reason`. Other
   * organizations and the global default are untouched.
   */
  async setRate(accessToken: string | null, organizationId: string, currency: string, rate: number, reason: string): Promise<void> {
    const { error } = await this.databaseService.getUserClient(accessToken ?? undefined).rpc('set_organization_exchange_rate', {
      p_organization_id: organizationId,
      p_currency: currency,
      p_rate: rate,
      p_reason: reason,
    });
    if (error) {
      if (error.code === '42501') throw new ForbiddenException('You are not a member of this organization.');
      throw new UnprocessableEntityException(`Could not update the ${currency.toUpperCase()} exchange rate: ${error.message}`);
    }
    // This instance reads the new rate right away; other instances within the cache TTL.
    for (const key of [...this.organizationRates.keys()]) {
      if (key.startsWith(`${organizationId}:`)) this.organizationRates.delete(key);
    }
  }

  /** The global default rates (USD per 1 unit). Throws if the table can't be read or has no active rates. */
  private async loadGlobalDefaults(accessToken: string | null): Promise<Map<string, number>> {
    const now = Date.now();
    if (this.globalDefaults && now - this.globalDefaults.loadedAt < ExchangeRateService.CACHE_TTL_MS) {
      return this.globalDefaults.value;
    }
    const { data, error } = await this.databaseService
      .getUserClient(accessToken ?? undefined)
      .from('exchange_rates')
      .select('to_currency, rate')
      .eq('is_active', true)
      .eq('from_currency', ANCHOR_CURRENCY);
    if (error) {
      throw new ServiceUnavailableException(`Exchange rates unavailable — failed to read exchange_rates: ${error.message}`);
    }
    const value = toUsdPerUnit((data ?? []).map((r) => ({ currency: r.to_currency as string, rate: Number(r.rate) })));
    if (value.size === 1) {
      throw new ServiceUnavailableException('Exchange rates unavailable — exchange_rates table has no active rates.');
    }
    this.globalDefaults = { value, loadedAt: now };
    this.logger.log(`Global default exchange rates loaded: ${JSON.stringify(Object.fromEntries(value))}`);
    return value;
  }

  /** The organization's own rates (USD per 1 unit), without the anchor. Refused when the caller is not a member. */
  private async loadOrganizationRates(accessToken: string | null, organizationId: string): Promise<Map<string, number>> {
    const now = Date.now();
    const key = `${organizationId}:${this.callerKey(accessToken)}`;
    const cached = this.organizationRates.get(key);
    if (cached && now - cached.loadedAt < ExchangeRateService.CACHE_TTL_MS) return cached.value;

    const rows = await this.readOrganizationRows(accessToken, organizationId);
    const value = toUsdPerUnit(rows.map((r) => ({ currency: r.currency, rate: Number(r.rate) })));
    value.delete(ANCHOR_CURRENCY);
    for (const [k, entry] of this.organizationRates) {
      if (now - entry.loadedAt >= ExchangeRateService.CACHE_TTL_MS) this.organizationRates.delete(k);
    }
    this.organizationRates.set(key, { value, loadedAt: now });
    return value;
  }

  private async readOrganizationRows(accessToken: string | null, organizationId: string) {
    const { data, error } = await this.databaseService
      .getUserClient(accessToken ?? undefined)
      .rpc('get_organization_exchange_rates', { p_organization_id: organizationId });
    if (error) {
      if (error.code === '42501') throw new ForbiddenException('You are not a member of this organization.');
      throw new ServiceUnavailableException(`Exchange rates unavailable — failed to read the organization's rates: ${error.message}`);
    }
    return (data ?? []) as Array<{
      currency: string;
      rate: number | string;
      set_by: string | null;
      reason: string;
      effective_date: string;
      updated_at: string;
    }>;
  }

  /** Identifies the caller for the per-organization cache without keeping their token. */
  private callerKey(accessToken: string | null): string {
    const token = accessToken ?? currentRequestAuth()?.accessToken ?? '';
    return createHash('sha256').update(token).digest('hex').slice(0, 32);
  }
}
