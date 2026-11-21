// A hydroformed part as the engine takes it: the hydroform measurements the cad-engine makes of every sheet-metal part
// (sheet_metal/features/hydroform.py, hf_v1), stored by auto-fill as feature_graph.summary.hydroformGeometry. Pure.

type Obj = Readonly<Record<string, unknown>>;

/** The summary's hydroform measurement, as stored (the cad-engine's keys; a camelCase spelling of a key is read the same). */
export type HydroformGeometrySummary = Obj;

export interface HydroformFlange {
  kind: 'straight' | 'curved';
  angleDeg: number;
  lengthMm: number;
  heightMm: number | null;
  edgeRadiusMm: number | null;
}

export interface HydroformHole {
  featureType: string;
  diameterMm: number | null;
  perimeterMm: number;
  areaMm2: number;
  /** Through the flat (a face parallel to the main face); false: through a drawn or formed wall. Either way pierced in the flat blank. */
  inFlat: boolean;
  onMainSurface: boolean;
  /** From the hole's edge to the main face's outer boundary; null when not on the main surface. */
  edgeDistanceMm: number | null;
  /** Its faces on the part (face_map ids, the feature graph's numbering), for the 3D highlight; empty when not measured. */
  faceIds: number[];
}

export interface HydroformPart {
  /** The part's extent along the press axis (the main face normal). */
  depthMm: number;
  planLengthMm: number;
  planWidthMm: number;
  /** The narrowest caliper width of the plan. */
  minWidthMm: number;
  projectedAreaMm2: number;
  developedAreaMm2: number;
  mainSurface: { areaMm2: number; perimeterMm: number };
  drawn: { depthMm: number; openingWidthMm: number; formProjectedAreaMm2: number; formDevelopedAreaMm2: number } | null;
  blank: {
    method: string;
    areaMm2: number;
    /** The blank's outer cut length; null when the cad-engine declined its outline (the blanking force is then not checked). */
    perimeterMm: number | null;
    lengthMm: number;
    widthMm: number;
    circumscribedDiameterMm: number;
    outlinePointsMm: number[][] | null;
    piercedHoleAreaMm2: number;
    piercedHolePerimeterMm: number;
  };
  flanges: HydroformFlange[];
  holes: HydroformHole[];
  /** What the cad-engine could not measure on this part, each said on the quote (holes or flanges not measured are not read as none). */
  unmeasured: string[];
}

const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
const get = (o: Obj | null | undefined, key: string): unknown => (o == null ? undefined : o[key] ?? o[camel(key)]);
const obj = (v: unknown): Obj | null => (v != null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : null);
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const positive = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n > 0 ? n : null;
};
const text = (v: unknown, fallback: string): string => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
const nonNegative = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n >= 0 ? n : null;
};

/** The plan area the tool forms (mm²): the drawn form's when the measurement has it, else the part's whole plan. */
export function formAreaMm2(part: HydroformPart): number {
  const drawn = part.drawn?.formProjectedAreaMm2 ?? 0;
  return drawn > 0 ? drawn : part.projectedAreaMm2;
}

/** The extraction this engine reads; an older one (or none) is measured again by Refresh analysis. */
export const HYDROFORM_EXTRACTION_VERSION = 'hf_v1';
const REFRESH = 'press Refresh analysis so the part is measured for hydroforming';

/**
 * The part, or what its measurement lacks, each named. A part analysed before the measurement existed is asked to be analysed again; a value a
 * current measurement left null is one the cad-engine could not measure on this part (analysing it again gives the same), so it is named as that.
 */
