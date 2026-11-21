// The Calculators page's tabs: one per process group, built from the database (each calculator's process_calculator_mappings rows, served as
// processGroups). Pure.
//
// A calculator the catalog maps to a process group belongs to it (to each, when several processes use it). A helper no catalog row maps to
// (parts per build, a material, a feature's cleaning time) belongs where the calculators named like it do: "Additive - Parts per build" goes
// with the "Additive - ..." calculators, under the group most of them compute. A calculator with neither is under its category's group
// (a sheet_metal calculator under Sheet Metal), else Other.

export const OTHER_GROUP = 'Other';

const CATEGORY_GROUP: Readonly<Record<string, string>> = { sheet_metal: 'Sheet Metal' };

interface TabCalculator {
  id: string;
  name: string;
  calcCategory?: string | null;
  processGroups?: readonly string[] | null;
}

/** The family a calculator's name gives it: "Rapid Prototyping - Cleaning" is a "Rapid Prototyping" calculator; a name with no " - " has none. */
function namePrefix(name: string): string | null {
  const i = name.indexOf(' - ');
  return i > 0 ? name.slice(0, i).trim() : null;
}

/** Each calculator's process groups (see the file comment); never empty. */
export function calculatorProcessGroups(calculators: readonly TabCalculator[]): Map<string, string[]> {
  // The group most calculators of each name prefix compute (ties: alphabetical), from the mapped ones.
  const votes = new Map<string, Map<string, number>>();
  for (const c of calculators) {
    const prefix = namePrefix(c.name);
    if (!prefix || !c.processGroups?.length) continue;
    const tally = votes.get(prefix) ?? new Map<string, number>();
    for (const g of c.processGroups) tally.set(g, (tally.get(g) ?? 0) + 1);
    votes.set(prefix, tally);
  }
  const groupOfPrefix = (prefix: string | null): string | null => {
    const tally = prefix ? votes.get(prefix) : undefined;
    if (!tally) return null;
    return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  };
  const out = new Map<string, string[]>();
  for (const c of calculators) {
    if (c.processGroups?.length) out.set(c.id, [...c.processGroups]);
    else out.set(c.id, [groupOfPrefix(namePrefix(c.name)) ?? CATEGORY_GROUP[c.calcCategory ?? ''] ?? OTHER_GROUP]);
  }
  return out;
}

export interface ProcessGroupTab {
  group: string;
  count: number;
}

/** The tabs: every process group with a calculator, by name, with how many it has; Other last. */
export function processGroupTabs(groups: ReadonlyMap<string, readonly string[]>): ProcessGroupTab[] {
  const counts = new Map<string, number>();
  for (const list of groups.values()) for (const g of list) counts.set(g, (counts.get(g) ?? 0) + 1);
  return [...counts.entries()]
    .map(([group, count]) => ({ group, count }))
    .sort((a, b) => Number(a.group === OTHER_GROUP) - Number(b.group === OTHER_GROUP) || a.group.localeCompare(b.group));
}
