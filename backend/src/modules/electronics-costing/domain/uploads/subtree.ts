// The ids of a design and everything below it (its containers' children, recursively). Pure: used to know what a delete removes.

export interface TreeRow {
  id: string;
  parent_design_id: string | null;
}

export function subtreeIds(rows: TreeRow[], rootId: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parent_design_id) continue;
    childrenOf.set(row.parent_design_id, [...(childrenOf.get(row.parent_design_id) ?? []), row.id]);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return; // a cycle cannot occur through the foreign key, but never loop on bad data
    seen.add(id);
    out.push(id);
    (childrenOf.get(id) ?? []).forEach(visit);
  };
  visit(rootId);
  return out;
}
