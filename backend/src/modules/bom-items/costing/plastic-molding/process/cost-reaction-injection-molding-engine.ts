// Reaction Injection Molding (RIM) — cost engine.
//
// RIM genuinely injects — two reactive liquid components (e.g. polyol +
// isocyanate for polyurethane) are mixed and injected into a closed mold —
// but the part forms by CHEMICAL REACTION (an exothermic cure), not by
// thermal cooling of a plasticized melt. computeInjectionMoldedCostSummary()'s
// Menges cooling model is a real, tested fit for a thermoplastic melt losing
// heat to a cold mold wall; it does not describe an exothermic reactive cure
// and would misrepresent RIM's real physics if reused here, the same reason
// Compression Molding gets its own engine rather than reusing the injection
// one (see cost-compression-molding-engine.ts's own header).
//
// Real MACHINE data (memory/Injection/machine/reaction_injection_molding_machines.json,
// 2 machines): setupTimeHr (real, staged generically via MachineCandidate.setupTimeHr)
// and dryCycleTimeS (a real MECHANICAL dry-run cycle time — mold open/close
// with no material, staged as mhr_records.press_cycle_time_s). Also real:
// rates.injectionRateMm3PerS — NOT used here, since computing a real fill
// time from it needs the actual part volume at quote time, and there is no
// per-part-volume-aware physics model wired for this class yet (a genuine
// follow-up, not fabricated now).
//
// Real MATERIAL data (Phase 1 materials-data foundation, 2026-09-02):
// materials_final.json's process-compatibility flags mark the SAME 38
// materials RIM-compatible as compression-moldable, and 35 of those have
// real cureTimeMin (raw_materials.cure_time_min, migration 619). Reaction
// cure time is a chemistry property of the material, same reasoning as
// Compression Molding's — folded into the effective cycle time below when
// the part's specific grade has one on file.

import { computePressStrokeCost, type PressStrokeResult } from '../../sheet-metal/process/press-stroke-engine';
import type { MHRRateInput } from '../../shared/core/cost-engine';
import type { ReferenceCalculators } from '../../shared/calculators/reference-calculator';
import { runRimCycleTime } from '../calculators/plastic-cycle-time';

interface ReactionInjectionMoldingCostInput {
  batchSize: number;
  partWeightKg?: number;
  // rate.pressCycleTimeS must be the real dry-cycle (mechanical open/close)
  // time, rate.setupTimeHr the real per-machine setup time (both staged
  // onto mhr_records and threaded generically via MachineCandidate).
  rate: MHRRateInput;
  // Real per-material cure_time_min (raw_materials, migration 619). null
  // when this specific grade has no real cure-time data on file.
  cureTimeMinFromMaterial?: number | null;
  /** The CAD net part volume (mm3) and the machine's staged injection rate (mm3/s): the fill time is the one over the other (formula registry F-19). Absent = no fill time, so a named gap. */
  partVolumeMm3?: number | null;
  injectionRateMm3PerS?: number | null;
  /** The stored cycle-time calculators by name (migrations 975, 976): the dry cycle plus fill plus cure time is computed by "Reaction Injection Molding - Cycle Time". Absent = a named gap, no cycle. */
  calculators?: ReferenceCalculators | null;
  dlrPerHr?: number;
  qairPerHr?: number;
  processIdentity?: { processGroup: string; processRoute: string; operation: string };
}

export function computeReactionInjectionMoldingCost(input: ReactionInjectionMoldingCostInput): PressStrokeResult {
  const realCureTimeSec = input.cureTimeMinFromMaterial != null ? input.cureTimeMinFromMaterial * 60 : null;

  // Fold real cure/reaction time into the effective cycle time (dry-cycle
  // mechanical motion + cure, both real) — same non-invasive pattern as
  // Compression Molding's own engine; press-stroke-engine.ts itself stays
  // untouched.
  // The dry cycle plus cure time is the stored calculator's (calculators/plastic-cycle-time.ts): the engine seeds its inputs and passes its result on.
  const cycle = runRimCycleTime({
    machineCycleTimeS: input.rate.pressCycleTimeS ?? null, partVolumeMm3: input.partVolumeMm3 ?? null,
    injectionRateMm3PerS: input.injectionRateMm3PerS ?? null, cureTimeMin: input.cureTimeMinFromMaterial ?? null,
  }, input.calculators ?? null);
  const effectiveRate: MHRRateInput = { ...input.rate, pressCycleTimeS: cycle.derivable ? cycle.cycleSec : null };

  const result = computePressStrokeCost('Reaction Injection Molding', 'reaction_injection_molding', {
    numberOfStrokes: 1,
    batchSize: input.batchSize,
    partWeightKg: input.partWeightKg,
    pressRate: effectiveRate,
    setupMin: input.rate.setupTimeHr != null ? input.rate.setupTimeHr * 60 : undefined,
    processIdentity: input.processIdentity,
    dlrPerHr: input.dlrPerHr,
    qairPerHr: input.qairPerHr,
    // No real material-cost inputs here on purpose — same top-level-field
    // separation as Compression Molding / Injection Molding (see their own
    // engines' comments).
  });

  if (cycle.derivable) {
    const line = result.processLines[0];
    if (line) {
      line.calculationTrace = cycle.trace;
      if (Object.keys(cycle.lookups).length > 0) line.lookupMatches = cycle.lookups;
      if (cycle.calculator.id) line.calculatorId = cycle.calculator.id;
      if (cycle.calculator.version != null) line.calculatorVersion = cycle.calculator.version;
    }
  } else if (input.rate.pressCycleTimeS != null) {
    // The machine has its cycle time: it is the fill inputs or the calculator that are missing, so the press function's "no press_cycle_time_s on file" would be wrong.
    result.warnings = result.warnings.filter((w) => !w.includes('no real press_cycle_time_s on file'));
    result.warnings.push(cycle.calculatorProblem ? `Reaction Injection Molding cycle time not derivable: ${cycle.calculatorProblem}.` : `Reaction Injection Molding cycle time not derivable: missing ${cycle.missing.join('; ')}.`);
  }

  if (cycle.derivable) {
    result.warnings.push(
      realCureTimeSec != null
        ? `Reaction Injection Molding cycle time = machine dry cycle + fill time (part volume over the machine injection rate, F-19) + real cure/reaction time (${input.cureTimeMinFromMaterial} min) ` +
          'for this material. Runner volume, mix-head purge and handling are not modelled.'
        : 'Reaction Injection Molding cycle time = machine dry cycle + fill time (part volume over the machine injection rate, F-19) ' +
          '— no real cure/reaction-time data on file for this material; total cycle time is ' +
          'understated until real data is sourced, not fabricated to fill the gap.',
    );
  }

  return result;
}