export function hydroformPart(g: HydroformGeometrySummary | null | undefined): { part: HydroformPart | null; missing: string[] } {
  // null: the current engine analysed the part and found no sheet to measure (no thickness, no main face, no faces a thickness apart).
  if (g === null) return { part: null, missing: ['the hydroforming measurements: the cad-engine found no sheet (a thickness and a main face) to measure on this part'] };
  const version = get(g, 'extraction_version') ?? get(g, 'version');
  if (!g || version !== HYDROFORM_EXTRACTION_VERSION) return { part: null, missing: [`the hydroforming measurements: ${REFRESH}`] };
  const plan = obj(get(g, 'plan'));
  const main = obj(get(g, 'main_surface'));
  const blank = obj(get(g, 'blank'));
  const drawn = obj(get(g, 'drawn'));
  const depth = positive(get(g, 'forming_depth_mm'));
  const length = positive(get(plan, 'length_mm'));
  const width = positive(get(plan, 'width_mm'));
  const blankArea = positive(get(blank, 'area_mm2'));
  const blankPerimeter = positive(get(blank, 'perimeter_mm'));
  const developed = positive(get(g, 'developed_area_mm2'));
  if (depth == null || length == null || width == null || blankArea == null || developed == null) {
    const missing = [
      ...(depth == null ? ['the forming depth'] : []),
      ...(length == null || width == null ? ['the plan along the press axis'] : []),
      ...(blankArea == null ? [blank ? "the blank's area" : 'the blank (a part of several bodies, or bends the unfold could not lay flat)'] : []),
      ...(developed == null ? ['the developed area'] : []),
    ];
    return { part: null, missing: missing.map((m) => `${m}: the cad-engine could not measure it on this part`) };
  }

  const outline = get(blank, 'outline_points_mm');
  const drawnDepth = positive(get(drawn, 'depth_mm'));
  const drawnWidth = positive(get(drawn, 'opening_width_mm'));
  const flanges = (Array.isArray(get(g, 'flanges')) ? get(g, 'flanges') as unknown[] : []).map(obj).filter((f): f is Obj => f != null).flatMap((f): HydroformFlange[] => {
    const kind = get(f, 'kind');
    const angle = num(get(f, 'angle_deg'));
    const len = positive(get(f, 'length_mm'));
    if ((kind !== 'straight' && kind !== 'curved') || angle == null || len == null) return [];
    return [{ kind, angleDeg: angle, lengthMm: len, heightMm: positive(get(f, 'height_mm')), edgeRadiusMm: positive(get(f, 'edge_radius_mm')) }];
  });
  const unmeasured = [
    ...(blankPerimeter == null ? ["the blank's outline (its cut length), so the blanking press's force is not checked"] : []),
    ...(Array.isArray(get(g, 'holes')) ? [] : ['the holes, so none is pierced and no capping tool is costed']),
    ...(Array.isArray(get(g, 'flanges')) ? [] : ['the flanges, so no hand adjusting is costed']),
  ];
  const holes = (Array.isArray(get(g, 'holes')) ? get(g, 'holes') as unknown[] : []).map(obj).filter((h): h is Obj => h != null).map((h): HydroformHole => ({
    featureType: text(get(h, 'feature_type'), 'SimpleHole'),
    diameterMm: positive(get(h, 'diameter_mm')),
    perimeterMm: nonNegative(get(h, 'perimeter_mm')) ?? 0,
    areaMm2: nonNegative(get(h, 'area_mm2')) ?? 0,
    inFlat: get(h, 'in_flat') !== false,
    onMainSurface: get(h, 'on_main_surface') === true,
    edgeDistanceMm: num(get(h, 'edge_distance_mm')),
    faceIds: (Array.isArray(get(h, 'face_ids')) ? get(h, 'face_ids') as unknown[] : []).map(num).filter((n): n is number => n != null && n >= 0),
  }));
  const blankLength = positive(get(blank, 'length_mm')) ?? length;
  const blankWidth = positive(get(blank, 'width_mm')) ?? width;
  return {
    part: {
      depthMm: depth, planLengthMm: Math.max(length, width), planWidthMm: Math.min(length, width),
      minWidthMm: positive(get(plan, 'min_width_mm')) ?? Math.min(length, width),
      projectedAreaMm2: positive(get(g, 'projected_area_mm2')) ?? length * width,
      developedAreaMm2: developed,
      mainSurface: { areaMm2: nonNegative(get(main, 'area_mm2')) ?? 0, perimeterMm: nonNegative(get(main, 'perimeter_mm')) ?? 0 },
      drawn: drawnDepth != null && drawnWidth != null ? {
        depthMm: drawnDepth, openingWidthMm: drawnWidth,
        formProjectedAreaMm2: nonNegative(get(drawn, 'form_projected_area_mm2')) ?? 0, formDevelopedAreaMm2: nonNegative(get(drawn, 'form_developed_area_mm2')) ?? 0,
      } : null,
      blank: {
        method: text(get(blank, 'method'), 'unknown'), areaMm2: blankArea, perimeterMm: blankPerimeter,
        lengthMm: blankLength, widthMm: blankWidth,
        // Not measured (the outline was declined): the blank's rectangle's own circle, which encloses the blank (the fit check stays safe).
        circumscribedDiameterMm: positive(get(blank, 'circumscribed_diameter_mm')) ?? Math.hypot(blankLength, blankWidth),
        outlinePointsMm: Array.isArray(outline) && outline.length >= 3 ? outline as number[][] : null,
        piercedHoleAreaMm2: nonNegative(get(blank, 'pierced_hole_area_mm2')) ?? 0,
        piercedHolePerimeterMm: nonNegative(get(blank, 'pierced_hole_perimeter_mm')) ?? 0,
      },
      flanges, holes, unmeasured,
    },
    missing: [],
  };
}
