import {
  injectionMoldabilityGap,
  isAdditiveFeedstock,
  moldingFeedstockFilter,
  type MoldabilityMaterial,
} from '../../../modules/raw-materials/material-moldability';

// The cases are real catalog rows (local raw_materials, group "Plastic & Rubber"): the SLA resin that was costed as an injection material, a molding grade
// with its reference data, grades of the same families without it, 3D-printing powders, stock shapes and a thermoset.
const molding: MoldabilityMaterial = {
  grade: 'Generic ABS', stockForm: 'Granules', matlState: 'Base Polymer',
  injectionPressureMaxMpa: 150, flowLengthRatio: 175, meltingTempC: 240, moldTempC: 70, densityOfMeltKgM3: 885, cureTimeMin: null,
};
const row = (over: Partial<MoldabilityMaterial>): MoldabilityMaterial => ({ ...molding, ...over });

describe('injectionMoldabilityGap', () => {
  it('lets a molding grade with its reference data through', () => {
    expect(injectionMoldabilityGap(molding)).toBeNull();
  });

  it('names an SLA resin as 3D-printing feedstock: the one cause, not a cascade (Generic 18420 White)', () => {
    const resin = row({
      grade: 'Generic 18420 White', stockForm: 'Liquid Resin (SLA)', matlState: 'Photopolymer',
      injectionPressureMaxMpa: null, flowLengthRatio: null, meltingTempC: 0, moldTempC: 0, densityOfMeltKgM3: null,
    });
    const gap = injectionMoldabilityGap(resin);
    expect(gap?.kind).toBe('additive_feedstock');
    expect(gap?.reason).toContain('"Generic 18420 White" is 3D-printing feedstock (Liquid Resin (SLA), Photopolymer)');
    expect(gap?.reason).toContain('Choose an injection-molding grade');
  });

  it.each([
    ['Liquid Resin (PolyJet)', 'Photopolymer'],
    ['Liquid Resin (MJP)', 'Photopolymer'],
    ['Liquid Wax (MJP)', 'Photopolymer'],
    ['Powder (SLS)', 'Nylon Powder'],
    ['Powder (SLS) / Granules', 'Nylon Powder'], // names Granules too, but it is a sintering powder
  ])('rules out %s as additive feedstock even when it names granules', (stockForm, matlState) => {
    expect(injectionMoldabilityGap(row({ stockForm, matlState, injectionPressureMaxMpa: null, flowLengthRatio: null }))?.kind).toBe('additive_feedstock');
  });

  it('says what is missing for a molding grade that has no reference data yet (Generic Nylon, Type 12 30% GF)', () => {
    const gap = injectionMoldabilityGap(row({
      grade: 'Generic Nylon, Type 12 30% GF', stockForm: 'Granules', matlState: 'Semi-Crystalline',
      injectionPressureMaxMpa: null, flowLengthRatio: null, densityOfMeltKgM3: null,
    }));
    expect(gap?.kind).toBe('no_injection_data');
    expect(gap?.missing).toEqual(['injection pressure', 'flow length ratio', 'melt density']);
    expect(gap?.reason).toBe('No injection-molding reference data is on file for "Generic Nylon, Type 12 30% GF": missing injection pressure, flow length ratio, melt density. Add it in Raw Materials or choose a grade that has it.');
  });

  it('treats a melt or mold temperature of zero as missing, not as a value', () => {
    expect(injectionMoldabilityGap(row({ meltingTempC: 0, moldTempC: 0 }))?.missing).toEqual(['melt temperature', 'mold temperature']);
  });

  it('rules out stock shapes: rods, sheets and tubes are not feedstock', () => {
    const gap = injectionMoldabilityGap(row({ stockForm: 'Rod / Sheet / Tube', matlState: 'Machined Stock', injectionPressureMaxMpa: null, flowLengthRatio: null }));
    expect(gap?.kind).toBe('not_molding_feedstock');
  });

  it('does not rule out a material because its form is not recorded; its data decides', () => {
    expect(injectionMoldabilityGap(row({ stockForm: null, matlState: null }))).toBeNull();
    expect(injectionMoldabilityGap(row({ stockForm: null, matlState: null, injectionPressureMaxMpa: null, flowLengthRatio: null }))?.kind).toBe('no_injection_data');
  });

  it('lets silicone (LSR) through on its cure time, which needs no injection pressure', () => {
    const lsr = row({ grade: 'Generic LSR', stockForm: null, injectionPressureMaxMpa: null, flowLengthRatio: null, cureTimeMin: 0.5 });
    expect(injectionMoldabilityGap(lsr, true)).toBeNull();
    expect(injectionMoldabilityGap(lsr, false)?.kind).toBe('no_injection_data');
  });
});

describe('isAdditiveFeedstock', () => {
  it('reads the stock form or the material state', () => {
    expect(isAdditiveFeedstock('Liquid Resin (DLP)', null)).toBe(true);
    expect(isAdditiveFeedstock(null, 'Photopolymer')).toBe(true);
    expect(isAdditiveFeedstock('Granules', 'Semi-Crystalline')).toBe(false);
    expect(isAdditiveFeedstock(null, null)).toBe(false);
  });
});

describe('moldingFeedstockFilter (the picker\'s database filter, built from the same words)', () => {
  it('keeps rows with no form recorded, and feedstock forms that are not printing forms', () => {
    expect(moldingFeedstockFilter()).toBe(
      'stock_form.is.null,and(or(stock_form.ilike.*granule*,stock_form.ilike.*pellet*,stock_form.ilike.*compound*,stock_form.ilike.*prepreg*),'
      + 'stock_form.not.ilike.*resin*,stock_form.not.ilike.*powder*,stock_form.not.ilike.*wax*)',
    );
  });
});
