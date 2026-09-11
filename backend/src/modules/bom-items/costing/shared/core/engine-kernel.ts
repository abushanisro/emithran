// Shared arithmetic kernel for every registered ManufacturingProcessEngine
// (sheet-metal cutting/forming/secondary-op engines — CNC/IM compute their
// own whole-quote CostSummaryDto and don't call this). Extracted from what
// was previously copy-pasted verbatim into each engine file (Track B, Phase
// 1): the r2() rounder and the no-DB-rate fallback literal.
//
// eMithranTerms() moved here from cost-engine.ts (Platform Architecture
// Remediation Phase 1, engine registry unification) — it is the platform's
// one real, generic cost-composition core (machine + setup + direct-labor +
// QA inspection-sampling + yield-loss cost), already reused identically by
// all 9 of computeCostSummary()'s inline process blocks. Root-cause bug this
// move fixes: the 7 registered cutting/forming engines (laser/waterjet/
// turret/router/press) instead computed cost through a narrower path with no
// inspection-sampling term and no yield-loss term — so the same operation on
// the same part could produce two different dollar totals depending on which
// code path ran. Every engine now imports eMithranTerms from here, and
// cost-engine.ts's own 9 call sites import it back from here too — one
// formula core, not two.
import type { MHRRateInput } from './cost-engine';
import type { LookupResolution, LookupTableRow } from '../../../dto/cost-breakdown.dto';

export function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function noRateFallback(machineClass: string): MHRRateInput {
  return { rate: 0, source: 'no_db_rate', machineClass, machineName: null, commodityCode: null };
}

// Root-caused 2026-09-04: getRouteComparison() used to append a separate
// real Press Brake process line to EVERY route with real bends — cutting
// routes (Laser/Turret/Waterjet/etc., none of which can bend) AND forming
// routes (Standard Press/Tandem Press/Progressive Die Press/Roll Bending
// 2/3/4) alike — double-charging bending for the forming-family routes,
// since their own real registered catalog taxonomy
// (process_calculator_mappings, e.g. "Std Press:Std Press//StraightBend",
// "Tandem Press:Bending//StraightBend", "Progressive Die:Die Station:
// Bending//StraightBend", "2/3/4 Roll Bending:...//StraightBend" — verified
// directly against memory/sheetmetal/process/process_operations.json)
// confirms all 6 of these classes perform bending as part of their own
// process, not as a downstream operation. A 'cutting' route still needs the
// separate Press Brake line — none of those machines can bend. Pure boolean
// so it's directly unit-testable without mocking the Supabase-backed
// getRouteComparison() call site that consumes it.
export function shouldAddSeparatePressBrakeLine(processFamily: 'cutting' | 'forming'): boolean {
  return processFamily !== 'forming';
}

export interface EMithranTermsArgs {
  mhrPerHr: number;
  dlrPerHr: number;
  qairPerHr: number;
  // Operators present during setup vs. during the run — distinct real-world
  // counts (e.g. one person tends setup, a different headcount runs the
  // cycle). Every current caller passes the same value for both.
  setupNDL: number;
  cycleNDL: number;
  cycleTimeMin: number;
  setupTimeMin: number;
  inspTimeMin: number;
  samplingRate: number;
  yieldPct: number;
  netMatCost: number;
  netWeightKg: number;
  scrapPricePerKg: number;
}

export interface EMithranTermsResult {
  machineCost: number;
  setupCost: number;
  laborCost: number;
  inspCost: number;
  yieldCost: number;
  total: number;
}

/**
 * The one real, generic cost-composition core every registered sheet-metal
 * engine (cutting/forming/secondary-op) uses: machine time cost, setup cost
 * (machine idle + direct-labor idle), run direct-labor cost, QA
 * inspection-sampling cost, and yield-loss cost. Not a per-process formula —
 * every call site supplies its own rate/time/labor inputs, but the
 * composition shape (and, critically, which cost components exist at all)
 * is identical everywhere, so two engines pricing the "same" operation can
 * never silently diverge on which cost terms they include.
 */
