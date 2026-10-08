// Why a casting-route line runs on its machine: the rule the engine chose by,
// the criteria a machine had to meet, and every machine of the class it looked
// at -- chosen, capable (with its cost on the rule's basis) or rejected (with
// the failed criteria). Pure.
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

const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function machineChoice(input: {
  rule: string;
  criteria: string[];
  evals: readonly ChoiceEval[];
  chosen: string | null;
}): MachineChoiceDto {
  const capable = input.evals.filter((e) => e.reasons.length === 0)
    .sort((a, b) => (a.rank ?? a.cost ?? Infinity) - (b.rank ?? b.cost ?? Infinity));
  const rejected = input.evals.filter((e) => e.reasons.length > 0);
  return {
    rule: input.rule,
    criteria: input.criteria,
    chosen: input.chosen,
    capableCount: capable.length,
    candidates: [
      ...capable.map((e) => ({
        name: e.name,
        status: (e.name === input.chosen ? 'chosen' : 'capable') as 'chosen' | 'capable',
        perPartCost: e.cost != null ? r4(e.cost) : null,
        reasons: e.note ? [e.note] : [],
      })),
      ...rejected.map((e) => ({ name: e.name, status: 'rejected' as const, perPartCost: null, reasons: e.reasons })),
    ],
  };
}
