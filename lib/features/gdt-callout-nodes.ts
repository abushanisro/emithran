import type { GdtCallout } from '@/lib/api/hooks/useBOMItems';

/**
 * Manufacturing Process tree rows for the part's real GD&T callouts
 * (backend costing/shared/physics/gdt-callouts.ts), under the Inspection step:
 *
 *   Flatness ±0.05mm                    (step_pmi, real face — clickable, highlights it)
 *   Position ±0.1016mm (datum A)        (step_pmi, no face link on this part — shown, not clickable)
 *   Perpendicularity ±0.02mm (datum A)  (drawing — 2D source, never has a 3D link)
 *
 * The symbol names match cad-engine shared/step_pmi.py's own `_SYMBOLS` table
 * verbatim (the shared vocabulary those two files must agree on) with a
 * plain snake_case -> Title Case fallback for a drawing-sourced type outside
 * that closed set (the drawing parser is not constrained to it).
 *
 * v2FeatureIds is left OMITTED, not [], when faceIds is empty — the same
 * convention every other tree node in this file follows, so a callout with
 * no 3D link renders like every other node (no highlight on click), never a
 * separate "disabled" visual state to build and maintain.
 */
export interface GdtTreeNode {
  id: string;
  kind: 'feature';
  label: string;
  v2FeatureIds?: string[];
  attrs: { name: string; value: string }[];
}

const SYMBOL_LABEL: Record<string, string> = {
  flatness: 'Flatness',
  straightness: 'Straightness',
  circularity: 'Circularity',
  cylindricity: 'Cylindricity',
  profile_of_line: 'Profile of a Line',
  profile_of_surface: 'Profile of a Surface',
  angularity: 'Angularity',
  perpendicularity: 'Perpendicularity',
  parallelism: 'Parallelism',
  position: 'Position',
  concentricity: 'Concentricity',
  coaxiality: 'Coaxiality',
  symmetry: 'Symmetry',
  circular_runout: 'Circular Runout',
  total_runout: 'Total Runout',
};

function symbolLabel(type: string): string {
  return SYMBOL_LABEL[type]
    ?? type.split('_').filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
}

const SOURCE_LABEL: Record<GdtCallout['source'], string> = {
  step_pmi: 'STEP model (semantic PMI)',
  drawing: 'Drawing',
};

export function gdtCalloutNodes(idPrefix: string, callouts: readonly GdtCallout[]): GdtTreeNode[] {
  return callouts.map((c, i) => ({
    id: `${idPrefix}_${i}`,
    kind: 'feature',
    label: `${symbolLabel(c.type)} ±${c.toleranceMm}mm${c.datum ? ` (datum ${c.datum})` : ''}`,
    ...(c.faceIds.length > 0 ? { v2FeatureIds: c.faceIds } : {}),
    attrs: [
      { name: 'Tolerance', value: `±${c.toleranceMm} mm` },
      { name: 'Source', value: SOURCE_LABEL[c.source] },
      ...(c.datum ? [{ name: 'Datum', value: c.datum }] : []),
      ...(c.confidence != null ? [{ name: 'Confidence', value: `${Math.round(c.confidence * 100)}%` }] : []),
      {
        name: 'Highlight',
        value: c.faceIds.length > 0
          ? 'Click to highlight the toleranced face'
          : c.source === 'step_pmi'
            ? 'No face link for this callout in the model'
            : 'A drawing callout has no 3D face to highlight',
      },
    ],
  }));
}