export function eMithranTerms(args: EMithranTermsArgs): EMithranTermsResult {
  const { mhrPerHr, dlrPerHr, qairPerHr, setupNDL, cycleNDL, cycleTimeMin, setupTimeMin,
          inspTimeMin, samplingRate, yieldPct, netMatCost, netWeightKg, scrapPricePerKg } = args;

  const mhrMin = mhrPerHr / 60;
  const dlrMin = dlrPerHr / 60;
  const qairMin = qairPerHr / 60;

  const machineCost = mhrMin * cycleTimeMin;
  // Setup: machine idle time + DL idle time (no SL in this deployment)
  const setupCost = (mhrMin + dlrMin * setupNDL) * setupTimeMin;
  const laborCost = dlrMin * cycleNDL * cycleTimeMin;
  const inspCost = qairMin * inspTimeMin * samplingRate;

  const scrapValue = netWeightKg * scrapPricePerKg;
  const yieldBase = Math.max(0, netMatCost - scrapValue + machineCost + setupCost + laborCost + inspCost);
  const yieldCost = (1 - yieldPct) * yieldBase;

  const total = machineCost + setupCost + laborCost + inspCost + yieldCost;
  return { machineCost, setupCost, laborCost, inspCost, yieldCost, total };
}


// ── Setup-time resolution ─────────────────────────────────────────────────────
// One place that answers "how many minutes of setup does THIS operation on THIS
// machine really take", in strict most-specific-real-data-first order.
//
// Four real sources exist in this system and were not being ranked:
//   0. a real DB calculator's own Setup Time output, computed from THIS part's
//      geometry and tooling (e.g. the Sheet Metal Bending calculator's
//      "Tool Loading Time / Lot Size"). Strictly more specific than any
//      per-machine figure, because it knows the part, so it outranks it.
//   1. mhr_records.setup_time_hr — the REAL per-machine setup time, staged from
//      the machine library (336 of 337 machines carry it) and already surfaced
//      as MachineCandidate.setupTimeHr / MHRRateInput.setupTimeHr. The Injection
//      Molding engines already prefer it (see cost-compression-molding-engine);
//      the sheet-metal engines never consulted it at all.
//   2. sm_lookup_op_setup_time — real per-OPERATION setup, less specific than a
//      named machine but still real, sourced data.
//   3. the per-class *_SETUP_MIN constant — a disclosed, cited fallback.
//
// Ranking them this way is what makes a quote reflect the machine actually
// selected: two press brakes with genuinely different real setup times used to
// produce byte-identical setup cost, because only (2)/(3) were ever read.
//
// `source` is returned, not inferred, so the line can disclose which tier it
// used rather than presenting a class default as if it were machine-specific.
export type SetupTimeSource = 'calculator' | 'machine' | 'operation_lookup' | 'class_default';

export interface SetupTimeResolution {
  /** Real, un-amortised setup minutes for one batch. */
  setupMin: number;
  source: SetupTimeSource;
  /** Present only when a less-specific tier had to be used — for the quote warnings list. */
  warning?: string;
}

export function resolveSetupMinutes(args: {
  /** Process label, for the disclosure warning. */
  process: string;
  /**
   * Un-amortised minutes from a real DB calculator that modelled THIS part
   * (bend count, tooling, lot size...). Highest priority: it is the only tier
   * that knows the part rather than just the machine or the operation.
   */
  calculatorSetupMin?: number | null;
  /** MHRRateInput.setupTimeHr — the real per-machine value, hours. */
  machineSetupTimeHr?: number | null;
  /** Real per-operation minutes from sm_lookup_op_setup_time, when found. */
  operationSetupMin?: number | null;
  /** Cited per-class constant, used only when neither real source resolved. */
  classDefaultMin: number;
  /** Machine name, for a more useful disclosure message. */
  machineName?: string | null;
}): SetupTimeResolution {
  const { process, calculatorSetupMin, machineSetupTimeHr, operationSetupMin, classDefaultMin, machineName } = args;

  // A calculator result is derived from this part's own real geometry, so it
  // beats a generic machine or operation figure. Same "0 is not a real value"
  // rule as the tiers below.
  if (typeof calculatorSetupMin === 'number' && Number.isFinite(calculatorSetupMin) && calculatorSetupMin > 0) {
    return { setupMin: calculatorSetupMin, source: 'calculator' };
  }

  // A machine with a real, positive setup_time_hr on file is the most specific
  // true answer available. 0 is deliberately NOT accepted as "real" here: every
  // staged machine has a positive setup time, so a 0 means the column was never
  // populated, not that the machine sets up instantly.
  if (typeof machineSetupTimeHr === 'number' && Number.isFinite(machineSetupTimeHr) && machineSetupTimeHr > 0) {
    return { setupMin: machineSetupTimeHr * 60, source: 'machine' };
  }

  // A per-operation sm_lookup_op_setup_time row is REAL, sourced data — just
  // less specific than a named machine. Landing here is not a data gap, so it
  // raises no quote warning; `source` is what discloses the tier. (Warning here
  // would fire on nearly every sheet-metal line today, since most classes have
  // no per-machine setup_time_hr yet, drowning the genuine gaps below it.)
  if (typeof operationSetupMin === 'number' && Number.isFinite(operationSetupMin) && operationSetupMin > 0) {
    return { setupMin: operationSetupMin, source: 'operation_lookup' };
  }

  // Genuinely unsourced: no real per-machine setup_time_hr AND no real
  // per-operation row. Keeps the established "setup time from fallback" marker
  // phrase every engine already disclosed under, now naming both real sources
  // that were missing so the gap is actionable.
  return {
    setupMin: classDefaultMin,
    source: 'class_default',
    warning: `${process}: setup time from fallback — no real per-machine setup_time_hr` +
      `${machineName ? ` for ${machineName}` : ''} in mhr_records and no sm_lookup_op_setup_time row; ` +
      `using the ${String(classDefaultMin)} min class default.`,
  };
}

