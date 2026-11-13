/** A route line, as the comparison computes it now. */
interface RouteLine {
  process: string;
  machineClass: string;
  machineName: string | null;
}

/** A saved process row, as Apply wrote it. */
interface SavedRow {
  operation?: string | null;
  category?: string | null;
  machineClass?: string | null;
  machineName?: string | null;
}

export interface MachineDrift {
  process: string;
  /** The machine the saved row was costed on. */
  applied: string;
  /** The machine the applied route picks now. */
  now: string;
}

/**
 * Where the applied route now picks another machine than the one its saved row was costed on. A route is named by its id (for injection molding, a
 * press size class), and the comparison recomputes the machine it picks whenever its inputs change; the saved rows keep what was applied. Rows pair by
 * machine class, and by operation when one class runs more than one line. A line with no machine on either side, or a row the route has no line for,
 * is no drift.
 */
export function routeMachineDrift(lines: readonly RouteLine[], saved: readonly SavedRow[]): MachineDrift[] {
  return saved.flatMap((row): MachineDrift[] => {
    const name = (row.category || row.operation || '').trim();
    const sameClass = lines.filter((l) => row.machineClass != null && l.machineClass === row.machineClass);
    const line = sameClass.length === 1 ? sameClass[0] : sameClass.find((l) => l.process === name);
    return row.machineName && line?.machineName && line.machineName !== row.machineName
      ? [{ process: line.process, applied: row.machineName, now: line.machineName }]
      : [];
  });
}
