import { gridCarbonFactor, materialCarbonFactor, stockOf } from '../../../../../../modules/bom-items/costing/shared/physics/carbon-factors';

describe('gridCarbonFactor: the part\'s own location, never another country\'s grid', () => {
  it('has a published factor for every location the app prices, each with its source', () => {
    for (const loc of ['USA', 'India', 'China', 'Mexico', 'France']) {
      const g = gridCarbonFactor(loc)!;
      expect(g.kgCo2ePerKwh).toBeGreaterThan(0);
      expect(g.source.length).toBeGreaterThan(20);
    }
    expect(gridCarbonFactor('USA')!.source).toContain('eGRID');
    expect(gridCarbonFactor('France')!.kgCo2ePerKwh).toBeLessThan(gridCarbonFactor('India')!.kgCo2ePerKwh);
  });

  it('a location with no published factor has none', () => {
    expect(gridCarbonFactor('Atlantis')).toBeNull();
  });
});

describe('materialCarbonFactor: by the grade\'s material class, as the real grade names read', () => {
  it('"Aluminum, AA 1100" is primary aluminium (IAI), not the old 2 kg default', () => {
    const m = materialCarbonFactor('Aluminum, AA 1100')!;
    expect(m.kgCo2ePerKg).toBe(14.8);
    expect(m.source).toContain('IAI');
    expect(m.lowerCarbonOption!.kgCo2ePerKg).toBeLessThan(1);
  });

  it('carbon steel and copper have their industry-body factors', () => {
    expect(materialCarbonFactor('AISI 1018')!.source).toContain('worldsteel');
    expect(materialCarbonFactor('Copper C110')!.source).toContain('International Copper Association');
  });

  it('has no factor where none is verified, rather than a guess: stainless, titanium, brass, plastics, an unrecognised grade', () => {
    for (const g of ['SS304', 'Ti-6Al-4V', 'Brass C360', 'ABS', 'Unobtainium 9', null]) expect(materialCarbonFactor(g)).toBeNull();
  });
});

describe('stockOf', () => {
  it('names how each family\'s stock is made', () => {
    expect(stockOf('sheet_metal')).toBe('sheet');
    expect(stockOf('mill_turn')).toBe('bar_or_billet');
    expect(stockOf('milled')).toBe('bar_or_billet');
    expect(stockOf('sand_cast')).toBe('near_net');
    expect(stockOf('plastic_molded')).toBe('near_net');
  });
});
