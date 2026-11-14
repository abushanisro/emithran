import type { CatalogOperation } from '@/lib/api/hooks/useBOMItems';

/**
 * Manufacturing Process tree rows for a sheet-metal or plastic-molding step's catalog operations,
 * named by the feature; the catalog operation is an attribute of the row, not part of its name:
 *
 *   SimpleHole Ø4.0 ×14      (Operation: Punching)
 *     Edge
 *   SimpleHole Ø4.0 ×20      (Operation: Perforating)
 *   Blank ×1                 (undecided: Operation lists both, none picked)
 *
 * Every value comes from the backend resolver; nothing is derived here.
 */
export interface OperationTreeNode {
  id: string;
  kind: 'feature';
  label: string;
  v2FeatureIds?: string[];
  /** The faces of each feature instance on the 3D model (face_map face_ids), one occurrence each: sand casting's analysis features. */
  faceOccurrences?: number[][];
  attrs: { name: string; value: string }[];
  children?: OperationTreeNode[];
}

/**
 * What a row highlights: its features' own faces when the backend found them on the 3D model (a sand casting's analysis features are
 * not feature_graph_v2 entries, so their ids match nothing there), else the feature_graph_v2 ids. An instance with no face found is
 * left out, never shown in another's place.
 */
function highlightOf(featureIds: string[], featureFaceIds: number[][] | undefined): Pick<OperationTreeNode, 'v2FeatureIds' | 'faceOccurrences'> {
  if (!featureFaceIds) return { v2FeatureIds: featureIds };
  const faceOccurrences = featureFaceIds.filter((faces) => faces.length > 0);
  return faceOccurrences.length > 0 ? { faceOccurrences } : {};
}

const STATUS_LABEL: Record<CatalogOperation['status'], string> = {
  resolved: 'Resolved',
  undecided: 'Undecided — several catalog operations fit',
  infeasible: 'Not possible (see why)',
};

export function sheetMetalOperationNodes(idPrefix: string, operations: readonly CatalogOperation[]): OperationTreeNode[] {
  return operations.map((op, i) => {
    const dia = op.diameterMm != null ? ` Ø${op.diameterMm.toFixed(1)}` : '';
    const name = op.status === 'infeasible' ? 'No operation' : op.operations.join(' or ');
    const id = `${idPrefix}_${i}`;
    return {
      id,
      kind: 'feature',
      label: `${op.featureType}${dia} ×${op.count}`,
      ...highlightOf(op.featureIds, op.featureFaceIds),
      attrs: [
        { name: 'Operation', value: name },
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
              label: c.featureType,
              ...highlightOf(op.featureIds, op.featureFaceIds ? (c.featureFaceIds ?? []) : undefined),
              attrs: [{ name: 'Operation', value: c.operation }],
            })),
          }
        : {}),
    };
  });
}
