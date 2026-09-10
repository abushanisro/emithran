import { PRESS_STROKE_SETUP_MIN, SHEARING_SETUP_MIN, COMPRESSION_MOLDING_SETUP_MIN, REACTION_INJECTION_MOLDING_SETUP_MIN, DEFAULT_YIELD_PCT } from '../../shared/core/default-rates.constants';
import type { MHRRateInput } from '../../shared/core/cost-engine';
import type { ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { CuttingProcessContext, CuttingProcessResult } from '../../shared/core/manufacturing-process.types';
import { noRateFallback, eMithranTerms } from '../../shared/core/engine-kernel';
import { resolveSetupMinutes } from '../../shared/core/engine-kernel';
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
  // Progressive Die Press ONLY (2026-09-02): real per-SELECTED-MACHINE
  // setup_time_hr, resolved by the caller via
  // SheetMetalLookupService.getProgressiveDieMachineSetupMin(). Standard/
  // Tandem Press's real setup_time_hr genuinely IS uniform (0.5hr/30min,
  // matching PRESS_STROKE_SETUP_MIN) — but Progressive Die's real per-machine
  // value varies 28.2-43.2min across the 14 safe machines (correlates with
  // press-force tier), so collapsing it to one shared constant was wrong.
  // Used only when input.setupMin (the generic per-operation
  // sm_lookup_op_setup_time value) is absent — no row exists there for
  // progressive_die_press today, so this is currently the real primary path
  // for this one machine class.
  progressiveDieSetupMinFromMachine?: number | null;
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
  machineClass: "standard_press" | "tandem_press" | "progressive_die_press" | "shear" | "compression_molding" | "reaction_injection_molding",
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
  } else if (rate.machineName == null || rate.rate <= 0) {
    // This branch used to emit the press_cycle_time_s message below, which was
    // wrong and actively misleading: it blamed absent machine data when in fact
    // NO MACHINE WAS SELECTED at all, so there was never a machine whose
    // press_cycle_time_s could be looked up.
    //
    // Observed on a real SECC 1.5mm part: all four USA tandem_press rows carry
    // a real press_cycle_time_s (0.5 / 2 / 2.8 / 3), yet this warning claimed
    // none was on file. The actual cause was capability -- those rows have
    // max_thickness_*_mm = 0, so the fail-closed capability check rejected every
    // one of them and selection returned nothing.
    warnings.push(
      `${processLabel}: no capable machine on file for this part in this location, so no ` +
      `machine was selected and no cycle time could be resolved. This is a machine ` +
      `capability/rate gap, not missing press_cycle_time_s — check the capability limits ` +
      `(thickness, bed, press force) on the candidate machines.`,
    );
  } else if (input.numberOfStrokes <= 0) {
    warnings.push(
      `${processLabel}: no stroke count was derived for this part, so no cycle time could be ` +
      `resolved for ${rate.machineName}.`,
    );
  } else {
    warnings.push(
      `${processLabel}: no real press_cycle_time_s on file for ${rate.machineName} — cycle time is $0 until real data is added for it, not an estimate`,
    );
  }

  // The SAME resolver the other sixteen sheet-metal engines use:
  // calculator -> this machine's own mhr_records.setup_time_hr -> the
  // per-operation sm_lookup_op_setup_time row -> the cited class constant.
  //
  // This engine was the one outlier, with its own chain that did neither of the
  // things that matter:
  //
  //   it never read rate.setupTimeHr, so a Standard Press carrying a real
  //     setup_time_hr of 0.5 (30 min) had that value ignored entirely; and
  //   it accepted `input.setupMin != null`, which is TRUE for 0 --
  //     resolveOpSetupMin returns { minutes: 0, dataFound: false } on a miss and
  //     the caller passes .minutes through, so a class with no
  //     sm_lookup_op_setup_time row (the whole press family: that table has 11
  //     rows, none of them standard/tandem/progressive) resolved to 0 minutes.
  //
  // Together those charged $0.00 setup on every press line while the machine
  // had a real 30-minute setup on file. resolveSetupMinutes rejects 0 as "the
  // column was never populated" and consults the machine first, so both halves
  // are fixed by using it rather than by special-casing anything here.
  const progressiveDieMachineSetupHr =
    machineClass === "progressive_die_press" && input.progressiveDieSetupMinFromMachine != null
      ? input.progressiveDieSetupMinFromMachine / 60
      : null;
  const setup = resolveSetupMinutes({
    process: processLabel,
    machineSetupTimeHr: rate.setupTimeHr ?? progressiveDieMachineSetupHr,
    operationSetupMin: input.setupMin,
    // Shearing's real per-machine setup_time_hr (22.8min uniformly) differs
    // from Standard/Tandem Press's (30min) -- see each constant's own doc
    // comment (default-rates.ts) for the cited source. Compression Molding /
    // Reaction Injection Molding reuse this same shared formula.
    classDefaultMin: machineClass === "shear" ? SHEARING_SETUP_MIN
      : machineClass === "compression_molding" ? COMPRESSION_MOLDING_SETUP_MIN
      : machineClass === "reaction_injection_molding" ? REACTION_INJECTION_MOLDING_SETUP_MIN
      : PRESS_STROKE_SETUP_MIN,
    machineName: rate.machineName,
  });
  const setupMin = setup.setupMin;
  const setupSource = setup.source;
  // Progressive Die keeps its own, more specific disclosure: unlike Standard/
  // Tandem Press (a genuinely uniform 30min across all 8 real machines) its
  // real per-machine values span 28.2-43.2min by press-force tier, so landing
  // on the class constant there hides a real spread and says so. The shared
  // resolver cannot know that, hence the substitution rather than an extra
  // warning -- the generic sentence would otherwise sit beside it saying less.
  if (setup.warning) {
    warnings.push(
      machineClass === "progressive_die_press" && setup.source === "class_default"
        ? `${processLabel}: setup time from generic fallback (${PRESS_STROKE_SETUP_MIN}min) — no real per-machine setup_time_hr resolved for ${rate.machineName ?? "the selected machine"}; real values vary 28.2-43.2min by press-force tier`
        : setup.warning,
    );
  }

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
      // The UN-amortised setup, the same figure eMithranTerms was charged for
      // above (it receives setupMin / batchSize; this is setupMin itself).
      //
      // This engine was the only sheet-metal engine that never reported it.
      // The persistence layer writes `line.setupTimeMin ?? 15`, so every
      // Standard Press / Tandem Press / Progressive Die / Shearing row was
      // saved with a setup time of 15 minutes — a number with no source at
      // all — while the quote beside it had been costed from this machine's
      // real 30min (PRESS_STROKE_SETUP_MIN, the measured setup_time_hr shared
      // by all 8 real press machines) or 22.8min for shearing. The record
      // disagreed with the quote it recorded, and the Cost Guide re-derives
      // setup cost from the record.
      setupTimeMin: setupMin,
      setupTimeSource: setupSource,
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
  readonly processLabel: string;

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
      progressiveDieSetupMinFromMachine: context.progressiveDieSetupMinFromMachine,
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
