// Progressive Die / Tandem Press hard-tooling cost — the real replacement for
// the $0 every route in these two classes charged before this file existed.
//
// ROOT CAUSE THIS FIXES
//
// No engine anywhere in this codebase computed a die/tooling cost for
// Progressive Die or Tandem Press (computePressStrokeCost prices machine +
// labor + setup only). A route whose real economics require a hard-tooling
// investment therefore looked artificially cheap purely because that
// investment was never charged — not because it doesn't exist.
// getToolingAnnualVolumeThresholds' own `toolingVolumeNote` already computed
// the real verdict ("this part's volume is below the threshold for the
// tooling to pay off") but only ever surfaced it as a decorative string,
// never as a cost or a gate.
//
// WHAT THIS PRICES, AND WHY IT STOPS WHERE IT DOES
//
// A real progressive die's cost has two real components: (1) purchased
// standard tooling components (punches, retainers, die buttons, guide pins,
// tapping units — real, catalogued, per-unit $), and (2) custom-machined
// die-block/shoe steel (raw material + CNC/grinding/wire-EDM machining +
// heat-treat + coating + design/assembly/debug/rework labor).
//
// This engine prices (1) only. Component #2 genuinely cannot be priced
// honestly with what is on file:
//   - die-block/shoe sizing needs a real strip layout (how many stations
//     share one shoe, how large each per-station insert is) — no CAD or
//     reference data in this system models that; inventing a footprint-times-
//     thickness estimate would be exactly the kind of fabricated geometry
//     this platform's architecture rules forbid.
//   - the labor-hour majority of a real die build (CNC/grinding/wire-EDM/
//     design/assembly/debug/rework) has real HOUR figures on file
//     (sm_reference_data's dbGrindingHrsPerDieBlock, bpMillingHrsPerBpProgDie,
//     etc.) but NO toolroom/die-shop labor rate exists anywhere in this
//     platform (verified: not in mhr_records, lhr_records,
//     lhr_benchmark_rates, or wage_grade — "Progressive Die"'s only wage
//     grade prices the press OPERATOR, not the person who builds the die).
//     Converting real hours into a fabricated $/hr would be inventing the
//     one number the licensed dataset does not supply.
//
// This is therefore a real, itemized, PARTIAL tooling cost — a large,
// honest improvement over $0, disclosed as partial via
// `ProgressiveDieToolingResult.warning`, never presented as the complete
// tooling investment.
//
// Heat-treat and coating cost (also real, sourced: stdHeatTreatCostPerKgProgDie,
// sm_lookup_tooling_coating_cost) are deliberately NOT applied to the
// purchased components priced below — a catalogued standard punch/retainer/
// die button/tap is sold already hardened and ground; its `costUsd` already
// reflects that. Applying heat-treat/coating again on top would double-charge
// a cost the purchased price already includes. Those real rates remain
// unconsumed pending a future die-block-steel costing phase (see
// SheetMetalLookupService.getProgressiveDieToolingVariables /
// getToolingCoatingCostPerKg, kept in place for it) — that phase also has a
// real, unresolved conflict to settle first: a SECOND, independently-sourced
// heat-treat cost table exists (migration 514's `toolingHeatTreatCostMaterial:
// D2` = $2.27/kg) that disagrees with `stdHeatTreatCostPerKgProgDie` ($0.23/kg)
// by roughly 10x. Both are real; nothing in either source states which one the
// original reference tool actually charges for progressive-die tooling
// specifically. Picking either one to stack on top of an already-assumed
// die-block footprint/plate-count model would compound one unverified
// assumption on another — staying out of that scope entirely, rather than
// guessing, is the more honest choice for this pass.
//
// TOOLMAKER LABOR — HOURS ARE REAL AND COMPUTED, DOLLARS ARE NOT
//
// The design/CNC/grinding/wire-EDM/assembly/debug/rework hours a real die
// build needs DO have real, sourced per-die-block figures on file
// (sm_reference_data's dbCncSetupHrs/dbMillingHrs/dbCncHrsPerPocket/
// dbGrindingHrsPerDieBlock/dbWireEdmSetupHrs, and orDesignPercent/
// orAssemblyPercent/orDebugPercent/orReworkPercent as percentages of that
// fabrication-hours base). This file computes that real hours figure — see
// `estimateToolBuildHours` — but never converts it to a dollar figure. The
// only $/hr labor rates resolvable anywhere in this platform for a USA
// location are `lhr_benchmark_rates`' generic occupation benchmarks
// (migration 361), and every one of them — Sheet Metal Fabricator, CNC
// Machinist, Quality Inspector, all of it — is the SAME flat $46.67/hr
// placeholder value. That is not a differentiated "CNC machinist rate"
// available for honest reuse; it is one uniform number wearing several
// occupation labels, and multiplying real hours by it would produce a
// dollar figure with no more real backing than a straight invented one.
// The hours therefore stay hours: real, disclosed, and used only to decide
// whether this route's total is provably incomplete (see
// `progressiveDieToolingDataGap`) — never priced into a number that would
// misrepresent itself as sourced.
//
// COMPONENT MAPPING — what maps to what, and why
//
// Every progressive die needs SOME guide/strip hardware regardless of feature
// count — this is fixed, not feature-scaled: one guidePinAssy ('small', the
// smallest real catalogued size — a disclosed simplification; sizing by real
// part envelope is a follow-up), one stripperGuidePinAssy, one stripperPinAssy.
//
// Each DISTINCT hole diameter group needs its own punch (a punch's diameter
// must match the hole it pierces): piercePunchStandard + its retainer +
// a dieButton per real hole group (not per physical hole — a group of
// identical holes shares one punch/button pair, matching how this codebase's
// other secondary-op engines already gate on distinct groups, not raw counts).
//
// Each DISTINCT thread size needs a replacement tapStandard; ANY in-die
// tapping needs the one capital tappingUnit regardless of how many sizes
// (it is the die-mounted rotary tap station itself, not a per-size part).
//
// bendCount and extrudedFlangeCount are deliberately NOT mapped to any BOM
// line: no component in the real catalog represents a wipe-bend punch or a
// burring/coining punch distinctly from the die-block steel that forms them
// (that's component #2, out of scope above) — and the catalog's cam-unit /
// gas-spring rows are for heavy stamping side-action forming (weights
// 89-733kg), not the ordinary vertical wipe-bends most sheet-metal brackets
// need; mapping bendCount to those would fabricate an inapplicable charge, not
// price a real one.

