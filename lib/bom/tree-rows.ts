// The rows a BOM tree shows, in order, with what each row draws of the tree, and the tree narrowed to a search. Pure: the table renders these.

export interface TreeRow<T> {
  node: T;
  depth: number;
  /** For each ancestor level below the root, whether its line goes on past this row (that ancestor has more children below). */
  guides: boolean[];
  /** The last of its parent's children: its connector ends here (└) instead of going on (├). */
  isLast: boolean;
  /**
   * Its ancestors, root first, parent last. The line in guide column k runs on to the next sibling of path[k + 1] (the branch it joins), so
   * the table draws it in that item's colour; the row's own connector is drawn in its own.
   */
  path: T[];
}

/** The visible rows, depth first: a node's children follow it only while it is expanded. The root level draws no connector. */
export function visibleTreeRows<T extends { id: string; children: T[] }>(
  nodes: readonly T[], expanded: ReadonlySet<string>, depth = 0, guides: boolean[] = [], path: T[] = [],
): TreeRow<T>[] {
  return nodes.flatMap((node, i) => {
    const isLast = i === nodes.length - 1;
    const row: TreeRow<T> = { node, depth, guides, isLast, path };
    if (!expanded.has(node.id) || node.children.length === 0) return [row];
    return [row, ...visibleTreeRows(node.children, expanded, depth + 1, depth === 0 ? [] : [...guides, !isLast], [...path, node])];
  });
}

export interface FilteredTree<T> {
  /** The tree cut down to the matches, each with every ancestor (so its place in the BOM stays visible) and its own children. */
  nodes: T[];
  /** The ids that matched. */
  matches: Set<string>;
  /** The ancestors of the matches: opened, so every match is in view. */
  expand: Set<string>;
}

/** The tree narrowed to the nodes `matches` accepts. A node that matches keeps all its children; one that does not is kept only as an ancestor. */
export function filterTree<T extends { id: string; children: T[] }>(nodes: readonly T[], matches: (node: T) => boolean): FilteredTree<T> {
  const found = new Set<string>();
  const expand = new Set<string>();
  const walk = (list: readonly T[]): T[] => list.flatMap((node) => {
    if (matches(node)) {
      found.add(node.id);
      // A match under a match opens its branch too.
      if (walk(node.children).length) expand.add(node.id);
      return [node];
    }
    const kept = walk(node.children);
    if (!kept.length) return [];
    expand.add(node.id);
    return [{ ...node, children: kept }];
  });
  return { nodes: walk(nodes), matches: found, expand };
}

/** A search over a name and a part number: every word must appear in one of them, in any case and order. */
export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = fields.filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => text.includes(w));
}

/** The text split around the query's words, for highlighting: [text, matched][] in order. */
export function highlightParts(text: string, query: string): [string, boolean][] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || !text) return [[text, false]];
  const lower = text.toLowerCase();
  const marked = new Array<boolean>(text.length).fill(false);
  for (const w of words) {
    for (let i = lower.indexOf(w); i >= 0; i = lower.indexOf(w, i + 1)) marked.fill(true, i, i + w.length);
  }
  const out: [string, boolean][] = [];
  // By the string's own indexes (as indexOf counts), so a character outside the basic plane cannot shift the marks.
  for (let i = 0; i < text.length; i++) {
    const hit = marked[i] === true;
    const last = out.at(-1);
    if (last?.[1] === hit) last[0] += text.charAt(i);
    else out.push([text.charAt(i), hit]);
  }
  return out;
}
