// The route + operation a process line is saved with. They follow the
// MACHINE CLASS the line is on: a line moved to another machine class (e.g.
// an Inspection line re-pointed at a Black Oxide machine) takes that class's
// catalog identity (process_calculator_mappings), never the old line's saved
// strings — which would store a Black Oxide machine labelled "Inspection".
export interface CatalogIdentity { processRoute: string; operation: string }

export type LineIdentity =
  | { ok: true; processRoute: string; operation: string; source: 'saved' | 'catalog' }
  | { ok: false; reason: string };

export function resolveLineIdentity(input: {
  savedMachineClass: string | null | undefined;
  savedProcessRoute: string;
  savedOperation: string;
  selectedMachineClass: string;
  selectedOperation: string;          // picked from the CAD-detected operation list ('' if none)
  classCatalog: CatalogIdentity | null | undefined; // the single catalog row for selectedMachineClass
}): LineIdentity {
  if (keepsSavedOperation(input.savedMachineClass, input.selectedMachineClass) && input.savedProcessRoute) {
    return {
      ok: true,
      processRoute: input.savedProcessRoute,
      operation: input.selectedOperation || input.savedOperation,
      source: 'saved',
    };
  }
  if (input.classCatalog) {
    return {
      ok: true,
      processRoute: input.classCatalog.processRoute,
      operation: input.selectedOperation || input.classCatalog.operation,
      source: 'catalog',
    };
  }
  return {
    ok: false,
    reason: input.selectedMachineClass
      ? `Machine class "${input.selectedMachineClass}" has no single process-catalog row, so this line's route and operation cannot be set — choose a machine whose class is in the process catalog.`
      : 'Choose a machine first — the line’s route and operation come from its machine class.',
  };
}

/** Whether a line's saved operation still applies: only while its machine class is unchanged. */
export function keepsSavedOperation(savedMachineClass: string | null | undefined, selectedMachineClass: string): boolean {
  return !!savedMachineClass && savedMachineClass === selectedMachineClass;
}