import type { RouteDataGap } from '../../shared/core/engine-kernel';
import type { ProcessLineCost } from '../../../dto/cost-breakdown.dto';

export interface ToolingComponentCost {
  componentName: string;
  model: string | null;
  costUsd: number;
}

export interface ProgressiveDieToolingInput {
  machineClass: 'progressive_die_press' | 'tandem_press';
  /** Distinct hole-diameter groups (each needs its own punch/retainer/button). */
  holeGroupCount: number;
  /** Distinct thread-size groups (each needs its own replacement tap). */
  threadGroupCount: number;
  /**
   * Real, already-extracted bend count and extruded-flange (burr/coin)
   * feature count — used only to estimate real toolmaker BUILD HOURS (see
   * module doc comment), never to price a BOM component: no catalogued
   * component represents an ordinary wipe-bend or burring punch distinctly
   * from the die-block steel that forms them.
   */
  bendCount: number;
  extrudedFlangeCount: number;
  batchSize: number;
  /** This part's real, already-resolved annual volume. Null = unresolved, price omitted. */
  annualVolume: number | null;
  /** This part's real, already-resolved production life. Null = unresolved, price omitted. */
  productionLifeYears: number | null;
  /** sm_lookup_tooling_component_costs, verbatim from SheetMetalLookupService. */
  componentCosts: readonly ToolingComponentCost[];
  /** Real percentages from getProgressiveDieToolingVariables — null when unresolved. */
  markupPct: number | null;
  sgAndAPct: number | null;
  profitPct: number | null;
  /**
   * Real per-die-block build-hour figures from getProgressiveDieToolingVariables
   * (sm_reference_data). Null fields simply drop out of the hours estimate
   * (never substituted) — see estimateToolBuildHours.
   */
  buildHourVariables: {
    dbCncSetupHrs: number | null;
    dbMillingHrs: number | null;
    dbCncHrsPerPocket: number | null;
    dbMilledPocketsPerDieBlock: number | null;
    dbGrindingHrsPerDieBlock: number | null;
    dbDrillingHrsPerDieBlock: number | null;
    dbWireEdmSetupHrs: number | null;
    designHoursPct: number | null;
    assemblyHoursPct: number | null;
    debugHoursPct: number | null;
    reworkHoursPct: number | null;
    /** assyHrsCompProgDie — Progressive-Die-only dial; no equivalent exists for Tandem Press. */
    progDieAssemblyDial: number | null;
  };
}