// ── Benchmark rate-override decision ──────────────────────────────────────────
// Whether a machine rate resolved from mhr_records should be thrown away and
// replaced by the location's class benchmark.
//
// The guard exists to catch two CURRENCY MIS-SCALE import errors, both
// order-of-magnitude (an INR figure read as USD is ~83x out). It does not exist
// to enforce that every machine in a class costs about the same — real fleets
// span a wide range by machine price, and mhr_benchmark_rates carries only ONE
// industry-average row per class for most classes.
//
// Extracted from bom-items.service.ts so this decision is directly testable:
// it silently changed the billed rate on real quotes and had no test of its own.
export interface BenchmarkOverrideInput {
  /** Resolved machine rate, local currency/hr. */
  rate: number;
  /** True only for a rate that came from a real mhr_records row. */
  isDbRate: boolean;
  /** Location+class benchmark; <= 0 means none on file. */
  benchmark: number;
  /** This record's own Direct/Indirect overhead, when it has a breakdown. */
  directOverheadRate?: number | null;
  indirectOverheadRate?: number | null;
  /** Real, DB-configurable bands (costing_settings), not literals. */
  thresholds: { lowFraction: number; highFraction: number };
}

export type BenchmarkOverrideDecision =
  | { override: false }
  | { override: true; reason: string };

export function decideBenchmarkOverride(input: BenchmarkOverrideInput): BenchmarkOverrideDecision {
  if (!input.isDbRate) return { override: false };
  if (!(input.benchmark > 0)) return { override: false };
  if (!Number.isFinite(input.rate)) return { override: false };

  // A rate that EQUALS this record's own Direct + Indirect overhead IS the
  // canonical Machine Hour Rate by definition (migration 581), so it cannot be
  // one of the mis-scaled imports this guard targets. Verified live across the
  // fleet: 355 of 355 rows with the data satisfy rate == direct + indirect
  // exactly, so this recognises real rates rather than excusing bad ones.
  //
  // Scope note, so this is not over-claimed: this is hardening, not the fix for
  // a confirmed live overcharge. resolveMHRRates DOES log override warnings for
  // several machines, but a before/after capture of the cost-summary endpoint
  // (2026-09-05) showed the sheet-metal lines already resolving at their real
  // mhr_database rate, not the benchmark — so no billed rate was observed to
  // change here. What it guarantees is that a correctly-derived canonical rate
  // can never be discarded merely for being cheaper than the single
  // industry-average benchmark row most classes have (mhr_benchmark_rates,
  // migration 345), which a real fleet spanning a wide price range will trip.
  const doh = input.directOverheadRate;
  const ioh = input.indirectOverheadRate;
  const hasBreakdown = typeof doh === 'number' && Number.isFinite(doh)
    && typeof ioh === 'number' && Number.isFinite(ioh) && doh + ioh > 0;
  if (hasBreakdown && Math.abs(input.rate - (doh + ioh)) < 0.005) {
    return { override: false };
  }

  if (input.rate < input.benchmark * input.thresholds.lowFraction) {
    return {
      override: true,
      reason: `below ${String(Math.round(input.thresholds.lowFraction * 100))}% of location benchmark — likely a cross-location currency mismatch`,
    };
  }
  if (input.rate > input.benchmark * input.thresholds.highFraction) {
    return {
      override: true,
      reason: `over ${String(input.thresholds.highFraction)}x the location benchmark — likely an INR rate double-converted via USD import`,
    };
  }
  return { override: false };
}

