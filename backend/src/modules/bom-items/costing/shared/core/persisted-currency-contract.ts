/**
 * The currency contract for money persisted into process_cost_records.
 * Introduced with migration 707 (audit phase P1a).
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * These two decisions used to be implicit: writeProcessLinesAsRecords stamped
 * `currency: 'USD'` on every row as a literal, and nothing anywhere stated what
 * denomination the values actually were. Both decisions are pure functions of
 * the caller's own resolved values, so they live here where they can be tested
 * against real currency codes and rates instead of only through a controller
 * that needs a database.
 *
 * THE UNDERLYING CONSTRAINT
 *
 * process_cost_records.total_cost_per_part has two consumers that want opposite
 * denominations:
 *
 *   applyPersistedRouteToSummary   wants LOCAL -- it overlays rows into a cost
 *                                  summary the engines computed in the factory
 *                                  local currency.
 *   sync_process_cost_to_bom_item  wants USD  -- it copies the value into
 *                                  bom_item_costs.process_cost, which sits
 *                                  beside raw_material_cost, packaging,
 *                                  procured and tooling (all USD-native) in a
 *                                  table with no currency column.
 *
 * A BOM can also span factories in different countries, so that rollup
 * aggregate cannot be denominated in any single factory local currency -- it
 * needs one comparable reporting currency, and USD is what it already is.
 *
 * The target contract is local-currency persistence (audit section D: money
 * crosses the currency boundary exactly once, at the response edge). Reaching
 * it requires teaching the rollup about currency first, which is P1b. Until
 * then this module keeps the invariant explicit and enforced rather than
 * assumed, and the database enforces the same thing through
 * ck_process_cost_records_rollup_usd_until_p1b so the two cannot drift apart.
 */

/**
 * The currency bom_item_costs and its rollup chain are denominated in. Not a
 * configurable preference -- it is what the four sync_*_to_bom_item triggers
 * and bom-item-cost.service.ts already write, now stated in one place.
 */
export const ROLLUP_REPORTING_CURRENCY = 'USD';

/**
 * What currency a batch of process lines is denominated in, and how it got
 * there. Stated by the caller, never inferred: the two producers genuinely
 * differ.
 *
 *   applyRoute        lines come from getRouteComparison AFTER
 *                     normalizeRouteComparisonToCurrency, so they are in that
 *                     response's display currency.
 *   applyCustomRoute  lines come from resolveRealMachineRate, which converts
 *                     every rate through rates.toUsd(), so they are USD
 *                     whatever the factory currency is.
 */
export interface PersistedLineCurrency {
  /** ISO 4217 code the line money is actually denominated in. */
  lineCurrency: string;
  /**
   * ISO 4217 code of the factory-local currency the cost engine computed in.
   * null when the caller could not resolve one -- never a stand-in value.
   */
  localCurrency: string | null;
  /**
   * amount_local x rateFromLocal = the stored amount. null when the caller
   * genuinely did not resolve one, rather than a fabricated 1 which would
   * claim a conversion that never happened.
   */
  rateFromLocal: number | null;
}

/**
 * process_cost_records.cost_currency_basis -- what a stored row's money can be
 * trusted to be. See the column comment in migration 707.
 */
export type PersistedCostCurrencyBasis = 'legacy_unverified' | 'converted' | 'local';

/**
 * Whether the BOM cost rollup can accept money in this currency.
 *
 * Returns null when it can, or the reason it cannot. A reason, not a boolean,
 * so the caller can surface something a user can act on instead of a bare
 * rejection -- and so the reason lives with the constraint rather than being
 * restated at each call site.
 */
export function rollupRejectionReason(lineCurrency: string): string | null {
  if (lineCurrency === ROLLUP_REPORTING_CURRENCY) return null;
  return (
    `process cost records feed the BOM cost rollup, which is denominated in ` +
    `${ROLLUP_REPORTING_CURRENCY} and cannot yet accept ${lineCurrency}`
  );
}

/**
 * Which basis describes a row written from this context.
 *
 * 'converted' requires BOTH the local currency and the rate that reached the
 * stored currency -- the database constraint
 * ck_process_cost_records_converted_is_traceable requires the same pair, since
 * a basis a writer can claim without the data to back it is exactly the kind of
 * assumption migration 707 exists to remove. A caller that cannot supply both
 * gets 'legacy_unverified': an admitted gap rather than false traceability.
 *
 * Nothing returns 'local' yet. That is P1b, once the writer takes
 * pre-conversion lines and the rollup can accept them.
 */
export function resolvePersistedCostCurrencyBasis(
  ctx: PersistedLineCurrency,
): PersistedCostCurrencyBasis {
  // 'local' as of P1b-iv-c: applyRoute now hands the writer the routes as the
  // engines computed them, before any conversion, so the money genuinely IS in
  // the factory local currency and no rate was applied to reach it.
  //
  // ck_process_cost_records_local_agrees requires currency === cost_currency_local
  // for this basis, which is exactly the condition tested here.
  if (
    isIsoCode(ctx.lineCurrency) &&
    isIsoCode(ctx.localCurrency) &&
    ctx.lineCurrency === ctx.localCurrency
  ) {
    return 'local';
  }

  const traceable =
    !!ctx.localCurrency &&
    ctx.rateFromLocal != null &&
    Number.isFinite(ctx.rateFromLocal) &&
    ctx.rateFromLocal > 0;
  return traceable ? 'converted' : 'legacy_unverified';
}

