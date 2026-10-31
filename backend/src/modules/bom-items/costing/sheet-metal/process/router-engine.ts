import { resolveYieldPct } from '../../shared/core/default-rates.constants';
import type { MHRRateInput } from '../../shared/core/cost-engine';
import type { PhysicsGap, ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { CuttingProcessContext, CuttingProcessResult } from '../../shared/core/manufacturing-process.types';
import { noRateFallback, eMithranTerms, resolveSetupMinutes } from '../../shared/core/engine-kernel';
import { BaseCuttingEngine, buildCuttingProcessLine } from '../../shared/core/engine-orchestrator';

export interface RouterInput {
  cutLengthMm: number;
  pierceCount: number;
  batchSize: number;
  routerRate?: MHRRateInput;
  // Real process_calculator_mappings identity for the resolved machine class,
  // resolved by the caller (BomItemsService.resolveProcessIdentities()) —
  // never hardcoded here.
  processIdentity?: { processGroup: string; processRoute: string; operation: string };
  // Linear feed rate along the cut (mm/min), resolved by the caller via
  // SheetMetalLookupService.getRouterMachineParams() from the selected machine.
  // Absent means no feed rate is on file for it, which is reported as a data gap
  // on the line, never a guess. The source also has no plunge/pierce-time data at
  // all — pierceCount is disclosed via a warning, never given a fabricated
  // per-plunge time.
  cuttingSpeedMmPerMin?: number;
  setupMin?: number;
  // eMithranTerms() inputs — see CuttingProcessContext's own doc comment for
  // sourcing.
  dlrPerHr?: number;
  qairPerHr?: number;
  inspTimeMin?: number;
  samplingRate?: number;
  yieldPct?: number;
  netMatCost?: number;
  netWeightKg?: number;
  scrapPricePerKg?: number;
}

interface RouterResult {
  processLines: ProcessLineCost[];
  cuttingMin: number;
  // Always 0 — routing has no abrasive consumable. Kept only so this result
  // shape satisfies the shared CuttingProcessResult contract.
  abrasiveCost: number;
  warnings: string[];
}

export function computeRouterCost(input: RouterInput): RouterResult {
  const warnings: string[] = [];
  const rate = input.routerRate ?? noRateFallback("router_2axis");

  let cuttingMin = 0;
  if (input.cuttingSpeedMmPerMin != null && input.cutLengthMm > 0) {
    cuttingMin = input.cutLengthMm / input.cuttingSpeedMmPerMin;
  } else if (input.cutLengthMm > 0) {
    warnings.push("2-Axis Router: no linear feed rate on file (the selected machine has no feedRate staged in sm_reference_data routerMachine:*) — cutting time is not priced");
  }
  // Unpriced cutting is missing data, not a $0 operation: it would make the route
  // look cheapest for work it leaves unpriced. See the same rule in the turret engine.
  // A plunge is work the source does not price (no plunge time in any file), so a part with
  // pierces is not fully costed: the route is a gap, never the cheapest by leaving plunging out.
  const cutGap = input.cutLengthMm > 0 && input.cuttingSpeedMmPerMin == null;
  const plungeGap = input.pierceCount > 0;
  const physicsGap: PhysicsGap | undefined = cutGap || plungeGap
    ? {
        gapType: 'unsupported_operation',
        process: 'Router Cutting',
        machineClass: 'router_2axis',
        reason: cutGap
          ? `Not priced: cutting ${Math.round(input.cutLengthMm)} mm (no feed rate on file for this router machine).`
          : `Not priced: ${input.pierceCount} plunges (no plunge time on file in any source, so the route would leave them out).`,
      }
    : undefined;
  if (input.pierceCount > 0) {
    warnings.push("2-Axis Router: plunge/pierce time is not modeled — no real plunge-time data on file, so only linear cutting time is charged");
  }

  // Real setup time, most-specific real source first: this machine's own
  // mhr_records.setup_time_hr, then the per-operation sm_lookup_op_setup_time
  // row, then the cited class constant. See resolveSetupMinutes().
  const setup = resolveSetupMinutes({
    process: "Router Cutting",
    machineSetupTimeHr: rate.setupTimeHr,
    operationSetupMin: input.setupMin,
    machineName: rate.machineName,
  });
  const setupMin = setup.setupMin;
  if (setup.warning) warnings.push(setup.warning);

  const t = eMithranTerms({
    mhrPerHr: rate.rate,
    dlrPerHr: rate.labourRate ?? input.dlrPerHr ?? 0,
    qairPerHr: input.qairPerHr ?? 0,
    setupNDL: rate.operators ?? 1,
    cycleNDL: rate.operators ?? 1,
    cycleTimeMin: cuttingMin,
    setupTimeMin: setupMin / Math.max(input.batchSize, 1),
    inspTimeMin: input.inspTimeMin ?? 0,
    samplingRate: input.samplingRate ?? 0,
    yieldPct: resolveYieldPct(input.yieldPct, 'Router', warnings),
    netMatCost: input.netMatCost ?? 0,
    netWeightKg: input.netWeightKg ?? 0,
    scrapPricePerKg: input.scrapPricePerKg ?? 0,
  });

  const processLines: ProcessLineCost[] = [
    buildCuttingProcessLine({
      process: "Router Cutting",
      processIdentity: input.processIdentity,
      setupTimeMin: setup.setupMin,
      setupTimeSource: setup.source,
      setupCost: t.setupCost,
      runCost: t.machineCost + t.laborCost,
      totalCost: t.total,
      cycleTimeMin: cuttingMin,
      rate,
      extra: { labourRate: rate.labourRate ?? null, ...(physicsGap ? { physicsGap } : {}) },
    }),
  ];

  return { processLines, cuttingMin, abrasiveCost: 0, warnings };
}

// Thin ManufacturingProcessEngine wrapper around the real formula above —
// registered in manufacturing-process-registry.ts.
export class RouterEngine extends BaseCuttingEngine {
  readonly machineClass = 'router_2axis';
  readonly processFamily = 'sheet_metal_cutting';
  readonly processLabel = 'Router Cutting';

  computeCost(context: CuttingProcessContext): CuttingProcessResult {
    return computeRouterCost({
      cutLengthMm: context.cutLengthMm,
      pierceCount: context.pierceCount,
      batchSize: context.batchSize,
      routerRate: context.rate,
      processIdentity: context.processIdentity,
      setupMin: context.opSetupMin,
      dlrPerHr: context.dlrPerHr,
      qairPerHr: context.qairPerHr,
      inspTimeMin: context.inspTimeMin,
      samplingRate: context.samplingRate,
      yieldPct: context.yieldPct,
      netMatCost: context.netMatCost,
      netWeightKg: context.netWeightKg,
      scrapPricePerKg: context.scrapPricePerKg,
      ...(context.routerParams?.dataFound ? {
        cuttingSpeedMmPerMin: context.routerParams.cuttingSpeedMmPerMin,
      } : {}),
    });
  }
}
