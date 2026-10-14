import type { AnnotationKind, DimensionAnnotation } from '@/lib/features/dimension-annotations';

/**
 * GD&T frames and datum marks from the STEP's PMI (cad-engine pmi.items[]), tied to the
 * diameter / radius callouts on the model.
 *
 * The file ties a tolerance to a CAD feature by NAME only ("Position1@Hole Pattern2"); its shape
 * aspects carry no faces. The one link the file does write is the same feature name on a
 * dimension ("Diameter4@Hole Pattern2(5.5)"). So a frame is placed by the chain
 *   tolerance -> CAD feature name -> the radius/diameter dimension of that feature -> its nominal
 *   -> the callout of that kind and size
 * and only when that chain ends at exactly one callout. Anything else is returned unanchored, and
 * says why; nothing is placed by guess. A frame never carries datum references: the file stores
 * none, and the way a CAD tool draws "A-B-C" is not data.
 */

export interface PmiItem {
  id: string;
  kind: 'dimension' | 'geometric' | 'datum' | 'label_only';
  source?: string | undefined;
  label?: string | null | undefined;
  cad_feature?: string | null | undefined;
  // dimension / label_only
  dimension_kind?: string | undefined;
  nominal_mm?: number | undefined;
  lower_mm?: number | null | undefined;
  upper_mm?: number | null | undefined;
  basic?: boolean | undefined;
  // geometric
  type?: string | undefined;
  zone_mm?: number | undefined;
  datum_refs?: readonly string[] | undefined;
  // datum
  letter?: string | undefined;
}

export interface PmiFrame {
  itemId: string;
  type: string;
  symbol: string;
  zoneMm: number;
  cadFeature: string | null;
  /** The callout the frame is drawn on, or null. */
  annotationId: string | null;
  /** How it was placed, or why it could not be. */
  via: string;
  /** Always empty: the STEP stores no datum reference for a tolerance. */
  datumRefs: readonly string[];
}

export interface PmiDatumMark {
  itemId: string;
  letter: string;
  cadFeature: string | null;
  annotationId: string | null;
  via: string;
}

export interface PmiLayout {
  frames: PmiFrame[];
  datums: PmiDatumMark[];
  /** Label-only callouts (a value in the label, no tolerance stored), e.g. "Width2@Width1(15)". */
  labelOnly: PmiItem[];
}

const SYMBOLS: Record<string, string> = {
  position: '⌖', flatness: '⏥', cylindricity: '⌭', perpendicularity: '⟂', parallelism: '∥',
  angularity: '∠', circularity: '○', straightness: '⎯', profile_of_surface: '⌓', profile_of_line: '⌒',
  concentricity: '◎', coaxiality: '◎', symmetry: '⌯', circular_runout: '↗', total_runout: '⌰',
};
const SAME_NOMINAL_MM = 0.005;

export function gdtSymbol(type: string): string {
  return SYMBOLS[type] ?? type;
}

/** The one callout a CAD feature name resolves to, or why not. */
function resolveFeature(
  cadFeature: string | null | undefined, items: readonly PmiItem[], annotations: readonly DimensionAnnotation[],
): { annotationId: string | null; via: string } {
  if (!cadFeature) return { annotationId: null, via: 'the PMI item names no CAD feature' };
  const sizes = items.filter((i) => i.kind === 'dimension' && i.cad_feature === cadFeature
    && (i.dimension_kind === 'radius' || i.dimension_kind === 'diameter') && i.nominal_mm != null);
  if (sizes.length === 0) return { annotationId: null, via: `no radius or diameter dimension in the file names "${cadFeature}"` };
  const hits = new Set<string>();
  for (const s of sizes) {
    const kind: AnnotationKind = s.dimension_kind === 'radius' ? 'radius' : 'diameter';
    for (const a of annotations) {
      if (a.kind === kind && Math.abs(a.valueMm - s.nominal_mm!) <= SAME_NOMINAL_MM) hits.add(a.id);
    }
  }
  if (hits.size === 1) return { annotationId: [...hits][0]!, via: `CAD feature name "${cadFeature}" + dimension size` };
  return {
    annotationId: null,
    via: hits.size === 0 ? `"${cadFeature}" is dimensioned but no callout on the model has that size` : `"${cadFeature}" matches more than one callout`,
  };
}

export function layoutPmi(
  items: readonly PmiItem[] | null | undefined, annotations: readonly DimensionAnnotation[],
): PmiLayout {
  const all = items ?? [];
  return {
    frames: all.filter((i) => i.kind === 'geometric' && i.type && i.zone_mm != null).map((i) => ({
      itemId: i.id, type: i.type!, symbol: gdtSymbol(i.type!), zoneMm: i.zone_mm!, cadFeature: i.cad_feature ?? null,
      datumRefs: [], ...(({ annotationId, via }) => ({ annotationId, via }))(resolveFeature(i.cad_feature, all, annotations)),
    })),
    datums: all.filter((i) => i.kind === 'datum' && i.letter).map((i) => ({
      itemId: i.id, letter: i.letter!, cadFeature: i.cad_feature ?? null,
      ...(({ annotationId, via }) => ({ annotationId, via }))(resolveFeature(i.cad_feature, all, annotations)),
    })),
    labelOnly: all.filter((i) => i.kind === 'label_only'),
  };
}
