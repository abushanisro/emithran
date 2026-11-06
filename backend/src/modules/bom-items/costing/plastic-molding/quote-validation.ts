// How far a plastic quote can be trusted, derived from the formula registry: which formulas the quote used, their validation states and assumptions,
// and which parts of a real mold quote the model cannot compute yet. Pure. Nothing here changes a number.
import { formulaById, weakestState, type ValidationState } from './formula-registry';

export interface QuoteValidation {
  /** The weakest state among the formulas the quote used (VALIDATED < ASSUMED). */
  state: ValidationState;
  /** False when something a real quote needs is not computed (see `unsupported`): the quote is partial, whatever its formulas' states. */
  complete: boolean;
  formulas: Array<{ id: string; version: number; name: string; state: ValidationState }>;
  /** Each ASSUMED formula's disclosed assumptions, prefixed with its id. */
  assumptions: string[];
  /** What the model cannot compute yet and this quote therefore leaves out; the data staged for it is named. */
  unsupported: Array<{ id: string; name: string; stagedData: string }>;
}

/** `used`: the formula ids this quote computed. `unsupported`: the G-ids that apply to it. An unregistered id is a programming error and throws. */
export function buildQuoteValidation(used: readonly string[], unsupported: readonly string[]): QuoteValidation {
  const entry = (id: string) => {
    const f = formulaById(id);
    if (!f) throw new Error(`Formula ${id} is not in the plastic formula registry`);
    return f;
  };
  const formulas = [...new Set(used)].map(entry);
  const gaps = [...new Set(unsupported)].map(entry);
  return {
    state: weakestState(formulas.map((f) => f.state)),
    complete: gaps.length === 0,
    formulas: formulas.map((f) => ({ id: f.id, version: f.version, name: f.name, state: f.state })),
    assumptions: formulas.flatMap((f) => f.assumptions.map((a) => `${f.id}: ${a}`)),
    unsupported: gaps.map((g) => ({ id: g.id, name: g.name, stagedData: g.stagedData ?? '' })),
  };
}
