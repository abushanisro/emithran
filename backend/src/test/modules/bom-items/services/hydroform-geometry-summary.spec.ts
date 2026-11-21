import { AutoFillService, hydroformGeometry } from '../../../../modules/bom-items/services/auto-fill.service';

// A sheet-metal part's analysis carries what it is measured for hydroforming (cad-engine sheet_metal/features/hydroform.py, "hf_v1") into
// feature_graph.summary.hydroformGeometry, which the Sheet Metal - Hydroforming cost reads: top-level keys camelCase, the objects inside
// as the engine writes them (snake_case), as rotoBlowGeometry does.

interface Priv {
  extractGeometryFromCADResult: (cad: unknown) => unknown;
  sanitizeGeometry: (geo: unknown) => unknown;
  buildFeatureGraph: (geo: unknown, family: { family: string | null; confidence: number | null }, cad: unknown) => { summary: Record<string, unknown> };
}
interface Stored {
  drawn: unknown;
  blank: { method: string };
  flanges: unknown;
  holes: Record<string, unknown>[];
}
const svc = new AutoFillService({} as never, {} as never, {} as never) as unknown as Priv;

// The engine's measurement of the D80 x 50 drawn cup (t 1) and of a 200 x 100 plate with two 90 deg flanges 30 high
// (cad-engine/test/test_hydroform_measurements.py), outlines shortened.
const cup = {
  version: 'hf_v1', normal: [0, 0, 1], forming_depth_mm: 50, plan: { length_mm: 80, width_mm: 79.99, min_width_mm: 79.99 },
  projected_area_mm2: 5018.5, developed_area_mm2: 16589.1, main_surface: { area_mm2: 3631.7, perimeter_mm: 213.63 },
  drawn: { depth_mm: 50, opening_width_mm: 79.9, form_projected_area_mm2: 5018.2, form_developed_area_mm2: 12957.4 },
  blank: {
    method: 'drawn_equal_area', area_mm2: 16589.1, perimeter_mm: 456.58, length_mm: 145.33, width_mm: 145.33, circumscribed_diameter_mm: 145.33,
    outline_points_mm: [[72.667, 0], [0, 72.667], [-72.667, 0], [0, -72.667], [72.667, 0]], pierced_hole_area_mm2: 0, pierced_hole_perimeter_mm: 0,
  },
  flanges: [], holes: [],
};
const flanged = {
  version: 'hf_v1', normal: [0, 0, -1], forming_depth_mm: 30, plan: { length_mm: 200, width_mm: 100, min_width_mm: 100 },
  projected_area_mm2: 20000, developed_area_mm2: 25256.6, main_surface: { area_mm2: 19000, perimeter_mm: 580 }, drawn: null,
  blank: {
    method: 'true_unfold', area_mm2: 25149.8, perimeter_mm: 703, length_mm: 251.5, width_mm: 100, circumscribed_diameter_mm: 270.65,
    outline_points_mm: null, pierced_hole_area_mm2: 0, pierced_hole_perimeter_mm: 0,
  },
  flanges: [
    { kind: 'straight', angle_deg: 90, length_mm: 100, height_mm: 25, edge_radius_mm: null, face_ids: [1, 9] },
    { kind: 'straight', angle_deg: 90, length_mm: 100, height_mm: 25, edge_radius_mm: null, face_ids: [3, 7] },
  ],
  holes: [{ feature_type: 'SimpleHole', diameter_mm: 6, perimeter_mm: 18.85, area_mm2: 28.3, in_flat: true, on_main_surface: true, edge_distance_mm: 2, face_ids: [12] }],
};

const cadResult = (family: string, features: Record<string, unknown>) => ({
  geometry_features: { manufacturing_features: { manufacturing_intelligence: { detected_family: family, features: { sheet_thickness_mm: 1, ...features } } } },
});
const summaryOf = (family: string, features: Record<string, unknown>) => {
  const cad = cadResult(family, features);
  const geo = svc.sanitizeGeometry(svc.extractGeometryFromCADResult(cad));
  return svc.buildFeatureGraph(geo, { family, confidence: 0.9 }, cad).summary;
};

describe('feature_graph.summary.hydroformGeometry', () => {
  it('carries the drawn cup as measured: camelCase top-level keys, the engine objects unchanged', () => {
    expect(summaryOf('sheet_metal', { hydroform: cup }).hydroformGeometry).toEqual({
      extractionVersion: 'hf_v1',
      normal: [0, 0, 1],
      formingDepthMm: 50,
      plan: { length_mm: 80, width_mm: 79.99, min_width_mm: 79.99 },
      projectedAreaMm2: 5018.5,
      developedAreaMm2: 16589.1,
      mainSurface: { area_mm2: 3631.7, perimeter_mm: 213.63 },
      drawn: { depth_mm: 50, opening_width_mm: 79.9, form_projected_area_mm2: 5018.2, form_developed_area_mm2: 12957.4 },
      blank: cup.blank,
      flanges: [],
      holes: [],
    });
  });

  it('carries the flanged plate: no drawn form, its straight flanges and holes', () => {
    const g = summaryOf('sheet_metal', { hydroform: flanged }).hydroformGeometry as Stored;
    expect(g.drawn).toBeNull();
    expect(g.blank.method).toBe('true_unfold');
    expect(g.flanges).toEqual(flanged.flanges);
    expect(g.holes[0]).toMatchObject({ feature_type: 'SimpleHole', in_flat: true, edge_distance_mm: 2 });
  });

  it('is null when the engine did not measure the part (an analysis from before hf_v1)', () => {
    expect(summaryOf('sheet_metal', {}).hydroformGeometry).toBeNull();
    expect(summaryOf('sheet_metal', { hydroform: null }).hydroformGeometry).toBeNull();
  });

  it('is only on sheet-metal parts', () => {
    expect('hydroformGeometry' in summaryOf('milled', { hydroform: cup })).toBe(false);
  });

  it('reads nothing that is not a measurement', () => {
    expect(hydroformGeometry(undefined)).toBeNull();
    expect(hydroformGeometry('hf_v1')).toBeNull();
    expect(hydroformGeometry({ forming_depth_mm: 50 })).toBeNull(); // no version: not the engine's measurement
  });
});
