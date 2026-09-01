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

export function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function noRateFallback(machineClass: string): MHRRateInput {
  return { rate: 0, source: 'no_db_rate', machineClass, machineName: null, commodityCode: null };
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

