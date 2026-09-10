// The Workflow Builder's editable step model, and the honest arithmetic that
// turns an edited step chain back into a total.
//
// Moved out of page.tsx so the totals math is a pure, directly-testable
// function rather than JSX-embedded arithmetic. Nothing here fetches, and
// nothing here derives a number the engine did not already compute.

/**
 * One editable operation in the selected route's chain.
 *
 * Every numeric field is a real, engine-computed value carried through from
 * ProcessLineCost — not re-derived client-side. When a field genuinely has no
 * real value (a catalog operation this part's geometry does not trigger yet),
 * it is `null`/`0` with `isReal: false`, and the UI must say so rather than
 * render a confident-looking zero.
 */
export interface WorkflowRouteStep {
  key: string;
  process: string;
  machineClass: string;
  /**
   * The REAL machine this step's hourlyRate/cycleTimeMin came from — the exact
   * machine the backend's capability-based selectMachine() already picked for
   * this line (ProcessLineCost.machineName), never re-derived from a
   * client-side "cheapest machine of this class" shortcut. Root-caused
   * 2026-09-04: displaying the client-side pick beside the engine's numbers
   * showed two different machines as one row whenever they diverged.
   * `null` only when no real machine was resolved anywhere.
   */
  machineName: string | null;
  /** Real, local-currency (RouteComparisonDto.currency) — from the engine-computed line. */
  hourlyRate: number;
  /** Real when `isReal`; 0 when this is a catalog operation with no geometric trigger here. */
  cycleTimeMin: number;
  /**
   * The line's real total cost (setup + run) as the engine computed it.
   * `null` — never 0 — for a catalog operation the engine never priced for
   * this part, so `computeChainTotals` can report it as unpriced instead of
   * silently adding nothing and calling the sum complete.
   */
  totalCost: number | null;
  /** True when `process` matches a line the engine actually computed from this part's real geometry. */
  isReal: boolean;
  processGroup?: string;
  processRoute?: string;
}

export interface RouteChainTotals {
  /** Sum of every step that has a real engine-computed cost. */
  processCost: number;
  /** Sum of every step's real cycle time. */
  cycleTimeMin: number;
  /** How many steps contributed no cost because the engine never priced them here. */
  unpricedStepCount: number;
  /** Route-level material cost — unaffected by step edits, `null` when unknown. */
  materialCost: number | null;
  /** materialCost + processCost, or `null` when material cost is unknown. */
  total: number | null;
  /** True while any step is unpriced, so callers can mark the total as a floor, not a final number. */
  isPartial: boolean;
}

/**
 * Recomputes the chain total from the steps currently in the editor.
 *
 * This exists because the route row's own headline cost is the BACKEND's
 * total for the backend's own line-up. The moment a user removes, adds, or
 * substitutes a step, that headline stops describing what is on screen —
 * previously you could delete a real, priced operation and watch the total
 * sit unchanged. Summing the same real per-line costs the engine returned is
 * not a second costing model; it is reporting the subset actually selected.
 */
export function computeChainTotals(
  steps: readonly WorkflowRouteStep[],
  materialCost: number | null,
): RouteChainTotals {
  let processCost = 0;
  let cycleTimeMin = 0;
  let unpricedStepCount = 0;

  for (const step of steps) {
    if (step.totalCost === null || !Number.isFinite(step.totalCost)) unpricedStepCount += 1;
    else processCost += step.totalCost;
    if (Number.isFinite(step.cycleTimeMin)) cycleTimeMin += step.cycleTimeMin;
  }

  const hasMaterial = materialCost !== null && Number.isFinite(materialCost);
  return {
    processCost,
    cycleTimeMin,
    unpricedStepCount,
    materialCost: hasMaterial ? materialCost : null,
    total: hasMaterial ? materialCost + processCost : null,
    isPartial: unpricedStepCount > 0,
  };
}

/**
 * Difference between the edited chain and the route's own backend total.
 * `null` when either side is unknown, or when the chain is partial (a delta
 * against a total that is itself missing priced steps would be misleading).
 */
export function chainCostDelta(totals: RouteChainTotals, baselineTotal: number | null): number | null {
  if (totals.total === null || baselineTotal === null || !Number.isFinite(baselineTotal)) return null;
  if (totals.isPartial) return null;
  const delta = totals.total - baselineTotal;
  // Sub-cent noise from float summation is not a real edit.
  return Math.abs(delta) < 0.005 ? 0 : delta;
}