export interface ProgressiveDieToolingResult {
  /** One line per real BOM component actually needed for this part. */
  items: Array<{ componentName: string; model: string | null; qty: number; unitCostUsd: number; totalCostUsd: number }>;
  /** Σ items — before markup/SG&A/profit. */
  bomSubtotalUsd: number;
  /** bomSubtotalUsd × (1 + markupPct + sgAndAPct + profitPct). */
  toolingCostUsd: number;
  /** toolingCostUsd amortised over annualVolume × productionLifeYears — null when either is unresolved. */
  toolingCostPerPartUsd: number | null;
  /** Real component rows this part needed but which have no cost on file (never fabricated). */
  missingComponents: string[];
  /**
   * Real, computed toolmaker build hours (design/CNC/grinding/wire-EDM/
   * assembly/debug/rework) this die genuinely needs — never priced (see
   * module doc comment). Used only to decide progressiveDieToolingDataGap.
   */
  estimatedToolBuildHours: number;
  warnings: string[];
}

/**
 * One die-block-equivalent station per real, already-extracted feature that
 * needs its own operation in the die: the base blank+pierce station, one per
 * bend (ordinary wipe-bend — see module doc comment on why bends get no BOM
 * line but do add real machining hours), one per distinct thread group
 * (tapping), and one if a real extruded-flange (burr/coin) feature exists.
 */
function estimateStationCount(input: Pick<ProgressiveDieToolingInput, 'bendCount' | 'threadGroupCount' | 'extrudedFlangeCount'>): number {
  return 1 + Math.max(0, input.bendCount) + Math.max(0, input.threadGroupCount) + (input.extrudedFlangeCount > 0 ? 1 : 0);
}

/**
 * Real toolmaker build hours for this die, from real per-die-block hour
 * variables × a real, feature-derived station count. Never converted to a
 * dollar figure — see the module's own "TOOLMAKER LABOR" section for why.
 */
export function estimateToolBuildHours(input: ProgressiveDieToolingInput): number {
  const v = input.buildHourVariables;
  const perDieBlockHrs =
    (v.dbCncSetupHrs ?? 0) +
    (v.dbMillingHrs ?? 0) +
    (v.dbCncHrsPerPocket ?? 0) * (v.dbMilledPocketsPerDieBlock ?? 0) +
    (v.dbGrindingHrsPerDieBlock ?? 0) +
    (v.dbDrillingHrsPerDieBlock ?? 0) +
    (v.dbWireEdmSetupHrs ?? 0);
  const stationCount = estimateStationCount(input);
  const fabHrs = perDieBlockHrs * stationCount;

  // assyHrsCompProgDie is explicitly a Progressive-Die-only dial (its source
  // notes say so) — no equivalent exists for Tandem Press, so it is applied
  // only there; Tandem Press's assembly hours use the raw percentage unscaled.
  const assemblyDial = input.machineClass === 'progressive_die_press' ? (v.progDieAssemblyDial ?? 1) : 1;

  const designHrs = fabHrs * (v.designHoursPct ?? 0);
  const assemblyHrs = fabHrs * (v.assemblyHoursPct ?? 0) * assemblyDial;
  const debugHrs = fabHrs * (v.debugHoursPct ?? 0);
  const reworkHrs = fabHrs * (v.reworkHoursPct ?? 0);

  return fabHrs + designHrs + assemblyHrs + debugHrs + reworkHrs;
}