// ── Route data completeness ───────────────────────────────────────────────────
//
// A route can be physically capable and still be uncostable, because the real
// reference data one of its operations needs is not on file. The engines already
// detect this and refuse to invent a number — computePressStrokeCost warns
// "Tandem Press: no real press_cycle_time_s on file for the selected machine —
// cycle time is $0 until real data is added for it, not an estimate", and
// computeRouterCost warns the same about a missing sm_lookup_router_cut row.
// That is the correct engine behaviour and is deliberately unchanged here.
//
// The defect this closes is downstream: a $0 operation made those routes the
// CHEAPEST in the comparison, so the missing data read as an economic advantage.
// Auto selection must never resolve to a route whose price is an artefact of
// absent data.
//
// The predicate below is not a new rule. It is the one apply-route already
// enforces before writing any process_cost_records row (a line with a
// physicsGap, or a cycle time under one second, which the cycle_time >= 1 column
// constraint from migration 034 cannot store). Extracted here so route ranking
// and route persistence cannot drift: a route Auto can pick is exactly a route
// apply-route will accept, which is what makes the selection deterministic.

/** One operation whose required costing data is missing. */
export interface RouteDataGap {
  process: string;
  machineClass: string;
  /** Ready-to-display explanation of what is missing — never a fabricated value. */
  reason: string;
  /**
   * Real rows nearest the failed lookup query, when the gap came from a
   * missing_lookup and the resolver found candidates to disclose (e.g. the
   * lookup table's smallest tonnage bucket when the selected machine's real
   * tonnage falls below it). Never fabricated or interpolated into a usable
   * value here — these are for disclosure only, so a route-apply rejection
   * says what data DOES exist instead of only "add a row".
   */
  nearestRows?: LookupTableRow[];
}

/** Only the fields of a process line this predicate reads. */
export interface RouteDataGapLine {
  process: string;
  machineClass?: string | null;
  cycleTimeMin: number;
  /**
   * Un-amortised setup minutes, or undefined when the engine did not resolve
   * one. `process_cost_records.setup_time` is NOT NULL, so an unresolved setup
   * cannot be persisted as "unknown" — it used to be persisted as the literal
   * 15, which is why this is a gap and not a nullable column.
   */
  setupTimeMin?: number | null;
  physicsGap?:
    | {
        gapType: 'missing_lookup';
        requiredAction: string;
        /** Present when the engine's lookup resolver found nearby real rows to disclose. */
        lookupResolution?: LookupResolution;
      }
    | { gapType: 'unsupported_operation'; reason: string }
    | null
    | undefined;
}

/**
 * "Nearest real rows on file: ..." disclosure text, or '' when there are none
 * to show. Shared by the apply-route rejection (bom-items.controller.ts) and
 * the per-engine "cycle time unavailable" warning (e.g. press-brake-engine.ts)
 * so both surfaces describe the same real lookup-resolver output the same
 * way, instead of two independently-drifting formatters. Never a substitute
 * value — only ever real rows a lookup resolver already found in the table.
 */
export function formatNearestRowsDisclosure(rows: readonly LookupTableRow[] | undefined): string {
  if (!rows || rows.length === 0) return '';
  return ' Nearest real rows on file: ' +
    rows
      .map((row) => Object.entries(row.columns).map(([col, val]) => `${col}=${val}`).join(', '))
      .join(' | ') +
    '.';
}

