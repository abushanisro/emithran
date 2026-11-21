// The rows a BOM tree shows, in order, with what each row draws of the tree. Pure: the table renders these.

export interface TreeRow<T> {
  node: T;
  depth: number;
  /** For each ancestor level below the root, whether its line goes on past this row (that ancestor has more children below). */
  guides: boolean[];
  /** The last of its parent's children: its connector ends here (└) instead of going on (├). */
  isLast: boolean;
}

/** The visible rows, depth first: a node's children follow it only while it is expanded. The root level draws no connector. */
export function visibleTreeRows<T extends { id: string; children: T[] }>(
  nodes: readonly T[], expanded: ReadonlySet<string>, depth = 0, guides: boolean[] = [],
): TreeRow<T>[] {
  return nodes.flatMap((node, i) => {
    const isLast = i === nodes.length - 1;
    const row: TreeRow<T> = { node, depth, guides, isLast };
    if (!expanded.has(node.id) || node.children.length === 0) return [row];
    return [row, ...visibleTreeRows(node.children, expanded, depth + 1, depth === 0 ? [] : [...guides, !isLast])];
  });
}