/* ────────────────────────────────────────────────────────────────────────────
 * Overlay eligibility (P1b-iv-a) -- the fix for the divide-by-83.5
 *
 * applyPersistedRouteToSummary injects persisted process lines into a cost
 * summary the engines computed in the FACTORY LOCAL currency, and
 * normalizeCostSummaryToCurrency then converts the whole summary once. If a
 * persisted row is denominated in anything other than that local currency, the
 * overlay mixes denominations and the normalisation converts those lines a
 * SECOND time. Measured on a real India-location part: persisted 0.000266
 * displayed as 0.0000031856, a ratio of exactly 83.500 = 1 / toUsdRate.
 *
 * The rule below is the guard. It converts nothing and repairs nothing -- it
 * only refuses to overlay a row whose denomination does not already match the
 * summary, which leaves the live engine values in place for that line. Those
 * are correct and converted exactly once.
 * ──────────────────────────────────────────────────────────────────────────── */

/** The two columns an overlay decision needs from a persisted row. */
export interface PersistedMoneyRow {
  currency: string | null;
  cost_currency_basis: PersistedCostCurrencyBasis | null;
}

/**
 * Whether a persisted process-cost row may be overlaid into a cost summary
 * denominated in `summaryCurrency`.
 *
 * Returns null when it may, or the reason it may not. A reason rather than a
 * boolean so the skip is auditable: silently showing live values where a user
 * applied a route is a behaviour change that must be explainable.
 *
 * Deliberately NOT done here: converting the row into the summary currency.
 * The persisted rate columns (machine_rate / labor_rate / direct_rate) are
 * still denominated separately from the cost columns, and three other code
 * paths re-derive cost from those rates, so converting a row on read would
 * spread the same ambiguity rather than remove it. Skipping is honest;
 * converting would be a guess dressed as arithmetic.
 */
export function overlayRejectionReason(
  row: PersistedMoneyRow,
  summaryCurrency: string,
): string | null {
  if (!isTrustedPersistedBasis(row.cost_currency_basis)) {
    return `denomination unverified (basis ${row.cost_currency_basis ?? 'null'})`;
  }
  if (!isIsoCode(row.currency)) {
    return 'no declared currency';
  }
  if (row.currency !== summaryCurrency) {
    return `persisted in ${row.currency}, summary computed in ${summaryCurrency}`;
  }
  return null;
}

/** 'local' and 'converted' both assert that `currency` names the money. */
export function isTrustedPersistedBasis(
  basis: PersistedCostCurrencyBasis | null | undefined,
): boolean {
  return basis === 'local' || basis === 'converted';
}

/* ────────────────────────────────────────────────────────────────────────────
 * The same contract for the OTHER cost-record tables (migration 708, P1b-i)
 *
 * raw_material_cost_records, packaging_logistics_cost_records,
 * procured_parts_cost_records and tooling_cost_records all aggregate into
 * bom_item_costs, and each had its own convention: no currency column at all
 * (raw material, packaging), a caller-supplied one defaulted to USD (procured),
 * and a hardcoded USD that every live row contradicted (tooling). One resolver
 * for all four, so a fifth producer cannot invent a sixth convention.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The four provenance columns, named as the database names them so a producer
 * can spread the result straight into its insert payload rather than restating
 * each field and risking a mismatch.
 */
export interface CostRecordCurrencyColumns {
  currency: string | null;
  cost_currency_basis: PersistedCostCurrencyBasis;
  cost_currency_local: string | null;
  cost_fx_rate_from_local: number | null;
}

const isIsoCode = (v: unknown): v is string => typeof v === 'string' && /^[A-Z]{3}$/.test(v);

/**
 * Decide what a cost record should say about its own denomination.
 *
 * The three inputs map to the three things a producer can actually know:
 *
 *   convertedFrom          the producer converted the money itself and can name
 *                          the source currency and the rate. Fully traceable.
 *   declaredCurrency       the caller stated what currency the money is in.
 *                          Authoritative, no conversion involved.
 *   storedCurrencyFallback what the producer writes today when it knows
 *                          neither. Preserved verbatim so adding provenance
 *                          changes no existing behaviour -- but the row is
 *                          marked unverified, so nothing may do arithmetic
 *                          across it.
 *
 * The fallback is deliberately still stored. Blanking it would change what
 * existing readers see; marking it unverified changes only what may be
 * TRUSTED, which is the whole point of P1b-i.
 */
