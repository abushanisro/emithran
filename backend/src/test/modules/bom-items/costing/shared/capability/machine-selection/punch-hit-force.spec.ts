import { largestPunchHitPerimeterMm, punchingRequirement } from '../../../../../../../modules/bom-items/costing/shared/capability/machine-selection/physics';

// Rtp2 Mag2 Backframe, read from the stored CAD analysis: 124 punched holes of 13 distinct
// diameters (largest 20 mm), 5018 mm of total cut, 1.6 mm sheet. A turret strikes one hit at
// a time: the force it must carry is that of the largest tool, not of the whole contour.
const RTP2_HOLE_DIAMETERS_MM = [2.5, 3, 3.5, 4, 4.8, 5, 6, 7, 8, 9, 10, 12, 20];
const RTP2_CUT_LENGTH_MM = 5018.1;
const SHEET = { thicknessMm: 1.6, bedLengthMm: 600, bedWidthMm: 500 };
const SHEAR_MPA = 207;

describe('punch hit force (largest single hit, not total cut length)', () => {
  it('takes the perimeter of the largest punched hole', () => {
    expect(largestPunchHitPerimeterMm(RTP2_HOLE_DIAMETERS_MM)).toBeCloseTo(Math.PI * 20, 6);
  });

  it('is 0 with no punched hole, and ignores invalid diameters', () => {
    expect(largestPunchHitPerimeterMm([])).toBe(0);
    expect(largestPunchHitPerimeterMm(null)).toBe(0);
    expect(largestPunchHitPerimeterMm([NaN, -3, 0])).toBe(0);
  });

  it('puts the Rtp2 turret requirement within a 22 t machine; the total contour never would', () => {
    const perHit = punchingRequirement({ ...SHEET, materialShearStrengthMpa: SHEAR_MPA, cutLengthMm: largestPunchHitPerimeterMm(RTP2_HOLE_DIAMETERS_MM) });
    const wholeContour = punchingRequirement({ ...SHEET, materialShearStrengthMpa: SHEAR_MPA, cutLengthMm: RTP2_CUT_LENGTH_MM });
    expect(perHit.tonnage).toBeLessThan(22);
    expect(wholeContour.tonnage).toBeGreaterThan(50);
  });

  it('grows with the largest hole, so a different part decides differently', () => {
    const small = punchingRequirement({ ...SHEET, materialShearStrengthMpa: SHEAR_MPA, cutLengthMm: largestPunchHitPerimeterMm([3, 5]) });
    const large = punchingRequirement({ ...SHEET, materialShearStrengthMpa: SHEAR_MPA, cutLengthMm: largestPunchHitPerimeterMm([3, 60]) });
    expect(large.tonnage).toBeGreaterThan(small.tonnage * 10);
  });
});
