import { AutoFillService } from '../../../../modules/bom-items/services/auto-fill.service';

// The fixed-threshold plastic warnings and checks are gone from the analysis: the rule-based engine (plastic-molding/dfm/plastic-dfm.ts) judges draft and wall against the
// staged thresholds of the material. The rules no data defines yet (undercut, wall variation, parting, ribs, inserts) are still written.

type Priv = { buildDFMWarnings: (geo: unknown, cad: unknown) => Array<{ id: string }>; buildValidationChecks: (geo: unknown, family: string | null, cad: unknown) => Array<{ id: string }> };
const svc = Object.create(AutoFillService.prototype) as unknown as Priv;

const features = {
  undrafted_face_count: 15, undercut_face_count: 21, thin_wall_violation_count: 5, wall_thickness_nominal_mm: 0.8, wall_uniformity_ratio: 6.49, parting_complexity: 0.5,
  rib_count: 3, fillet_count: 0, insert_candidate_count: 2,
};
const cad = { geometry_features: { manufacturing_features: { manufacturing_intelligence: { detected_family: 'plastic_molded', features } } } };
const geo = { holeCount: 0, bendCount: 0 };

describe('the plastic analysis no longer writes the fixed-threshold draft and wall findings', () => {
  it('writes no draft, thin-zone, wall-range or "all clear" warning, whatever the numbers', () => {
    const ids = svc.buildDFMWarnings(geo, cad).map((w) => w.id.replace(/_\d+$/, ''));
    for (const gone of ['dfm_im_draft', 'dfm_im_thin_wall', 'dfm_im_wall_min', 'dfm_im_wall_max', 'dfm_im_pass']) expect(ids).not.toContain(gone);
  });

  it('still writes the rules no staged data defines', () => {
    const ids = svc.buildDFMWarnings(geo, cad).map((w) => w.id.replace(/_\d+$/, ''));
    expect(ids).toEqual(expect.arrayContaining(['dfm_im_undercut', 'dfm_im_wall_variation', 'dfm_im_parting', 'dfm_im_rib_fillet', 'dfm_im_inserts']));
  });

  it('a clean part gets no "No critical DFM issues" claim (the engine, not a fixed list, says what is clean)', () => {
    const clean = { geometry_features: { manufacturing_features: { manufacturing_intelligence: { detected_family: 'plastic_molded', features: { wall_thickness_nominal_mm: 2 } } } } };
    expect(svc.buildDFMWarnings(geo, clean)).toEqual([]);
  });

  it('writes no draft, wall-range or thin-zone check', () => {
    const ids = svc.buildValidationChecks(geo, 'plastic_molded', cad).map((c) => c.id);
    for (const gone of ['check_im_draft', 'check_im_wall_range', 'check_im_thin_zones']) expect(ids).not.toContain(gone);
    expect(ids).toEqual(expect.arrayContaining(['check_im_undercut', 'check_im_wall_uniformity', 'check_im_parting']));
  });
});
