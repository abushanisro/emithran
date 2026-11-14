// Compression Molding — cost engine.
//
// Compression molding is NOT injection-style physics: there is no fill,
// gate, runner, or pack/hold phase, and cooling does not follow the Menges
// thermal model computeInjectionMoldedCostSummary() uses (that model is a
// real, tested fit for an injected shot cooling in a closed cavity, not for
// a preheated charge/preform consolidating under a press). A preheated
// charge is placed in an open mold; the press closes under real force over
// real time, the material cures/consolidates under heat and pressure, the
// press opens, and the part is ejected. Reusing the injection engine here
// would be physically wrong, not just imprecise — see the process-duplicate
// audit (2026-09-02) that found this process previously silently reused
// Structural Foam Molding's/Injection Molding's machine_class and engine.
//
// Real MACHINE data (memory/Injection/machine/compression_molding_machines.json,
// 23 machines): press kinematics (openingStrokeMm, compressionTravelRateMmPerS,
// rapidTravelRateMmPerS) and setupTimeHr — both real, both staged onto
// mhr_records (press_cycle_time_s = real close+open platen-motion time,
// setup_time_hr = real per-machine setup, threaded generically via
// MachineCandidate — see machine-selection.dto.ts). Reuses
// sheet-metal/press-stroke-engine.ts's computePressStrokeCost() UNCHANGED
// (it is a domain-neutral pure function, not tied to Sheet Metal's
// CuttingProcessContext) — no formula rewrite, "one press cycle = one part"
// is the same real physics Standard/Tandem/Progressive Die Press already use.
//
// Real MATERIAL data (Phase 1 materials-data foundation, 2026-09-02):
// cure/dwell time (the time the material spends under pressure+heat
// actually curing/consolidating) is a MATERIAL property, not a machine
// property — memory/Injection/materials_final.json has real cureTimeMin for
// 35 real thermoset SMC/BMC materials (raw_materials.cure_time_min,
// migration 619, resolved by resolveMaterialForFamily the same way
// materialCostPerKg is). An earlier version of this engine looked for cure
// time on the MACHINE data (where it genuinely does not exist) and
// concluded it was universally unavailable — wrong layer, not a real gap.
// When the part's specific material grade has a real cure_time_min, it is
// folded into the effective cycle time below; when it doesn't (e.g. a
// grade outside the 35 real thermoset entries), the gap is disclosed
// exactly as before — real data used where it exists, honest disclosure
// where it doesn't, never a fabricated constant either way.

import { computePressStrokeCost, type PressStrokeResult } from '../../sheet-metal/process/press-stroke-engine';
import type { MHRRateInput } from '../../shared/core/cost-engine';
import { type ReferenceCalculators, withFieldOverrides, type CalculatorFieldOverrides } from '../../shared/calculators/reference-calculator';
import { runCompressionCycleTime } from '../calculators/plastic-cycle-time';
import type { MachineRecord, MaterialRecord } from '../calculators/plastic-input-sources';

interface CompressionMoldingCostInput {
  batchSize: number;
  partWeightKg?: number;
  // rate.pressCycleTimeS must be the real open+close platen-motion time,
  // rate.setupTimeHr the real per-machine setup time (both staged onto
  // mhr_records and threaded generically via MachineCandidate — see each
  // field's own doc comment in machine-selection.dto.ts/cost-engine.ts).
  rate: MHRRateInput;
  // Real per-material cure_time_min (raw_materials, migration 619),
  // resolved by the caller from the SAME material row materialCostPerKg
  // came from. null when this specific grade has no real cure-time data on
  // file — never fabricated, never a generic thermoset average.
  cureTimeMinFromMaterial?: number | null;
  /** The HR Rates record of the press (its press_cycle_time_s) and the Raw Materials record of the cure time: the calculator dialog opens them. */
  machineRecord?: MachineRecord | null;
  materialRecord?: MaterialRecord | null;
  /** The stored cycle-time calculators by name (migration 975): the press cycle plus cure time is computed by "Compression Molding - Cycle Time". Absent = a named gap, no cycle. */
  calculators?: ReferenceCalculators | null;
  /** The part's own values for calculator fields (calculator_field_overrides, migration 1011), laid over the calculators for this calculation. */
  calculatorOverrides?: CalculatorFieldOverrides | null;
  dlrPerHr?: number;
  qairPerHr?: number;
  processIdentity?: { processGroup: string; processRoute: string; operation: string };
}

