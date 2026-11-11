/**
 * The blanks a sheet-metal part is cut from: one per solid body of its CAD file (cad-engine `flat_pattern_blanks`).
 * An ordinary part is one blank, equal to featureGraph.summary's single flat-pattern fields; a weldment or multi-body
 * file (a channel plus a separate end plate) has several, each unfolded in its own 2D frame and nested on its own.
 */
export interface FlatPatternBlank {
  areaMm2: number;
  boundingLengthMm: number | null;
  boundingWidthMm: number | null;
  /** The unfolded outline, null when it could not be built for this blank (outlineSource 'unavailable'). */
  outlinePointsMm: number[][] | null;
  holesMm: Array<{ cx_mm: number; cy_mm: number; diameter_mm: number }>;
  outlineSource: 'wire_walk' | 'unavailable';
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The engine's `flat_pattern_blanks`, checked; undefined when absent or not a list (an older engine). */
export function parseFlatPatternBlanks(raw: unknown): FlatPatternBlank[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((b: any): FlatPatternBlank => {
    const outline = Array.isArray(b?.outline_points_mm) && b.outline_points_mm.length >= 3
      && b.outline_points_mm.every((p: unknown) => Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]))
      ? (b.outline_points_mm as number[][])
      : null;
    return {
      areaMm2: finite(b?.area_mm2) && b.area_mm2 > 0 ? b.area_mm2 : 0,
      boundingLengthMm: finite(b?.bounding_length_mm) ? b.bounding_length_mm : null,
      boundingWidthMm: finite(b?.bounding_width_mm) ? b.bounding_width_mm : null,
      outlinePointsMm: outline,
      holesMm: Array.isArray(b?.holes_mm)
        ? b.holes_mm.filter((h: any) => finite(h?.cx_mm) && finite(h?.cy_mm) && finite(h?.diameter_mm))
        : [],
      outlineSource: outline && b?.outline_source === 'wire_walk' ? 'wire_walk' : 'unavailable',
    };
  });
}
