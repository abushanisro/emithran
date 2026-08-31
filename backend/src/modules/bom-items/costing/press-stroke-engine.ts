import { PRESS_STROKE_SETUP_MIN } from "./default-rates";
import type { MHRRateInput } from "./cost-engine";
import type { ProcessLineCost } from "../dto/cost-breakdown.dto";
import type { CuttingProcessContext, CuttingProcessResult } from "./manufacturing-process-engine";
import { noRateFallback, computeDirectLaborCost } from "./engine-kernel";
import { BaseCuttingEngine, buildCuttingProcessLine } from "./engine-orchestrator";

export interface PressStrokeInput {
  // One press stroke produces one part for Standard Press / Tandem Press
  // forming (unlike Progressive Die Press, deliberately out of scope — see
  // migration 608's header) — never a fabricated multi-stroke count.
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
  machineClass: "standard_press" | "tandem_press",
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
  const setupMin = input.setupMin ?? PRESS_STROKE_SETUP_MIN;

  const labor = computeDirectLaborCost(rate, setupMin, cycleMin, input.batchSize, processLabel, warnings);
  const setupCost = (setupMin / 60) * rate.rate / Math.max(input.batchSize, 1) + labor.setupLaborCost;
  const runCost = (cycleMin / 60) * rate.rate + labor.runLaborCost;

  const processLines: ProcessLineCost[] = [
    buildCuttingProcessLine({
      process: processLabel,
      processIdentity: input.processIdentity,
      setupCost,
      runCost,
      cycleTimeMin: cycleMin,
      rate,
      extra: { labourRate: rate.labourRate ?? null },
    }),
  ];

  return { processLines, cuttingMin: cycleMin, abrasiveCost: 0, warnings };
}

// Thin ManufacturingProcessEngine wrapper — one shared formula, two real
// registered classes (Standard Press / Tandem Press, migration 608). These
// are genuinely distinct real machine pools (never shared/duplicated — see
// migration 608's header), so each gets its own instance, not one engine
// silently serving both from a single machineClass.
export class PressStrokeEngine extends BaseCuttingEngine {
  readonly machineClass: "standard_press" | "tandem_press";
  readonly processFamily = "sheet_metal_forming";
  private readonly processLabel: string;

  constructor(machineClass: "standard_press" | "tandem_press", processLabel: string) {
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
    });
  }
}
