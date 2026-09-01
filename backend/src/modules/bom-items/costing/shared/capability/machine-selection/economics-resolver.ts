// Machine Economics provenance resolver — Phase 1 of the "Machine Economics"
// architecture initiative (see CLAUDE.md, 2026-08-22). Mirrors this file's
// own hydrateCapability() (selector.ts): DB row (real) -> reference/industry
// benchmark (machine_library.json, promoted via migration 537) -> one
// conservative generic fallback, never a per-location fabricated JS constant.
//
// This resolver serves mhr_records CRUD/display (mhr.service.ts, the Rate
// Table) — it is NOT wired into bom-items.service.ts's resolveMHRRates/
// resolveLHRRates (the real quote-costing engine), which already implement
// their own, more sophisticated benchmark-fallback chain keyed by
// (location, process_group). Reconciling the two is a deliberate, separate,
// higher-risk follow-up — see the Phase 1 plan's "explicit non-goals".

// 'lhr_shop_avg'/'lhr_benchmark' are labor-rate-only: resolved live from
// lhr_records/lhr_benchmark_rates by (location, process_group) — the same
// tables/precedence the real quote-costing engine uses (see
// LHRService.getEffectiveRate) — never set for direct/indirect overhead.
//
// 'generic_fallback' is a LEGACY tag only — it may still appear on rows
// persisted before 2026-08-30, when this resolver returned a fabricated
// GENERIC_FALLBACK_*_USD_HR = 0 for "nothing on file". The resolver itself
// never produces 'generic_fallback' anymore; every consumer must still
// recognize it (alongside the new 'no_rate') for those historical rows,
// since no data migration back-fills them. 'no_rate' is what the resolver
// actually returns today for the same "nothing on file" case — value: null,
// never a fabricated number (root-caused 2026-08-30, in direct response to
// "remove all fallback, i want real without fabricated, all database driven").
export type EconomicsSource = 'shop_override' | 'imported' | 'benchmark' | 'generic_fallback' | 'no_rate' | 'lhr_shop_avg' | 'lhr_benchmark';
export type EconomicsConfidence = 'high' | 'medium' | 'low';

export interface ResolvedRate {
  /** null means no real value and no benchmark exist — never a fabricated number. */
  value: number | null;
  source: EconomicsSource;
  confidence: EconomicsConfidence;
  /** Human caveat, only set for 'benchmark' / 'no_rate' — mirrors selector.ts's reasons(). */
  reason: string | null;
}

export interface MachineEconomics {
  directOverheadRate: ResolvedRate;
  indirectOverheadRate: ResolvedRate;
  laborRateUsdHr: ResolvedRate;
}

export interface MachineEconomicsRow {
  direct_overhead_rate: number | string | null | undefined;
  direct_overhead_source: string | null | undefined;
  indirect_overhead_rate: number | string | null | undefined;
  indirect_overhead_source: string | null | undefined;
  usd_lhr_total: number | string | null | undefined;
  labor_rate_source: string | null | undefined;
  benchmark_direct_overhead_rate_usd_hr: number | string | null | undefined;
  benchmark_indirect_overhead_rate_usd_hr: number | string | null | undefined;
  benchmark_labor_rate_usd_hr: number | string | null | undefined;
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

function isRealSource(s: string | null | undefined): s is 'shop_override' | 'imported' | 'lhr_shop_avg' | 'lhr_benchmark' {
  return s === 'shop_override' || s === 'imported' || s === 'lhr_shop_avg' || s === 'lhr_benchmark';
}

function resolveOneRate(
  realValue: number | null,
  realSource: string | null | undefined,
  benchmarkValue: number | null,
  fieldLabel: string,
): ResolvedRate {
  if (realValue != null) {
    // Defensive default to 'imported', exactly like hydrateCapability's
    // `row.capability_source ?? 'imported'` — a real numeric value on the
    // row with no source tag predates this initiative and is still real data.
    const source = isRealSource(realSource) ? realSource : 'imported';
    return { value: realValue, source, confidence: 'high', reason: null };
  }
  if (benchmarkValue != null) {
    return {
      value: benchmarkValue,
      source: 'benchmark',
      confidence: 'medium',
      reason: `${fieldLabel} from industry benchmark data (machine_library) — verify against this shop's actual cost`,
    };
  }
  // Nothing real, nothing benchmarked — value stays null. Never fabricate a
  // number here (was a hardcoded 0 through 2026-08-29); callers must treat
  // this as a genuine data gap (block, warn, or preserve an existing value —
  // never silently zero-fill).
  return {
    value: null,
    source: 'no_rate',
    confidence: 'low',
    reason: `No ${fieldLabel.toLowerCase()} on file — no real value or benchmark data exists`,
  };
}

export function resolveMachineEconomics(row: MachineEconomicsRow): MachineEconomics {
  return {
    directOverheadRate: resolveOneRate(
      num(row.direct_overhead_rate), row.direct_overhead_source,
      num(row.benchmark_direct_overhead_rate_usd_hr),
      'Direct overhead rate',
    ),
    indirectOverheadRate: resolveOneRate(
      num(row.indirect_overhead_rate), row.indirect_overhead_source,
      num(row.benchmark_indirect_overhead_rate_usd_hr),
      'Indirect overhead rate',
    ),
    laborRateUsdHr: resolveOneRate(
      num(row.usd_lhr_total), row.labor_rate_source,
      num(row.benchmark_labor_rate_usd_hr),
      'Labor rate',
    ),
  };
}
