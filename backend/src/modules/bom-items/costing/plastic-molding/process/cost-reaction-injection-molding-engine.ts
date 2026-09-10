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

export interface ReactionInjectionMoldingCostInput {
  batchSize: number;
  partWeightKg?: number;
  // rate.pressCycleTimeS must be the real dry-cycle (mechanical open/close)
  // time, rate.setupTimeHr the real per-machine setup time (both staged
  // onto mhr_records and threaded generically via MachineCandidate).
  rate: MHRRateInput;
  // Real per-material cure_time_min (raw_materials, migration 619). null
  // when this specific grade has no real cure-time data on file.
  cureTimeMinFromMaterial?: number | null;
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
  const effectiveRate: MHRRateInput = {
    ...input.rate,
    pressCycleTimeS: input.rate.pressCycleTimeS != null
      ? input.rate.pressCycleTimeS + (realCureTimeSec ?? 0)
      : input.rate.pressCycleTimeS,
  };

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

  if (input.rate.pressCycleTimeS != null) {
    result.warnings.push(
      realCureTimeSec != null
        ? `Reaction Injection Molding cycle time includes real cure/reaction time (${input.cureTimeMinFromMaterial} min) ` +
          'for this material, plus the real machine dry-cycle (mechanical open/close motion).'
        : 'Reaction Injection Molding cycle time reflects only the real machine dry-cycle ' +
          '(mechanical open/close motion, no material) — no real fill-time-from-volume or ' +
          'chemical cure/reaction-time data on file for this material; total cycle time is ' +
          'understated until real data is sourced, not fabricated to fill the gap.',
    );
  }

  return result;
}