function findCost(catalog: readonly ToolingComponentCost[], componentName: string, model: string | null = null): number | null {
  const row = catalog.find((c) => c.componentName === componentName && c.model === model);
  return row ? row.costUsd : null;
}

const SCOPE_WARNING =
  'Progressive Die / Tandem Press tooling cost covers only the purchased-component BOM (punches, dies, ' +
  'guide pins, tapping units) plus markup/SG&A/profit — it does NOT include die-block/shoe raw material, ' +
  'machining, heat-treat, coating, or toolmaker design/build labor. No real die strip-layout data or toolroom ' +
  'labor rate exists on file to price those honestly; the true tooling investment is very likely higher than ' +
  'this figure.';

/**
 * Computes the real, itemized, partial hard-tooling BOM cost for a Progressive
 * Die or Tandem Press route. Pure function — every input is already resolved
 * by the caller (real feature counts, real looked-up reference data).
 */
export function computeProgressiveDieToolingCost(input: ProgressiveDieToolingInput): ProgressiveDieToolingResult {
  const items: ProgressiveDieToolingResult['items'] = [];
  const missingComponents: string[] = [];

  const add = (componentName: string, model: string | null, qty: number) => {
    if (qty <= 0) return;
    const unitCostUsd = findCost(input.componentCosts, componentName, model);
    if (unitCostUsd === null) {
      missingComponents.push(model ? `${componentName} (${model})` : componentName);
      return;
    }
    items.push({ componentName, model, qty, unitCostUsd, totalCostUsd: unitCostUsd * qty });
  };

  // Fixed baseline hardware — present on every die regardless of feature count.
  add('guidePinAssy', 'small', 1);
  add('stripperGuidePinAssy', null, 1);
  add('stripperPinAssy', null, 1);

  // One punch + retainer + die button per distinct hole diameter group.
  add('piercePunchStandard', null, input.holeGroupCount);
  add('piercePunchRetainerStandard', null, input.holeGroupCount);
  add('dieButton', null, input.holeGroupCount);

  // In-die tapping: one capital rotary tap unit if any thread is tapped in the
  // die at all, plus one replaceable tap per distinct thread size.
  if (input.threadGroupCount > 0) {
    add('tappingUnit', null, 1);
    add('tapStandard', null, input.threadGroupCount);
  }

  const bomSubtotalUsd = items.reduce((s, i) => s + i.totalCostUsd, 0);

  const pctSum = (input.markupPct ?? 0) + (input.sgAndAPct ?? 0) + (input.profitPct ?? 0);
  const toolingCostUsd = bomSubtotalUsd * (1 + pctSum);

  const toolingCostPerPartUsd =
    input.annualVolume !== null && input.annualVolume > 0 &&
    input.productionLifeYears !== null && input.productionLifeYears > 0
      ? toolingCostUsd / (input.annualVolume * input.productionLifeYears)
      : null;

  const estimatedToolBuildHours = estimateToolBuildHours(input);

  const warnings = [SCOPE_WARNING];
  if (missingComponents.length > 0) {
    warnings.push(
      `Real tooling components with no cost on file (sm_lookup_tooling_component_costs), so not included: ${missingComponents.join(', ')}.`,
    );
  }
  if (estimatedToolBuildHours > 0) {
    warnings.push(
      `An estimated ${estimatedToolBuildHours.toFixed(1)} real toolmaker hours (design/CNC/grinding/wire-EDM/` +
      `assembly/debug/rework, from sm_reference_data's real per-die-block figures) are needed to build this die. ` +
      `No toolroom labor rate exists on file for any location, so this hours estimate is NOT priced into the ` +
      `figure above — the true tooling cost is materially higher.`,
    );
  }

  return { items, bomSubtotalUsd, toolingCostUsd, toolingCostPerPartUsd, missingComponents, estimatedToolBuildHours, warnings };
}

