/**
 * In the calculator dialog a reference table is clicked to fill an input, and the value taken is the
 * LAST column of the row. A table that holds several values of one machine (punch rate, tool change,
 * nibble speed) therefore has to put the column the input reads last.
 */
export interface ReferenceColumn { name: string; label: string; unit?: string }

export function withOutputColumnLast<T extends ReferenceColumn>(columns: readonly T[], outputColumn: string | undefined): T[] {
  if (!outputColumn || !columns.some((c) => c.name === outputColumn)) return [...columns];
  return [...columns.filter((c) => c.name !== outputColumn), ...columns.filter((c) => c.name === outputColumn)];
}

