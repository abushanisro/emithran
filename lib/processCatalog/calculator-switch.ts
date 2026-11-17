// When a process line's calculator follows a change in the Process dialog. Pure: ProcessCostDialog applies it.

export interface CalculatorIdentity {
  /** The machine class of the selected machine (or the Category's one class); '' while unresolved. */
  machineClass: string;
  /** The operation the engineer picked in the dialog; null until they pick one (the saved or engine's operation is not a pick). */
  operationChoice: string | null;
}

/**
 * The calculator to switch to, or null to keep the current one.
 *
 * The line moved to another machine class, or the engineer picked another operation: the calculator becomes the catalog's for the new
 * class and operation ('' when it has none). The class resolving on open (from '' to a class) and the operation resolving without a
 * pick are not changes, so a saved line keeps the calculator it was costed with. No switch when the calculator would stay the same:
 * its inputs are kept and re-derived for a new machine rather than blanked with nothing to refill them.
 */
export function calculatorSwitch(previous: CalculatorIdentity, current: CalculatorIdentity, catalogCalculatorId: string | null, selectedCalculatorId: string): string | null {
  const classChanged = !!previous.machineClass && !!current.machineClass && previous.machineClass !== current.machineClass;
  const operationPicked = current.operationChoice != null && previous.operationChoice !== current.operationChoice;
  if (!classChanged && !operationPicked) return null;
  const next = catalogCalculatorId ?? '';
  return next === selectedCalculatorId ? null : next;
}
