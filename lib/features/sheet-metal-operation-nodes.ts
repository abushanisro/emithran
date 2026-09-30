import type { CatalogOperation } from '@/lib/api/hooks/useBOMItems';

/**
 * Manufacturing Process tree rows for a sheet-metal step's catalog operations,
 * in the catalog's own "Operation // Feature" form:
 *
 *   Punching // SimpleHole Ø4.0 ×14
 *     Punching // Edge
 *   Perforating // SimpleHole Ø4.0 ×20
 *   Nibbling or Punching // Blank ×1        (undecided: both listed, none picked)
 *
 * Every value comes from the backend resolver; nothing is derived here.
 */
export interface OperationTreeNode {
  id: string;
  kind: 'feature';
  label: string;
  v2FeatureIds?: string[];
  attrs: { name: string; value: string }[];
  children?: OperationTreeNode[];
}

const STATUS_LABEL: Record<CatalogOperation['status'], string> = {
  resolved: 'Resolved',
  undecided: 'Undecided — several catalog operations fit',
  infeasible: 'Not possible on this machine',
};

export function sheetMetalOperationNodes(idPrefix: string, operations: readonly CatalogOperation[]): OperationTreeNode[] {
  return operations.map((op, i) => {
    const dia = op.diameterMm != null ? ` Ø${op.diameterMm.toFixed(1)}` : '';
    const name = op.status === 'infeasible' ? 'No operation' : op.operations.join(' or ');
    const id = `${idPrefix}_${i}`;
    return {
      id,
      kind: 'feature',
      label: `${name} // ${op.featureType}${dia} ×${op.count}`,
      v2FeatureIds: op.featureIds,
      attrs: [
        { name: 'Status', value: STATUS_LABEL[op.status] },
        { name: 'Feature', value: `${op.featureType} (${op.variant})` },
        { name: 'Count', value: String(op.count) },
        ...(op.diameterMm != null ? [{ name: 'Diameter', value: `${op.diameterMm.toFixed(1)} mm` }] : []),
        ...(op.reason ? [{ name: 'Why', value: op.reason }] : []),
      ],
      ...(op.children.length > 0
        ? {
            children: op.children.map((c, j) => ({
              id: `${id}_${j}`,
              kind: 'feature' as const,
              label: `${c.operation} // ${c.featureType}`,
              v2FeatureIds: op.featureIds,
              attrs: [{ name: 'Catalog step of', value: `${op.operations[0]} // ${op.featureType}` }],
            })),
          }
        : {}),
    };
  });
}
