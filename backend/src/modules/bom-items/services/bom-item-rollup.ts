/**
 * The currency-aware BOM aggregate rollup (P1b-iii).
 *
 * This is the pure decision core. It performs no database access and holds no
 * FX table of its own: the caller resolves ONE FX snapshot and passes it in as
 * a single lookup closure, which is what guarantees every amount in one rollup
 * is converted through the same rates.
 *
 * WHY THIS EXISTS
 *
 * Until P1b-ii, bom_item_costs money was computed by SQL triggers that summed
 * amounts whose currencies they could not know. Migration 708 established that
 * the inputs genuinely differ in denomination -- one live aggregate row
 * (bom_item b0eac6f0) reports 973.6419 as USD for money that is mostly rupees.
 * Those triggers now only mark the aggregate stale, and this is the one place
 * the money is worked out.
 *
 * THE CONTRACT
 *
 *   basis 'local'              amount is denominated in `currency`.
 *   basis 'converted'          amount is denominated in `currency`, and the
 *                              producer recorded what it converted from.
 *   basis 'legacy_unverified'  the denomination cannot be established. Such an
 *                              amount must NOT take part in a trusted
 *                              cross-currency total.
 *
 * So for any TRUSTED row the `currency` column is authoritative, whichever of
 * the two trusted bases it carries. That is the only thing this core needs.
 *
 * FAIL CLOSED
 *
 * If any contributing amount is unverified, or its currency is undeclared, or
 * the snapshot cannot supply a rate for it, this returns trusted: false and
 * NO totals. The caller must then leave the stored money untouched and leave
 * the aggregate stale. A numerically plausible total assembled from amounts of
 * unknown denomination is worse than no total, because nothing downstream can
 * tell the difference.
 */

/** Which aggregate column an amount contributes to. */
export type RollupInputKind =
  | 'raw_material'
  | 'packaging_logistics'
  | 'procured_parts'
  | 'process'
  | 'tooling'
  | 'direct_children';

export const ROLLUP_INPUT_KINDS: readonly RollupInputKind[] = [
  'raw_material', 'packaging_logistics', 'procured_parts', 'process', 'tooling', 'direct_children',
];

/** The currency basis vocabulary shared with migrations 707 and 708. */
export type RollupSourceBasis = 'legacy_unverified' | 'converted' | 'local';

export interface RollupSourceAmount {
  kind: RollupInputKind;
  /** The stored amount, in whatever currency `currency` names. */
  amount: number;
  /** Declared ISO 4217 code, or null when the producer declared none. */
  currency: string | null;
  /** cost_currency_basis from the source row, or null when absent. */
  basis: RollupSourceBasis | null;
  /** Row id / child item id, carried into provenance so a total is explainable. */
  ref?: string | null;
}

export type RollupIntegrity = 'consistent' | 'unverified' | 'mixed';

export interface RollupProvenance {
  reportingCurrency: string;
  /** Every rate actually applied, keyed by source currency. All from one snapshot. */
  fxRates: Record<string, number>;
  /** One entry per contributing amount, in the order supplied. */
  inputs: Array<{
    kind: RollupInputKind;
    ref: string | null;
    currency: string | null;
    basis: RollupSourceBasis | null;
    amountSource: number;
    /** Converted amount, or null when this input could not be trusted. */
    amountReporting: number | null;
    /** Populated only when this input blocked a trusted rollup. */
    reason?: string;
  }>;
  /** Kinds that contributed at least one untrusted non-zero amount. */
  untrustedKinds: RollupInputKind[];
  /** Distinct declared currencies seen across contributing amounts. */
  declaredCurrencies: string[];
  computedAt: string;
}

export interface RollupResult {
  trusted: boolean;
  integrity: RollupIntegrity;
  reportingCurrency: string;
  /**
   * Per-kind and derived totals in the reporting currency. null whenever
   * trusted is false -- there is deliberately no partial or best-effort total.
   */
  totals: null | (Record<RollupInputKind, number> & {
    own_cost: number;
    total_cost: number;
    unit_cost: number;
  });
  provenance: RollupProvenance;
}

const isIsoCode = (v: unknown): v is string => typeof v === 'string' && /^[A-Z]{3}$/.test(v);
const isTrustedBasis = (b: RollupSourceBasis | null): boolean => b === 'local' || b === 'converted';

/**
 * A zero amount cannot change a total in any currency, so an unverified row
 * worth 0 does not block trust. Without this, a single stray legacy row with
 * no money in it would permanently prevent any item from ever producing a
 * trusted aggregate, which would be strictness with no arithmetic meaning.
 */
