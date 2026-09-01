import { PRESS_STROKE_SETUP_MIN, SHEARING_SETUP_MIN, DEFAULT_YIELD_PCT } from '../../shared/core/default-rates.constants';
import type { MHRRateInput } from '../../shared/core/cost-engine';
import type { ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { CuttingProcessContext, CuttingProcessResult } from '../../shared/core/manufacturing-process.types';
import { noRateFallback, eMithranTerms } from '../../shared/core/engine-kernel';
import { BaseCuttingEngine, buildCuttingProcessLine } from '../../shared/core/engine-orchestrator';

export interface PressStrokeInput {
  // One press stroke produces one part for Standard Press / Tandem Press
  // forming. Progressive Die Press (2026-09-01) reuses this SAME shape —
  // at steady state a progressive die also ejects one finished part per
  // stroke once the strip has filled the die's stations; batch sizes large
  // enough to justify building progressive-die tooling make the initial
  // fill-strokes negligible, a standard costing approximation, not a
  // fabricated number. Its real per-machine strokes_per_min (machine_library.json)
  // is converted to press_cycle_time_s (=60/strokes_per_min) at the data-
  // seeding layer so it flows through the exact same rate.pressCycleTimeS
  // field Standard/Tandem Press already use — never a fabricated multi-
  // stroke count either way.
  numberOfStrokes: number;
  batchSize: number;
  partWeightKg?: number;
  // The selected machine's own real press_cycle_time_s / handling_time_const_s /
  // handling_time_mass_coeff_s_per_kg (migration 608) — carried on the rate
  // object exactly like operators/machineLaborRateUsdHr already are. Absent
  // (no real data sourced for this machine — see migration 608's documented
  // 19-machine gap) means an honest $0/0-min line, never a guess.
  pressRate?: MHRRateInput;
  processIdentity?: { processGroup: string; processRoute: string; operation: string };
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

export interface PressStrokeResult {
  processLines: ProcessLineCost[];
  cuttingMin: number;
  // Always 0 — press forming has no abrasive consumable. Kept only so this
  // result shape satisfies the shared CuttingProcessResult contract.
  abrasiveCost: number;
  warnings: string[];
}

export function computePressStrokeCost(
  processLabel: string,
  machineClass: "standard_press" | "tandem_press" | "progressive_die_press" | "shear",
  input: PressStrokeInput,
): PressStrokeResult {
  const warnings: string[] = [];
  const rate = input.pressRate ?? noRateFallback(machineClass);

  let cycleMin = 0;
  if (rate.pressCycleTimeS != null && input.numberOfStrokes > 0) {
    const handlingSec =
      rate.handlingConstS != null && rate.handlingMassCoeffSPerKg != null && input.partWeightKg != null
        ? rate.handlingConstS + rate.handlingMassCoeffSPerKg * input.partWeightKg
        : 0;
    cycleMin = ((rate.pressCycleTimeS * input.numberOfStrokes) + handlingSec) / 60;
  } else {
    warnings.push(
      `${processLabel}: no real press_cycle_time_s on file for ${rate.machineName ?? "the selected machine"} — cycle time is $0 until real data is added for it, not an estimate`,
    );
  }

  if (input.setupMin == null) {
    warnings.push(`${processLabel}: setup time from fallback — seed a real per-machine setup time`);
  }
  // Shearing's real per-machine setup_time_hr (22.8min uniformly) differs
  // from Standard/Tandem/Progressive-Die Press's (30min) — see each
  // constant's own doc comment (default-rates.ts) for the cited source.
  const setupMin = input.setupMin ?? (machineClass === "shear" ? SHEARING_SETUP_MIN : PRESS_STROKE_SETUP_MIN);

  const t = eMithranTerms({
    mhrPerHr: rate.rate,
    dlrPerHr: rate.labourRate ?? input.dlrPerHr ?? 0,
    qairPerHr: input.qairPerHr ?? 0,
    setupNDL: rate.operators ?? 1,
    cycleNDL: rate.operators ?? 1,
    cycleTimeMin: cycleMin,
    setupTimeMin: setupMin / Math.max(input.batchSize, 1),
    inspTimeMin: input.inspTimeMin ?? 0,
    samplingRate: input.samplingRate ?? 0,
    yieldPct: input.yieldPct ?? DEFAULT_YIELD_PCT,
    netMatCost: input.netMatCost ?? 0,
    netWeightKg: input.netWeightKg ?? 0,
    scrapPricePerKg: input.scrapPricePerKg ?? 0,
  });

  const processLines: ProcessLineCost[] = [
    buildCuttingProcessLine({
      process: processLabel,
      processIdentity: input.processIdentity,
      setupCost: t.setupCost,
      runCost: t.machineCost + t.laborCost,
      totalCost: t.total,
      cycleTimeMin: cycleMin,
      rate,
      extra: { labourRate: rate.labourRate ?? null },
    }),
  ];

  return { processLines, cuttingMin: cycleMin, abrasiveCost: 0, warnings };
}

// Thin ManufacturingProcessEngine wrapper — one shared formula, three real
// registered classes (Standard Press / Tandem Press, migration 608;
// Progressive Die Press, 2026-09-01). These are genuinely distinct real
// machine pools (never shared/duplicated — see migration 608's header and
// default-rates.ts's progressive_die_press entry for the 14-safe/12-
// contaminated split), so each gets its own instance, not one engine
// silently serving all three from a single machineClass. Shearing
// (2026-09-01) reuses computePressStrokeCost() too (same discrete-stroke
// physics — see SHEARING_CUTS_PER_BLANK's doc comment) but is NOT a fourth
// instance of this class: it's a real cutting alternative (processFamily
// 'sheet_metal_cutting', competing with Laser/Waterjet/Turret/Router/
// OxyFuel), not a forming process — see shearing-engine.ts's own wrapper.
export class PressStrokeEngine extends BaseCuttingEngine {
  readonly machineClass: "standard_press" | "tandem_press" | "progressive_die_press";
  readonly processFamily = "sheet_metal_forming";
  private readonly processLabel: string;

  constructor(machineClass: "standard_press" | "tandem_press" | "progressive_die_press", processLabel: string) {
    super();
    this.machineClass = machineClass;
    this.processLabel = processLabel;
  }

  computeCost(context: CuttingProcessContext): CuttingProcessResult {
    return computePressStrokeCost(this.processLabel, this.machineClass, {
      numberOfStrokes: 1,
      batchSize: context.batchSize,
      partWeightKg: context.partWeightKg,
      pressRate: context.rate,
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
    });
  }
}