export function declareCostRecordCurrency(input: {
  declaredCurrency?: string | null;
  convertedFrom?: { fromCurrency: string; rateToStored: number } | null;
  storedCurrencyFallback?: string | null;
}): CostRecordCurrencyColumns {
  const { declaredCurrency, convertedFrom, storedCurrencyFallback } = input;

  const rate = convertedFrom?.rateToStored;
  const conversionIsTraceable =
    !!convertedFrom &&
    isIsoCode(convertedFrom.fromCurrency) &&
    rate != null &&
    Number.isFinite(rate) &&
    rate > 0;

  if (conversionIsTraceable && isIsoCode(declaredCurrency)) {
    return {
      currency: declaredCurrency,
      cost_currency_basis: 'converted',
      cost_currency_local: convertedFrom!.fromCurrency,
      cost_fx_rate_from_local: convertedFrom!.rateToStored,
    };
  }

  // A caller-stated currency with no conversion: the money simply is what the
  // caller says it is. ck_*_currency_traceable requires currency to equal
  // cost_currency_local for this basis, which is exactly the assertion.
  if (isIsoCode(declaredCurrency)) {
    return {
      currency: declaredCurrency,
      cost_currency_basis: 'local',
      cost_currency_local: declaredCurrency,
      cost_fx_rate_from_local: null,
    };
  }

  return {
    currency: isIsoCode(storedCurrencyFallback) ? storedCurrencyFallback : null,
    cost_currency_basis: 'legacy_unverified',
    cost_currency_local: null,
    cost_fx_rate_from_local: null,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Rate-column denomination (P1b-v)
 *
 * P1b-iv-c switched the persisted COST columns to factory-local currency, but
 * left the RATE columns behind, and that split them apart:
 *
 *   machine_rate  line.hourlyRate, which applyRoute now takes from the
 *                 pre-conversion route -- so LOCAL.
 *   labor_rate    picked from lhr_benchmark_rates by a rule that deliberately
 *                 preferred lhr_usd_effective whenever the row was not USD --
 *                 so USD.
 *   direct_rate   machine_rate + labor_rate, i.e. the two ADDED TOGETHER.
 *
 * On a USD factory both halves are USD and nothing is visible. On any other
 * factory the sum is meaningless. Measured against live lhr_benchmark_rates,
 * India / Sheet Metal:
 *
 *   lhr                144.46  INR/hr   <- the real local labour rate
 *   lhr_usd_effective    1.73  USD/hr   <- the same rate, converted
 *
 * so direct_rate was <machine INR/hr> + 1.73, understating the labour half of
 * the rate by the full FX factor (83.5) rather than being in the wrong
 * currency by an honest, traceable conversion.
 *
 * This does NOT change any persisted cost. setup_cost_per_part,
 * total_cycle_cost_per_part and total_cost_per_part are what eMithranTerms
 * charged and are passed through untouched. It changes the RATE columns, which
 * are read back as ProcessLineCost.hourlyRate and displayed.
 *
 * The rule is the same one the rest of this module enforces: a row's money is
 * in ONE declared currency, and a value that cannot be expressed in that
 * currency from real data is refused rather than approximated.
 * ──────────────────────────────────────────────────────────────────────────── */

/** The two rate columns lhr_benchmark_rates offers for the same labour rate. */
export interface BenchmarkLabourRateRow {
  /** The rate as denominated in `currency`. */
  lhr: number | null;
  /** The same rate converted to USD. Null/0 when never populated. */
  lhr_usd_effective: number | null;
  /** ISO 4217 code `lhr` is denominated in. */
  currency: string | null;
}

/**
 * Which of a benchmark row's two rate columns is denominated in
 * `targetCurrency`, or null when neither is.
 *
 * Returns the rate rather than a boolean so the caller cannot pick the wrong
 * column after asking the right question, and null rather than a fallback
 * because a labour rate in the wrong currency is not a degraded value -- it is
 * a different number entirely, and summing it into direct_rate is exactly the
 * defect this replaces.
 *
 * Note the deliberate asymmetry with the rule this supersedes: that one asked
 * only "is this row non-USD?" and, if so, always took lhr_usd_effective. It
 * never asked what currency the CALLER wanted, because until P1b-iv-c there
 * was only ever one answer.
 */
export function resolveBenchmarkLabourRate(
  row: BenchmarkLabourRateRow,
  targetCurrency: string,
): number | null {
  const local = Number(row.lhr);
  const usd = Number(row.lhr_usd_effective);

  // The row's own denomination matches what the caller is persisting: `lhr` is
  // already the right number, whatever currency that is (including USD).
  if (isIsoCode(row.currency) && row.currency === targetCurrency && Number.isFinite(local) && local > 0) {
    return local;
  }

  // The caller wants USD and the row carries a real converted value.
  if (targetCurrency === 'USD' && Number.isFinite(usd) && usd > 0) {
    return usd;
  }

  // A row with no currency of its own, but a usable `lhr`, can only be assumed
  // to be in the currency it was fetched for -- which is what the caller asked
  // for. This is the pre-707 seed shape, not a conversion.
  if (!isIsoCode(row.currency) && Number.isFinite(local) && local > 0) {
    return local;
  }

  return null;
}