const contributes = (amount: number): boolean => Number.isFinite(amount) && amount !== 0;

export function computeCurrencyAwareRollup(input: {
  amounts: RollupSourceAmount[];
  reportingCurrency: string;
  /**
   * from -> reportingCurrency, resolved from ONE FX snapshot by the caller.
   * Must return null rather than a guess when the snapshot has no rate: a
   * fabricated rate is the one thing this core must never see.
   */
  rateToReporting: (fromCurrency: string) => number | null;
  /** Injected for deterministic provenance in tests. */
  now?: () => string;
}): RollupResult {
  const { amounts, reportingCurrency, rateToReporting } = input;
  const computedAt = (input.now ?? (() => new Date().toISOString()))();

  if (!isIsoCode(reportingCurrency)) {
    throw new Error(
      `computeCurrencyAwareRollup: reportingCurrency must be an ISO 4217 code, got ${String(reportingCurrency)}`,
    );
  }

  const fxRates: Record<string, number> = {};
  const provInputs: RollupProvenance['inputs'] = [];
  const untrusted = new Set<RollupInputKind>();
  const declared = new Set<string>();
  const sums: Record<RollupInputKind, number> = {
    raw_material: 0, packaging_logistics: 0, procured_parts: 0,
    process: 0, tooling: 0, direct_children: 0,
  };

  for (const a of amounts) {
    const ref = a.ref ?? null;
    if (isIsoCode(a.currency)) declared.add(a.currency);

    if (!contributes(a.amount)) {
      // Recorded for explainability, but neither summed nor able to block.
      provInputs.push({
        kind: a.kind, ref, currency: a.currency, basis: a.basis,
        amountSource: Number.isFinite(a.amount) ? a.amount : 0, amountReporting: 0,
      });
      continue;
    }

    if (!isTrustedBasis(a.basis)) {
      untrusted.add(a.kind);
      provInputs.push({
        kind: a.kind, ref, currency: a.currency, basis: a.basis,
        amountSource: a.amount, amountReporting: null,
        reason: `basis ${a.basis ?? 'null'} cannot take part in a trusted total`,
      });
      continue;
    }

    if (!isIsoCode(a.currency)) {
      untrusted.add(a.kind);
      provInputs.push({
        kind: a.kind, ref, currency: a.currency, basis: a.basis,
        amountSource: a.amount, amountReporting: null,
        reason: 'no declared currency',
      });
      continue;
    }

    // Same currency needs no conversion; anything else is converted exactly
    // once, here, using the caller single snapshot.
    let rate: number | null;
    if (a.currency === reportingCurrency) {
      rate = 1;
    } else if (fxRates[a.currency] != null) {
      rate = fxRates[a.currency];
    } else {
      rate = rateToReporting(a.currency);
      if (rate != null && Number.isFinite(rate) && rate > 0) fxRates[a.currency] = rate;
    }

    if (rate == null || !Number.isFinite(rate) || rate <= 0) {
      untrusted.add(a.kind);
      provInputs.push({
        kind: a.kind, ref, currency: a.currency, basis: a.basis,
        amountSource: a.amount, amountReporting: null,
        reason: `no ${a.currency} to ${reportingCurrency} rate in the resolved FX snapshot`,
      });
      continue;
    }

    const converted = a.amount * rate;
    sums[a.kind] += converted;
    provInputs.push({
      kind: a.kind, ref, currency: a.currency, basis: a.basis,
      amountSource: a.amount, amountReporting: converted,
    });
  }

  const provenance: RollupProvenance = {
    reportingCurrency,
    fxRates,
    inputs: provInputs,
    untrustedKinds: [...untrusted],
    declaredCurrencies: [...declared].sort(),
    computedAt,
  };

  if (untrusted.size > 0) {
    // 'mixed' is reserved for the genuinely unresolvable case: money we cannot
    // interpret AND more than one currency in play, which is what makes the
    // stored total a currency salad rather than merely unverified.
    return {
      trusted: false,
      integrity: declared.size > 1 ? 'mixed' : 'unverified',
      reportingCurrency,
      totals: null,
      provenance,
    };
  }

  const own =
    sums.raw_material + sums.packaging_logistics + sums.procured_parts + sums.process + sums.tooling;
  const total = own + sums.direct_children;

  return {
    trusted: true,
    integrity: 'consistent',
    reportingCurrency,
    totals: { ...sums, own_cost: own, total_cost: total, unit_cost: total },
    provenance,
  };
}
