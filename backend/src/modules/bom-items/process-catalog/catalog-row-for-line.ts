// The process_calculator_mappings row a saved process line is labelled with.
// A machine class can have several catalog rows: the row for the line's own
// operation wins; else, when every row of the class names the same route
// (2_axis_lathe: 8 rows, all "2 Axis Lathe"), that one; else none — never the
// first row's route standing in for a different operation's.
export interface CatalogRow { process_group: string; process_route: string; operation: string; is_active: boolean }

/**
 * The rows that name a machine class's catalog identity: its active rows, or
 * — when it has none — its inactive ones. is_active means "a calculator is
 * wired", not "this route exists": Black Oxide has one real row with no
 * calculator yet, and a line moved to it still needs its route. A class WITH
 * active rows ignores its inactive ones (deactivated duplicates).
 */
export function identityRows<T extends Pick<CatalogRow, 'is_active'>>(classRows: readonly T[]): T[] {
  const active = classRows.filter((r) => r.is_active);
  return active.length > 0 ? active : [...classRows];
}

export function catalogRowForLine<T extends Omit<CatalogRow, 'is_active'>>(classRows: readonly T[], lineOperation: string): T | undefined {
  return classRows.find((r) => r.operation === lineOperation)
    ?? (new Set(classRows.map((r) => r.process_route)).size === 1 ? classRows[0] : undefined);
}
