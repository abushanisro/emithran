import {
  classifyInspectionResource, estimateBendTonnage, recommendedBendTonnage, bendShoulderWidthMm,
  BEND_COEFFICIENT, BEND_RECOMMENDED_FORCE_FACTOR,
} from '../../../../../../modules/bom-items/costing/shared/core/default-rates.constants';

describe('classifyInspectionResource', () => {
  // 1 & 4. Explicit machine_class='cmm' wins even when the machine's own name
  // has no CMM-indicating word — real row: "Axiom Zenith 1000
  // (X1500 x Y1000 x Z1000)", USA, machine_class='cmm', $16.89/hr.
  it('classifies an explicit machine_class=cmm row as CMM even when the name has no CMM-indicating word', () => {
    expect(classifyInspectionResource('cmm', 'Axiom Zenith 1000 (X1500 x Y1000 x Z1000)')).toBe('CMM');
  });

  // 2 & 3. Real row "Manual Inspection" is tagged machine_class='cmm' in this
  // schema (migration 367 maps any name containing "Inspection" into 'cmm'
  // too), but is a manual bench resource, not a CMM. The known-manual-name
  // check must win over the over-broad machine_class tag.
  it('classifies a known manual-inspection resource as MANUAL_INSPECTION even when machine_class is (over-broadly) cmm', () => {
    expect(classifyInspectionResource('cmm', 'Manual Inspection')).toBe('MANUAL_INSPECTION');
  });

  it('does not classify a known manual-inspection resource as CMM (excluded from CMM-specific pricing)', () => {
    expect(classifyInspectionResource('cmm', 'Manual Inspection')).not.toBe('CMM');
  });

  it('classifies "Manual Inspection Bench" as MANUAL_INSPECTION too', () => {
    expect(classifyInspectionResource('cmm', 'Manual Inspection Bench')).toBe('MANUAL_INSPECTION');
  });

  // 5. Pre-existing behavior for rows without machine_class (legacy / older
  // benchmark rows): fall back to the CMM_NAME_PATTERN name-text heuristic.
  // Real row: "CMM (X1500×Y1000×Z1000)".
  it('falls back to the CMM name-pattern heuristic when machine_class is null', () => {
    expect(classifyInspectionResource(null, 'CMM (X1500×Y1000×Z1000)')).toBe('CMM');
  });

  it('falls back to the CMM name-pattern heuristic when machine_class is undefined', () => {
    expect(classifyInspectionResource(undefined, 'Zeiss Contura G2 CMM')).toBe('CMM');
  });

  // Explicit structured data beats name inference: a row explicitly tagged
  // with a different, real machine_class must never be reclassified as CMM
  // just because its name happens to look CMM-like.
  it('does not let a CMM-looking name override an explicit non-CMM machine_class', () => {
    expect(classifyInspectionResource('turret_punch', 'CMM Deluxe 3000')).toBe('OTHER');
  });

  it('returns OTHER for null machine_class and a name matching neither pattern', () => {
    expect(classifyInspectionResource(null, 'Generic 30 Ton Press')).toBe('OTHER');
  });
});


// Press brake tonnage — the "Sheet Metal - Bending Manufacturing" calculator
// (calculators/009, memory/Sheetmetal/Stamping_Bending_Calculator.md).
describe('press brake tonnage (Bending calculator formula)', () => {
  it('uses the calculator constants: coefficient 1.33, recommended = theoretical x 1.25', () => {
    expect(BEND_COEFFICIENT).toBe(1.33);
    expect(BEND_RECOMMENDED_FORCE_FACTOR).toBe(1.25);
    expect(bendShoulderWidthMm(1.6)).toBeCloseTo(12.8, 10);
  });

  // 830-001720-00: SECC (UTS 270 MPa), 1.6 mm. 1000 mm bend:
  // 1.6^2 x 1000 x 270 x 1.33 / 12.8 / 9810 = 7.32 t; x 1.25 = 9.15 t.
  it('theoretical force for 1.6 mm SECC, 1 m bend = 7.32 t', () => {
    expect(estimateBendTonnage(270, 1.6, 1000)).toBeCloseTo(7.32, 2);
  });

  it('recommended force is theoretical x 1.25', () => {
    expect(recommendedBendTonnage(270, 1.6, 1000)).toBeCloseTo(9.15, 2);
  });

  it('scales linearly with bend length and UTS, with thickness (t^2 / 8t = t/8)', () => {
    const base = estimateBendTonnage(400, 2, 1000)!;
    expect(estimateBendTonnage(400, 2, 2000)).toBeCloseTo(base * 2, 2);
    expect(estimateBendTonnage(800, 2, 1000)).toBeCloseTo(base * 2, 2);
    expect(estimateBendTonnage(400, 4, 1000)).toBeCloseTo(base * 2, 2);
  });

  // MC/DC: each guard condition independently returns null.
  it.each([
    ['zero thickness', 400, 0, 1000],
    ['negative thickness', 400, -1, 1000],
    ['zero bend length', 400, 2, 0],
    ['null UTS (grade not on file)', null, 2, 1000],
    ['zero UTS', 0, 2, 1000],
  ])('returns null (never a guessed tonnage) for %s', (_label, uts, t, len) => {
    expect(estimateBendTonnage(uts as number | null, t as number, len as number)).toBeNull();
    expect(recommendedBendTonnage(uts as number | null, t as number, len as number)).toBeNull();
  });
});