/**
 * A data gap for a route whose real, itemized tooling cost is nonetheless
 * genuinely incomplete — either because it could not be amortised into a
 * per-part cost at all (annual volume / production life unresolved), or
 * because a real, non-trivial amount of toolmaker build labor is required
 * and has no priced $ figure on file (see estimateToolBuildHours). Both are
 * real, disclosed reasons this route's total is a lower bound, not a
 * complete tooling cost — the same "artefact of absent data" semantics
 * findRouteDataGaps already uses for a missing cycle time, applied to a
 * missing labor-hours PRICE rather than a missing operation entirely.
 *
 * Deliberately NOT raised just because bomSubtotalUsd is nonzero — a route
 * with no real gap (fully amortised, and station complexity low enough that
 * estimateToolBuildHours rounds to ~0) must stay eligible for the
 * recommendation and the "Lowest cost" badge.
 */
export function progressiveDieToolingDataGap(
  machineClass: string,
  result: Pick<ProgressiveDieToolingResult, 'toolingCostPerPartUsd' | 'bomSubtotalUsd' | 'estimatedToolBuildHours'>,
): RouteDataGap | null {
  if (result.bomSubtotalUsd <= 0) return null;
  const process = machineClass === 'progressive_die_press' ? 'Progressive Die' : 'Tandem Press';

  if (result.toolingCostPerPartUsd === null) {
    return {
      process, machineClass,
      reason:
        'Real tooling cost was computed but could not be amortised into a per-part cost — this part\'s ' +
        'annual volume or production life is unresolved.',
    };
  }
  if (result.estimatedToolBuildHours > 0) {
    return {
      process, machineClass,
      reason:
        `${result.estimatedToolBuildHours.toFixed(1)} real toolmaker build hours are required for this die and ` +
        `have no priced toolroom labor rate on file (see progressive-die-tooling-engine.ts) — this route's ` +
        `total cost is a real, itemized lower bound, not the complete tooling investment.`,
    };
  }
  return null;
}

/**
 * Assembles this result into a real ProcessLineCost line, or none when there
 * is nothing to charge (bomSubtotalUsd <= 0 — an empty/unresolved catalog).
 *
 * `cycleTimeMin`/`setupTimeMin` are schema-compatibility values, not claims
 * about a real machine cycle — this line is a one-time investment amortised
 * per part, not a per-cycle operation. cycleTimeMin is set to the smallest
 * value findRouteDataGaps' MIN_PERSISTABLE_CYCLE_SEC floor (0.01s) accepts, so
 * a real, priced tooling line is never misreported as "no cycle time
 * resolved" the way an actually-unresolved operation would be.
 */
export function buildProgressiveDieToolingLine(
  machineClass: 'progressive_die_press' | 'tandem_press',
  result: ProgressiveDieToolingResult,
): ProcessLineCost[] {
  if (result.bomSubtotalUsd <= 0 || result.toolingCostPerPartUsd === null) return [];
  const process = machineClass === 'progressive_die_press' ? 'Progressive Die Tooling (amortized)' : 'Tandem Press Stage Tooling (amortized)';
  return [{
    process,
    setupCost: 0,
    runCost: result.toolingCostPerPartUsd,
    totalCost: result.toolingCostPerPartUsd,
    cycleTimeMin: 0.01 / 60,
    setupTimeMin: 0,
    hourlyRate: 0,
    rateSource: 'tooling_amortization',
    machineClass,
    machineName: null,
    commodityCode: null,
  } as ProcessLineCost];
}
