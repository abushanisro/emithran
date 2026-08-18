/**
 * A single FX rate as returned by an external provider — never persisted
 * directly; FxRateCacheService wraps this into a cached row. Kept separate
 * from the cache/service layer so the costing engine and controllers never
 * import a provider adapter directly (see FxService) — swapping Frankfurter
 * for a commercial feed later means writing one new class here, nothing else.
 */
export interface FxProviderRate {
  rate: number;
  /** YYYY-MM-DD — the date the provider says this rate is FOR (not fetched-at). */
  rateDate: string;
  /** ISO 8601, when the provider itself timestamps the quote — null if it doesn't. */
  providerTimestamp: string | null;
  /** Raw provider response fields, stored for audit (e.g. {amount, base, date}). */
  sourceMetadata: Record<string, unknown>;
}

export interface FxRateProvider {
  readonly providerName: string;
  readonly providerSource: string;
  getRate(base: string, quote: string): Promise<FxProviderRate>;
}
