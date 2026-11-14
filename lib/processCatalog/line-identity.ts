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
  /** The selected machine is the one the line was saved on (see keepsSavedOperation). */
  sameMachine?: boolean;
}): LineIdentity {
  if (keepsSavedOperation(input.savedMachineClass, input.selectedMachineClass, input.sameMachine) && input.savedProcessRoute) {
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

/**
 * Whether a line's saved operation still applies: while its machine class is unchanged, or while it is still on the very machine it was saved
 * on. An operation hosted on another class's machine (Tapping, saved as class "tapping", run on the 3 Axis Mill that taps it) is opened on
 * that machine: its class differs from the saved one, but nothing about the line changed.
 */
export function keepsSavedOperation(savedMachineClass: string | null | undefined, selectedMachineClass: string, sameMachine = false): boolean {
  return (!!savedMachineClass && savedMachineClass === selectedMachineClass) || sameMachine;
}

/**
 * The line a new or changed line would duplicate: another line of the part on the same machine class carrying the same operation. One operation is one
 * line; the way to cost it again is to edit that line. Matching ignores case and surrounding space; the line being edited is not its own duplicate.
 */
export function findDuplicateOperation(
  existing: ReadonlyArray<{ id?: string | null; opNbr?: number | null; machineClass?: string | null; operation?: string | null }>,
  candidate: { id?: string | null; machineClass: string; operation: string },
): { opNbr: number | null } | null {
  const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();
  if (!norm(candidate.machineClass) || !norm(candidate.operation)) return null;
  const hit = existing.find((p) => p.id !== candidate.id && norm(p.machineClass) === norm(candidate.machineClass) && norm(p.operation) === norm(candidate.operation));
  return hit ? { opNbr: hit.opNbr ?? null } : null;
}

