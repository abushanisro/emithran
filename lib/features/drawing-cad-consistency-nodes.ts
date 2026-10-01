import type { FactMismatch } from '@/lib/api/hooks/useBOMItems';

/**
 * Validation tab rows for the part's 2D-drawing-vs-3D-CAD fact agreement
 * (backend costing/shared/physics/drawing-cad-consistency.ts):
 *
 *   ✗ Bend count: drawing says 3 bends, the 3D model measures 2 bends   (critical — clickable, highlights the CAD bends)
 *   ! Sheet thickness: drawing (2.0 mm) and 3D model (2.11 mm) disagree (warning)
 *   Overall dimensions: not present in either source                   (info — nothing fabricated)
 *
 * Pure 1:1 transform, same convention as gdtCalloutNodes: v2FeatureIds is
 * left OMITTED, not [], when the fact has no real CAD features to point at
 * — a mismatch with no 3D link renders like any other row, never a
 * separate "disabled" state to build and maintain.
 */
export interface DrawingCadConsistencyNode {
  id: string;
  fact: string;
  label: string;
  drawingValue: string;
  cadValue: string;
  status: FactMismatch['status'];
  severity: FactMismatch['severity'];
  message: string;
  v2FeatureIds?: string[];
}

export function drawingCadConsistencyNodes(mismatches: readonly FactMismatch[]): DrawingCadConsistencyNode[] {
  return mismatches.map((m, i) => ({
    id: `dcc_${m.fact}_${i}`,
    fact: m.fact,
    label: m.label,
    drawingValue: m.drawingValue,
    cadValue: m.cadValue,
    status: m.status,
    severity: m.severity,
    message: m.message,
    ...(m.v2FeatureIds?.length ? { v2FeatureIds: m.v2FeatureIds } : {}),
  }));
}