/**
 * The persistable floor for process_cost_records.cycle_time.
 *
 * 0.01 s — the smallest non-zero value the column can hold, since it is
 * NUMERIC(_,2). Verified empirically against the live table: inserts of 0.36,
 * 0.6 and 0.01 are all ACCEPTED and stored exactly.
 *
 * This was 1, documented as "from process_cost_records.cycle_time
 * (migration 034)". Migration 034 does declare CHECK (cycle_time >= 1), but it
 * runs CREATE TABLE IF NOT EXISTS over a table that already existed, so none of
 * its constraints were ever applied — the same file/live drift recorded in
 * migrations 706 and 712. The floor was therefore enforcing a constraint that
 * does not exist, and it disqualified genuinely fast real processes:
 *
 *   Progressive Die  0.36 s/part (Aida UMX-600, real press_cycle_time_s)
 *   3 Roll Bending   0.6 s/part  (real feed-rate model, no physicsGap)
 *
 * Both were marked dataComplete=false, which excluded them from
 * selectRecommendedRoute. On a real SECC part that left Standard Press (1.25)
 * as the only eligible route while Progressive Die (1.16) and 3 Roll Bending
 * (1.15) were cheaper and fully costed — so the recommendation could not
 * change no matter what the scenario said.
 *
 * A cycle of 0 is still a gap: it means nothing resolved a cycle time, not that
 * the operation is instantaneous.
 */
const MIN_PERSISTABLE_CYCLE_SEC = 0.01;

/**
 * Every operation in `lines` whose required costing data is missing, in line
 * order. Empty means the route is fully costed and can be both ranked and
 * applied.
 */
export function findRouteDataGaps(lines: readonly RouteDataGapLine[]): RouteDataGap[] {
  const gaps: RouteDataGap[] = [];
  for (const line of lines) {
    const cycleTimeSec = Math.round(line.cycleTimeMin * 60 * 100) / 100;
    let reason: string | null = null;
    let nearestRows: LookupTableRow[] | undefined;

    if (line.physicsGap) {
      if (line.physicsGap.gapType === 'missing_lookup') {
        reason = line.physicsGap.requiredAction;
        nearestRows = line.physicsGap.lookupResolution?.nearestRows;
      } else {
        reason = line.physicsGap.reason;
      }
    } else if (cycleTimeSec < MIN_PERSISTABLE_CYCLE_SEC) {
      // Says what is actually wrong. A cycle that rounds to 0.00 s at the
      // column scale means no cycle time was resolved at all -- which is what
      // happens when no capable machine was selected -- not that the operation
      // is too fast to store.
      reason = 'no cycle time was resolved for this operation, so it cannot be costed or persisted';
    } else if (line.setupTimeMin == null) {
      // The write path used `line.setupTimeMin ?? 15`. Fifteen minutes is not a
      // setup time anyone measured, published or chose — every real source in
      // this system says otherwise (30min across all 8 press machines, 22.8min
      // across all 10 shearing machines, or the machine's own setup_time_hr).
      // A row saved at 15 disagreed with the quote that produced it, and the
      // Cost Guide re-derives setup cost from the row.
      reason = 'setup time was not resolved, and this system will not persist a substituted one';
    }

    if (reason !== null) {
      gaps.push({
        process: line.process,
        machineClass: line.machineClass ?? '',
        reason,
        ...(nearestRows && nearestRows.length > 0 ? { nearestRows } : {}),
      });
    }
  }
  return gaps;
}

/** True when every operation on the route has the real data it needs to be costed. */
export function isRouteDataComplete(lines: readonly RouteDataGapLine[]): boolean {
  return findRouteDataGaps(lines).length === 0;
}

// ── Route recommendation ──────────────────────────────────────────────────────
//
// The one place the platform states which candidate route it would choose.
//
// This is not a new ranking policy. It is the existing one — the "Lowest cost"
// badge, awarded to the cheapest route among those that are both physically
// capable and fully costed — made addressable, so automatic selection and the
// badge shown next to it can never disagree. Before this, the comparison ranked
// 15 routes and nothing consumed the result: automatic routing re-applied
// whatever route was already persisted, or fell back to a fixed default line
// set, so a cheaper applicable route could never win no matter what the real
// data said.
//
// Deliberately NOT here: any per-process preference, volume threshold, or
// weighting. Annual volume, batch size and production life reach this decision
// the only legitimate way — through the resolved costing inputs the routes were
// priced with, so a volume that genuinely changes the economics changes the
// winner, and one that does not, does not.

