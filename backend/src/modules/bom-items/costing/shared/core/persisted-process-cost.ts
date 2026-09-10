/**
 * The one way to read the per-part cost of a persisted process_cost_records row
 * (P1b-iv-b).
 *
 * WHY THIS EXISTS
 *
 * Four code paths independently answered "what does this operation cost?" from
 * the same table, and three of them re-derived it from the rate columns instead
 * of reading the cost the engine had already computed:
 *
 *   process-cost.service.ts  getTotalProcessCostForBomItem  prefer-stored, with
 *                                                           an inline fallback
 *   process-cost.service.ts  bulk totals                    the SAME pattern,
 *                                                           copy-pasted
 *   boms.service.ts          BOM list totals                re-derived, NO
 *                                                           prefer-stored
 *   cost-aggregation.service.ts                              re-derived, NO
 *                                                           prefer-stored
 *
 * Measured on live data: of 55 active rows that DO carry a stored engine cost,
 * 51 disagree with the re-derived figure by more than 1%, with per-row ratios
 * from 0.285x to 1.963x. The engine cost includes labour, QA inspection
 * sampling and yield loss that the rate-only formula below cannot see, so the
 * re-derivation is not a rounding difference -- it is a different, poorer cost
 * model. Anything reading this table must therefore prefer the stored value.
 *
 * WHY THE FALLBACK STAYS
 *
 * 50 of 105 active rows still have total_cost_per_part NULL: the column was
 * only introduced into the write paths recently (migration 706 for the route
 * writer), so every row applied before that has nothing stored. Reading the
 * column alone would report those rows as 0 and silently drop real cost out of
 * BOM and project totals.
 *
 * So the fallback is deliberate and temporary, it reproduces the existing
 * formula EXACTLY so no total moves because of this refactor, and every result
 * is labelled with `source` so the remaining legacy rows stay countable. It is
 * not a second cost model competing with the first: it only ever runs where the
 * first left nothing behind.
 *
 * The way to retire it is to give those rows a real engine cost -- re-apply
 * their route, or re-save the manual record -- not to widen this formula.
 */

/** Every column resolvePersistedProcessCost needs. Select exactly this. */
export const PERSISTED_PROCESS_COST_COLUMNS =
  'total_cost_per_part, setup_cost_per_part, total_cycle_cost_per_part, ' +
  'machine_rate, labor_rate, setup_manning, setup_time, batch_size, heads, ' +
  'cycle_time, parts_per_cycle, scrap';

export type PersistedCostSource = 'stored' | 'derived_legacy_fallback';

export interface PersistedProcessCostRow {
  total_cost_per_part?: number | string | null;
  setup_cost_per_part?: number | string | null;
  total_cycle_cost_per_part?: number | string | null;
  machine_rate?: number | string | null;
  labor_rate?: number | string | null;
  setup_manning?: number | string | null;
  setup_time?: number | string | null;
  batch_size?: number | string | null;
  heads?: number | string | null;
  cycle_time?: number | string | null;
  parts_per_cycle?: number | string | null;
  scrap?: number | string | null;
}

export interface ResolvedProcessCost {
  totalCostPerPart: number;
  setupCostPerPart: number;
  cycleCostPerPart: number;
  /**
   * 'stored' means the engine cost was read back verbatim. Anything else means
   * this row has never had its real cost persisted, and the number came from
   * the rate-only formula.
   */
  source: PersistedCostSource;
}

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

/**
 * A stored NULL means "never costed"; a stored 0 means "the engine charged
 * nothing". They are different, and only the first may fall back -- treating a
 * genuine zero as missing would silently substitute a derived number for a real
 * one.
 */
const isStored = (v: number | string | null | undefined): boolean =>
  v !== null && v !== undefined && Number.isFinite(typeof v === 'number' ? v : parseFloat(String(v)));

export function resolvePersistedProcessCost(row: PersistedProcessCostRow): ResolvedProcessCost {
  if (isStored(row.total_cost_per_part)) {
    return {
      totalCostPerPart: num(row.total_cost_per_part),
      // Components are read as stored. A row can carry a total without them
      // (nothing wrote the components before migration 706 either), in which
      // case they read 0 -- the total remains the authoritative figure.
      setupCostPerPart: num(row.setup_cost_per_part),
      cycleCostPerPart: num(row.total_cycle_cost_per_part),
      source: 'stored',
    };
  }

  // Legacy fallback. Identical to the formula already present in
  // process-cost.service.ts, boms.service.ts and cost-aggregation.service.ts,
  // so replacing those with this call changes no number.
  //
  //   setupPerPart = (setup_time_min / 60  x (MHR + LHR x manning)) / batch_size
  //   cyclePerPart = (cycle_time_sec / 3600 x (MHR + LHR x heads))  / parts_per_cycle
  //   totalPerPart = (setupPerPart + cyclePerPart) x (1 + scrap / 100)
  const mr = num(row.machine_rate);
  const lr = num(row.labor_rate);
  const sm = num(row.setup_manning);
  const st = num(row.setup_time);
  const bs = num(row.batch_size) || 1;
  const hd = num(row.heads);
  const ct = num(row.cycle_time);
  const ppc = num(row.parts_per_cycle) || 1;
  const sc = num(row.scrap);

  const setupRaw = bs > 0 ? (st / 60) * (mr + lr * sm) / bs : 0;
  const cycleRaw = ppc > 0 ? (ct / 3600) * (mr + lr * hd) / ppc : 0;
  const scrapFactor = 1 + sc / 100;

  return {
    // Scrap is applied to each component as well as the total, so the two
    // components always add up to the total rather than quietly disagreeing.
    setupCostPerPart: setupRaw * scrapFactor,
    cycleCostPerPart: cycleRaw * scrapFactor,
    totalCostPerPart: (setupRaw + cycleRaw) * scrapFactor,
    source: 'derived_legacy_fallback',
  };
}

/** Sum of a set of rows, plus how many still needed the legacy fallback. */
export function sumPersistedProcessCost(rows: readonly PersistedProcessCostRow[]): {
  total: number;
  storedCount: number;
  fallbackCount: number;
} {
  let total = 0, storedCount = 0, fallbackCount = 0;
  for (const row of rows) {
    const r = resolvePersistedProcessCost(row);
    total += r.totalCostPerPart;
    if (r.source === 'stored') storedCount++;
    else fallbackCount++;
  }
  return { total, storedCount, fallbackCount };
}

/**
 * The cost-engine contract a persisted row was written under
 * (process_cost_records.engine_version, migration 718).
 *
 * WHAT IT IS FOR
 *
 * Not a build number and not a schema version. It answers exactly one question
 * a reader has to ask before trusting a column: was this row written by a
 * producer that meant the same thing by that column as I do?
 *
 * The concrete case it exists for is direct_rate, which across live rows holds
 * machine + labour, or the machine rate alone, or neither, depending on which
 * producer wrote it and when. A reader cannot tell those apart from the value.
 * With this stamp it does not have to: a row that carries it also carries
 * line_hourly_rate, which has one meaning, and a row that does not is read the
 * old way rather than reinterpreted.
 *
 * BUMP IT when the meaning of a persisted column changes -- not when a formula
 * inside an engine changes. A rate that moves is drift, and
 * detectAppliedGenerationDrift already reports that. This is for when the same
 * number starts meaning something else.
 */
export const COST_ENGINE_CONTRACT_VERSION = 'emithran-cost-1';