export function computeCompressionMoldingCost(input: CompressionMoldingCostInput): PressStrokeResult {
  const realCureTimeSec = input.cureTimeMinFromMaterial != null ? input.cureTimeMinFromMaterial * 60 : null;

  // Fold real cure time into the effective press-cycle time (platen motion
  // + cure, both real) rather than modifying press-stroke-engine.ts itself
  // — that shared, Sheet-Metal-owned function's formula stays untouched;
  // only the INPUT this caller passes it changes. When platen-motion data
  // itself is also unresolved (rate.pressCycleTimeS null), stays null —
  // computePressStrokeCost's own existing $0 + "no real press_cycle_time_s
  // on file" warning path is unaffected.
  // The press cycle plus cure time is the stored calculator's (calculators/plastic-cycle-time.ts): the engine seeds its inputs and passes its result on.
  const cycle = runCompressionCycleTime({ pressCycleTimeS: input.rate.pressCycleTimeS ?? null, cureTimeMin: input.cureTimeMinFromMaterial ?? null, machine: input.machineRecord ?? null, material: input.materialRecord ?? null }, withFieldOverrides(input.calculators, input.calculatorOverrides) ?? null);
  const effectiveRate: MHRRateInput = { ...input.rate, pressCycleTimeS: cycle.derivable ? cycle.cycleSec : null };

  const result = computePressStrokeCost('Compression Molding', 'compression_molding', {
    numberOfStrokes: 1,
    batchSize: input.batchSize,
    partWeightKg: input.partWeightKg,
    pressRate: effectiveRate,
    // Real per-machine setup_time_hr, converted to minutes. With none on
    // file, setup is not costed (all 23 real machines in the source data
    // have one).
    setupMin: input.rate.setupTimeHr != null ? input.rate.setupTimeHr * 60 : undefined,
    processIdentity: input.processIdentity,
    dlrPerHr: input.dlrPerHr,
    qairPerHr: input.qairPerHr,
    // No real material-cost inputs here on purpose: Compression Molding's
    // material cost is computed by the SAME caller-side shot-weight model
    // Injection Molding already uses (net weight x material $/kg), kept as
    // a separate top-level field, not folded into this process line — same
    // separation computeInjectionMoldedCostSummary's own output uses
    // (materialCost is a top-level field, not part of processLines).
  });

  if (cycle.derivable) {
    const line = result.processLines[0];
    if (line) {
      line.calculationTrace = cycle.trace;
      if (Object.keys(cycle.lookups).length > 0) line.lookupMatches = cycle.lookups;
      if (cycle.calculator.id) line.calculatorId = cycle.calculator.id;
      line.calculatorName = cycle.calculator.name;
      if (cycle.calculator.version != null) line.calculatorVersion = cycle.calculator.version;
    }
  } else if (input.rate.pressCycleTimeS != null) {
    // The machine has its cycle time: it is the calculator that is missing, so the press function's "no press_cycle_time_s on file" would be wrong.
    result.warnings = result.warnings.filter((w) => !w.includes('no real press_cycle_time_s on file'));
    result.warnings.push(cycle.calculatorProblem ? `Compression Molding cycle time not derivable: ${cycle.calculatorProblem}.` : `Compression Molding cycle time not derivable: missing ${cycle.missing.join('; ')}.`);
  }

  if (cycle.derivable) {
    result.warnings.push(
      realCureTimeSec != null
        ? `Compression Molding cycle time includes real cure time (${input.cureTimeMinFromMaterial} min) for this material, plus real press open/close motion.`
        : 'Compression Molding cycle time reflects only real press open/close motion — ' +
          'no real cure-time data on file for this material; total cycle time is understated ' +
          'until real data is sourced, not fabricated to fill the gap.',
    );
  }

  return result;
}