export interface RankableRoute {
  routeId: string;
  totalCost: number | null;
  cycleTimes: { totalMin: number };
  capability: { overallCapable: boolean };
  dataComplete: boolean;
  /**
   * The route-level feasibility verdict, distinct from
   * `capability.overallCapable` (which is only the selected MACHINE's
   * capability). A route can hold a perfectly capable machine and still be
   * infeasible for reasons the machine record cannot express — see
   * rollBendingGeometryCapability, whose verdict lands here and nowhere else.
   *
   * Ranking read only `capability.overallCapable` until 2026-09-09, so that
   * gate was inert: "3 Roll Bending" stayed the recommended route for a part
   * with four discrete bends despite already being marked infeasible.
   */
  isFeasible: boolean;
  /**
   * False when this route's process has no blank-generation operation of its
   * own — see routeProducesBlank(). Optional because only the sheet-metal
   * comparison resolves it; CNC and injection-molding routes have no blanking
   * concept, and undefined means "no evidence against this route".
   */
  producesBlank?: boolean;
}

/**
 * The route this comparison recommends, or `null` when no candidate is both
 * capable and fully costed — in which case the caller must not fabricate a
 * choice.
 *
 * Ties break on cycle time, then on route id, so the same inputs always yield
 * the same answer rather than depending on registry iteration order.
 */
export function selectRecommendedRoute<T extends RankableRoute>(routes: readonly T[]): T | null {
  const eligible = routes.filter(
    (r) =>
      r.capability.overallCapable &&
      r.isFeasible &&
      r.producesBlank !== false &&
      r.dataComplete &&
      typeof r.totalCost === 'number',
  );
  if (eligible.length === 0) return null;

  return eligible.reduce((best, r) => {
    const a = r.totalCost as number;
    const b = best.totalCost as number;
    if (a !== b) return a < b ? r : best;
    if (r.cycleTimes.totalMin !== best.cycleTimes.totalMin) {
      return r.cycleTimes.totalMin < best.cycleTimes.totalMin ? r : best;
    }
    return r.routeId < best.routeId ? r : best;
  });
}

/**
 * Machine classes that form by ROLLING the sheet between rolls.
 * Derived from the registered engine classes, not maintained as prose.
 */
const ROLL_BENDING_CLASSES = new Set(['roll_bending_2', 'roll_bending_3', 'roll_bending_4']);

/**
 * Can a roll bender produce this part's formed geometry?
 *
 * A roll bender feeds the blank between rolls to impose ONE continuous
 * curvature — a cylinder or cone. Its whole parameter set is about a rolled
 * diameter: sm_reference_data's `min2RollBendingDiameterRatio` is documented as
 * "Ratio which determines smallest achievable roll diameter as a function of
 * the top roll diameter of machine", and the roll engine's own cycle time is
 * feed length / rolling speed. None of that describes a crease.
 *
 * It therefore cannot produce a discrete air bend at a specified radius and
 * angle. A part whose formed geometry is N discrete bend features needs N
 * creases, which is a press brake operation.
 *
 * WHY THIS GATE EXISTS
 *
 * Roll bending had no capability check at all — the engine took
 * `flatPatternLengthMm` as its roll feed length, and every sheet part has a
 * flat-pattern length, so a roll bender always produced a plausible cycle time
 * and always appeared as a candidate route. On a bracket with 4 discrete R0.8
 * bends it could therefore be ranked and applied, which is how "3 Roll Bending"
 * became the persisted route for a part that needs a press brake.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not try to positively RECOGNISE a rolled cylinder. No curvature or
 * CURVED_BEND signal reaches the backend today: the CAD extractor knows about
 * curved bend faces internally but exports only a bend count, so there is no
 * real input that says "this is a rolled form". Inventing a threshold to guess
 * one would be fabrication. Instead this states only what is certain from the
 * data that does exist — discrete bends are not rollable — and stays silent
 * (capable) when a part has no discrete bends, where a rolled form is genuinely
 * possible and the engineer can select it.
 *
 * @param machineClass the route's machine class
 * @param bendCount real discrete bend features extracted from CAD
 */
