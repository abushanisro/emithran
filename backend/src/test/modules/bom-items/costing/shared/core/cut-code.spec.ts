// memory numbers a cut code "family.subtype", and every "Material Cut Code Family" lookup lists the family: the whole number.
import { cutCodeFamilyOf, preferredCutCode } from '../../../../../../modules/bom-items/costing/shared/core/cut-code';

const FAMILIES = new Set(['1', '2', '3', '4', '5', '8', '9', '10', '15', '20', '23', '30', '33', '34', '41', '42', '51', '52']);

describe('a cut code\'s family', () => {
  it('is its whole number: stainless 5.21 is family 5, not the thermosets\' 52; 1.50 is family 1, not 15', () => {
    expect(cutCodeFamilyOf(FAMILIES, 5.21)).toBe('5');
    expect(cutCodeFamilyOf(FAMILIES, 5.11)).toBe('5');
    expect(cutCodeFamilyOf(FAMILIES, 1.5)).toBe('1');
    expect(cutCodeFamilyOf(FAMILIES, 20.21)).toBe('20');
    expect(cutCodeFamilyOf(FAMILIES, 33.3)).toBe('33');
    expect(cutCodeFamilyOf(FAMILIES, 51.21)).toBe('51');
    expect(cutCodeFamilyOf(FAMILIES, 52.32)).toBe('52');
  });

  it('none when the lookup lists no rows for it, or there is no cut code', () => {
    expect(cutCodeFamilyOf(FAMILIES, 60.1)).toBeNull();
    expect(cutCodeFamilyOf(FAMILIES, null)).toBeNull();
    expect(cutCodeFamilyOf(FAMILIES, Number.NaN)).toBeNull();
  });
});

describe('the cut code of a material listed under several groups', () => {
  it('its general group\'s first (the wrought grade\'s own code), whatever the casting or prototyping groups list', () => {
    // Stainless Steel, AISI 304 in the local catalog.
    expect(preferredCutCode([
      { cutCode: 15.21, group: 'Casting Investment' }, { cutCode: 5.21, group: 'Bar and Tube Fabrication' }, { cutCode: 5.2, group: 'Ferrous & Non-Ferrous' },
      { cutCode: 15.21, group: 'Sand Casting' },
    ])).toBe(5.2);
    // A plastic: its Plastic & Rubber code, not Rapid Prototyping's placeholder.
    expect(preferredCutCode([{ cutCode: 1.5, group: 'Rapid Prototyping' }, { cutCode: 51.21, group: 'Plastic & Rubber' }])).toBe(51.21);
  });

  it('else the family most of its rows give, the lowest code in it; none without a code', () => {
    expect(preferredCutCode([{ cutCode: 15.21, group: 'Sand Casting' }, { cutCode: 5.21, group: 'Forging' }, { cutCode: 5.2, group: 'Sheet Metal Roll Forming' }])).toBe(5.2);
    expect(preferredCutCode([{ cutCode: 1.1, group: 'Forging' }])).toBe(1.1);
    expect(preferredCutCode([{ cutCode: null, group: 'Forging' }])).toBeNull();
    expect(preferredCutCode([])).toBeNull();
  });
});
