// Why a casting-route line runs on its machine: the rule the engine chose by,
// the criteria a machine had to meet, the chosen machine and the next cheapest
// capable ones (at most MACHINE_CHOICES), and how many were capable of how many
// checked. Pure.
//
// Casting machines are chosen by fixed, sourced rules (clamp and tie-bar fit,
// temperature, weight, cheapest per part), not by the physics machine-selection
// scoring (fit / utilization / availability) of MachineSelectionResult, whose
// inputs these machines do not carry -- so this states the rule actually used
// instead of filling that shape with values that do not exist.

import type { MachineChoiceDto } from '../../dto/cost-breakdown.dto';

export interface ChoiceEval {
  name: string;
  /** Failed criteria; empty = capable. */
  reasons: string[];
  /** The rule's comparison value (per part, line currency) when capable. */
  cost?: number | null;
  /** What the cost covers, when not the rule's default wording. */
  note?: string;
  /** Order among the capable when the rule does not compare cost (default: cost). */
  rank?: number;
}

/** A per-part cost: 4 decimals from a cent up, 3 significant figures below a cent (rounding those to 4 decimals made a fraction of a cent 0). */
export const roundPerPart = (n: number) => (Math.abs(n) >= 0.01 ? Math.round(n * 10000) / 10000 : n === 0 ? 0 : Number(n.toPrecision(3)));

/** Machines listed under "Why this machine": the chosen one and the next cheapest capable ones. */
export const MACHINE_CHOICES = 3;

/**
 * The chosen machine and the next cheapest capable ones (at most MACHINE_CHOICES), with how many were capable and how many were checked. When no
 * machine is capable, the first MACHINE_CHOICES checked are listed with the criteria they failed: that is why the line is a gap.
 */
export function machineChoice(input: {
  rule: string;
  criteria: string[];
  evals: readonly ChoiceEval[];
  chosen: string | null;
}): MachineChoiceDto {
  const capable = input.evals.filter((e) => e.reasons.length === 0)
    .sort((a, b) => Number(b.name === input.chosen) - Number(a.name === input.chosen) || (a.rank ?? a.cost ?? Infinity) - (b.rank ?? b.cost ?? Infinity));
  return {
    rule: input.rule,
    criteria: input.criteria,
    chosen: input.chosen,
    capableCount: capable.length,
    checkedCount: input.evals.length,
    candidates: capable.length > 0
      ? capable.slice(0, MACHINE_CHOICES).map((e) => ({
        name: e.name,
        status: e.name === input.chosen ? 'chosen' as const : 'capable' as const,
        perPartCost: e.cost != null ? roundPerPart(e.cost) : null,
        reasons: e.note ? [e.note] : [],
      }))
      : input.evals.slice(0, MACHINE_CHOICES).map((e) => ({ name: e.name, status: 'rejected' as const, perPartCost: null, reasons: e.reasons })),
  };
}
