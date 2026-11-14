// The Process and Operation choices of one process group, for adding an operation by hand: every process of the
// group in the catalog (process_calculator_mappings; for Machining, the 43 processes of memory/Machining/processes.csv),
// each with the operations the catalog lists for it. Pure.

export interface CatalogOperationRow {
  processGroup: string;
  processRoute: string;
  operation: string;
  machineClass?: string | null;
  machineCategory?: string | null;
  isActive?: boolean;
}

export interface ProcessOperations {
  process: string;
  /** The process's own line first (operation = process, e.g. "Broach"), then its operations by name. */
  operations: CatalogOperationRow[];
}

export function processOperationOptions(rows: readonly CatalogOperationRow[], processGroup: string): ProcessOperations[] {
  const byProcess = new Map<string, CatalogOperationRow[]>();
  for (const row of rows) {
    // A row with no machine class is a catalog marker (No Cost Feature, Use Stock Machining): there is no machine to price it on.
    if (row.processGroup !== processGroup || row.isActive === false || !row.machineClass) continue;
    const list = byProcess.get(row.processRoute) ?? [];
    if (!list.some((r) => r.operation === row.operation)) list.push(row);
    byProcess.set(row.processRoute, list);
  }
  return [...byProcess.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([process, operations]) => ({
      process,
      operations: [...operations].sort((a, b) =>
        Number(b.operation === process) - Number(a.operation === process) || a.operation.localeCompare(b.operation)),
    }));
}