export function rollBendingGeometryCapability(
  machineClass: string,
  bendCount: number,
  rolledFormCount = 0,
): { capable: true } | { capable: false; reason: string } {
  if (!ROLL_BENDING_CLASSES.has(machineClass)) return { capable: true };

  // Positive evidence now exists (2026-09-09): rolled_form_count counts CONFIDENT
  // continuous-curvature detections from real B-Rep — a single cylindrical face
  // sweeping past the 180 degrees a press brake can form in one hit. A part that
  // has one genuinely needs rolling, so a discrete bend elsewhere on the same
  // part (a rolled shell with a flanged edge is an ordinary combination) no
  // longer disqualifies the roll bender.
  if (rolledFormCount > 0) return { capable: true };

  if (bendCount <= 0) return { capable: true };
  return {
    capable: false,
    reason:
      `Roll bending imposes one continuous curvature by feeding the blank between rolls, so it cannot `
      + `produce the ${bendCount} discrete bend${bendCount === 1 ? '' : 's'} extracted from this part, `
      + `and no rolled form was detected in its geometry. `
      + `Discrete bends at a specified radius and angle are press-brake work.`,
  };
}

/**
 * Should a press brake be flagged for a part whose geometry is actually rolled?
 *
 * The mirror of the gate above, and the second half of what the CAD signal
 * bought. A cutting route appends a Press Brake line whenever the part has
 * bends; if the same part also carries a confidently-detected rolled form, the
 * press brake cannot produce that curvature and the route is incomplete as
 * priced. Disclosed as a warning rather than made infeasible: the part may
 * genuinely need both operations, and this states the half the route is missing
 * instead of guessing which one the engineer wants.
 */
export function rolledFormNeedsRollBender(
  processFamily: 'cutting' | 'forming',
  machineClass: string,
  rolledFormCount: number,
): string | null {
  if (rolledFormCount <= 0) return null;
  if (ROLL_BENDING_CLASSES.has(machineClass)) return null;
  if (processFamily !== 'cutting') return null;
  return (
    `${rolledFormCount} continuous rolled form${rolledFormCount === 1 ? '' : 's'} detected in this part's `
    + `geometry (a cylindrical face sweeping past the 180 degrees a press brake can form in one hit). `
    + `A press brake cannot produce that curvature — this route does not include or price a roll-bending operation.`
  );
}

/**
 * Does this route's own process generate the blank, or must one be produced
 * upstream first?
 *
 * Sourced entirely from the real catalog taxonomy — `blankCapableClasses` is
 * resolved from process_taxonomy_operations rows whose `feature_type` is
 * 'Blank' (migration 609, seeded verbatim from the real
 * process_operations.json strings), joined to the machine class through
 * process_calculator_mappings.canonical_process_id (migration 610, NOT NULL).
 * Nothing here is a hand-kept list of "cutting-ish" processes.
 *
 * What the real data says: every cutting process has a `//Blank` operation
 * ("Fiber Laser Cut", "Laser Cut", "Laser Punch", "Plasma Cut", "Plasma Punch",
 * "OxyFuel Cut", "Waterjet Cut", "Turret Press", "Shear", "2 Axis Router"), and
 * so does the whole press family, which blanks in-die ("Std Press:Std
 * Press//Blank", "Tandem Press:Blanking//Blank", "Progressive Die:Die
 * Station:Blanking//Blank"). 2/3/4 Roll Bending have none — their operations
 * are StraightBend, Form, As Formed//CurvedSurface, As Formed//CurvedWall and
 * Coil Uncoil. A roll bender feeds an already-cut blank between rolls.
 *
 * WHY THIS MATTERS FOR RANKING
 *
 * A forming route is assembled as a complete, standalone alternative: its own
 * process line goes into the same coreCutting slot a laser's would, so a route
 * that does not blank simply has no blanking cost at all. It then competes in
 * the same global cost minimum at a structurally smaller scope of work and wins
 * on price for a reason that is not economic. Barring such a route from the
 * recommendation is what keeps "the cheapest route" comparable.
 *
 * It stays visible, costed and manually selectable — an engineer whose blank
 * comes from stock or from a separate operation can still choose it. This only
 * governs what may be chosen automatically.
 *
 * @param machineClass the route's machine class
 * @param blankCapableClasses classes with a real `//Blank` operation on file,
 *   or null when the taxonomy could not be read — in which case there is no
 *   evidence against any route and every one is treated as blank-producing
 *   (the caller discloses the lookup failure).
 */
export function routeProducesBlank(
  machineClass: string,
  blankCapableClasses: ReadonlySet<string> | null,
): boolean {
  if (blankCapableClasses === null) return true;
  return blankCapableClasses.has(machineClass);
}
