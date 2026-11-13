/** One of the top 3 moulding machines that physically hold the part, compared with the chosen one (the backend's SandRouteAlternative, costs in the location's currency). */
export interface SandRouteAlternative {
  mouldingProcess: string;
  mouldingMachine: string;
  chosen: boolean;
  cavities: number | null;
  totalCost: number | null;
  complete: boolean;
}

export interface AlternativeRow {
  key: string;
  machine: string;
  process: string;
  chosen: boolean;
  cavities: number | null;
  total: number | null;
  /** The cost against the chosen route: null for the chosen one, or when the chosen route has no total. */
  difference: { amount: number; percent: number } | null;
}

/** The comparison table: each machine with how much dearer it is than the chosen one. Nothing is invented when the chosen route has no total. */
export function alternativeRows(alternatives: readonly SandRouteAlternative[] | undefined): AlternativeRow[] {
  const all = alternatives ?? [];
  const base = all.find((a) => a.chosen)?.totalCost ?? null;
  return all.map((a, i) => ({
    key: `${i}:${a.mouldingMachine}`,
    machine: a.mouldingMachine,
    process: a.mouldingProcess,
    chosen: a.chosen,
    cavities: a.cavities,
    total: a.totalCost,
    difference:
      !a.chosen && a.totalCost != null && base != null && base > 0
        ? { amount: a.totalCost - base, percent: ((a.totalCost - base) / base) * 100 }
        : null,
  }));
}
