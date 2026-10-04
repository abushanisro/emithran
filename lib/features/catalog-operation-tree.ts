// The reference operation catalog as the tree it is.
//
// Each catalog row is a path, grammar Machine[:Station]:Operation//Feature
// [:Operation//ChildFeature ...] (memory/<domain>/Processes/operations.csv,
// stored as process_taxonomy_operations.raw_compound_string). Shown flat by its
// last segment only, the rows
//   High Pressure Die Casting:Insert Coring//ComboVoid:As Cast//SimpleHole
//   High Pressure Die Casting:No Coring//MultiStepHole:As Cast//SimpleHole
//   High Pressure Die Casting:As Cast//SimpleHole
// all read "As Cast // SimpleHole". As a tree each operation appears once per
// parent, under the feature it is performed inside.

export interface CatalogOperationInput {
  operationCategory: string | null;
  featureType: string | null;
  raw: string;
}

export interface CatalogOperationNode {
  operation: string | null;
  featureType: string | null;
  children: CatalogOperationNode[];
}

/** The Operation//Feature segments of one catalog row; leading machine/station segments are dropped. */
export function catalogOperationPath(op: CatalogOperationInput): Array<{ operation: string | null; featureType: string | null }> {
  const segments = op.raw.split(':');
  const first = segments.findIndex((s) => s.includes('//'));
  // A row with no Operation//Feature segment (a bare operation) is one node.
  if (first < 0) return [{ operation: op.operationCategory, featureType: op.featureType }];
  return segments.slice(first).map((s) => {
    const [o, f] = s.split('//');
    return { operation: o?.trim() || null, featureType: f?.trim() || null };
  });
}

const keyOf = (n: { operation: string | null; featureType: string | null }) => `${n.operation ?? ''}//${n.featureType ?? ''}`;
const byLabel = (a: CatalogOperationNode, b: CatalogOperationNode) =>
  (a.operation ?? '').localeCompare(b.operation ?? '') || (a.featureType ?? '').localeCompare(b.featureType ?? '');

export function catalogOperationTree(ops: readonly CatalogOperationInput[]): CatalogOperationNode[] {
  const root: CatalogOperationNode = { operation: null, featureType: null, children: [] };
  for (const op of ops) {
    let parent = root;
    for (const seg of catalogOperationPath(op)) {
      let node = parent.children.find((c) => keyOf(c) === keyOf(seg));
      if (!node) {
        node = { ...seg, children: [] };
        parent.children.push(node);
      }
      parent = node;
    }
  }
  const sort = (nodes: CatalogOperationNode[]) => { nodes.sort(byLabel); nodes.forEach((n) => sort(n.children)); };
  sort(root.children);
  return root.children;
}
