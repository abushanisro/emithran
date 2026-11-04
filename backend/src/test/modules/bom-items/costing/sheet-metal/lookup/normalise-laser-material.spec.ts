import { normaliseLaserMaterial } from '../../../../../../modules/bom-items/costing/sheet-metal/lookup/sheet-metal-lookup.service';
import { classifyLaserMaterial } from '../../../../../../modules/bom-items/costing/shared/capability/machine-selection/physics';

// Lookup Table 5 is keyed by Carbon Steel / Stainless Steel / Aluminium / Brass.
// Stainless cuts several times slower than carbon steel at the same thickness
// and power (Table 5, 3 mm at 1000 W: 2.5 vs 3 m/min nominal; at 6000 W the
// gap is wider still), so a stainless grade resolving to Carbon Steel
// misprices laser time.
describe('normaliseLaserMaterial', () => {
  it.each([
    ['SS304', 'Stainless Steel'],
    ['SUS304', 'Stainless Steel'],
    ['304', 'Stainless Steel'],
    ['316L', 'Stainless Steel'],
    ['SS 201', 'Stainless Steel'],
    ['Stainless Steel, AISI 304L', 'Stainless Steel'],
    ['AL6061-T6', 'Aluminium'],
    ['5052-H32', 'Aluminium'],
    ['Aluminum', 'Aluminium'],
    ['CuZn39Pb3', 'Brass'],
    ['Brass', 'Brass'],
    ['CRCA', 'Carbon Steel'],
    ['IS2062 E250', 'Carbon Steel'],
    ['SECC', 'Carbon Steel'],
    [null, 'Carbon Steel'],
  ])('%s -> %s', (grade, expected) => {
    expect(normaliseLaserMaterial(grade)).toBe(expected);
  });

  it('agrees with the capability-gate classifier for stainless and aluminium grades', () => {
    for (const grade of ['SUS304', '304', '316L', 'SS 201', 'AL6061', '5052']) {
      const family = classifyLaserMaterial(grade);
      const table = normaliseLaserMaterial(grade);
      expect(table).toBe(family === 'SS' ? 'Stainless Steel' : 'Aluminium');
    }
  });
});
