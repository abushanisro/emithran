import { describe, expect, it } from 'vitest';

import type { PlasticDfmView } from '@/lib/api/hooks/useBOMItems';
import { isSupersededPlasticCheck, isSupersededPlasticWarning, plasticDfmReadiness } from '@/lib/dfm/plastic-superseded';

const view = (severities: Array<'Critical' | 'Major' | 'Minor'>): PlasticDfmView => ({
  status: 'ok', reasons: [],
  result: {
    rulesetVersion: 't', process: 'Injection Molding', materialType: 'Nylon', passed: [], notEvaluated: [], notes: [],
    findings: severities.map((severity, i) => ({
      rule: `R${i}`, title: 't', severity, measured: 1, threshold: 2, comparison: '<', unit: null, note: null, count: 1, featureIds: [], faces: [i], label: `label ${severity} ${i}`,
    })),
  },
});

describe('the superseded fixed-threshold plastic items', () => {
  it('are the draft, thin-zone, wall-range and all-clear warnings, and nothing else', () => {
    for (const id of ['dfm_im_draft_0', 'dfm_im_thin_wall_3', 'dfm_im_wall_min_1', 'dfm_im_wall_max_2', 'dfm_im_pass_9']) expect(isSupersededPlasticWarning({ id })).toBe(true);
    for (const id of ['dfm_im_undercut_0', 'dfm_im_wall_variation_1', 'dfm_im_parting_2', 'dfm_im_rib_fillet_3', 'dfm_im_inserts_4', 'dfm_sheet_1']) expect(isSupersededPlasticWarning({ id })).toBe(false);
  });

  it('checks: draft, wall range and thin zones', () => {
    for (const id of ['check_im_draft', 'check_im_wall_range', 'check_im_thin_zones']) expect(isSupersededPlasticCheck({ id })).toBe(true);
    for (const id of ['check_im_undercut', 'check_im_wall_uniformity', 'check_im_parting', 'check_mfr_score']) expect(isSupersededPlasticCheck({ id })).toBe(false);
  });
});

describe('plasticDfmReadiness', () => {
  it('a critical finding blocks readiness; critical and major findings are the risk flags, minor ones are not', () => {
    const r = plasticDfmReadiness(view(['Critical', 'Major', 'Minor']));
    expect(r.critical).toBe(true);
    expect(r.flags).toEqual(['label Critical 0', 'label Major 1']);
  });

  it('major findings alone do not block (the engine grades nylon draft as major, and readiness stays on critical as it always was)', () => {
    expect(plasticDfmReadiness(view(['Major'])).critical).toBe(false);
  });

  it('says nothing before the result is there, or when it could not be computed', () => {
    expect(plasticDfmReadiness(undefined)).toEqual({ critical: false, flags: [] });
    expect(plasticDfmReadiness({ status: 'unavailable', result: null, reasons: ['x'] })).toEqual({ critical: false, flags: [] });
  });
});
