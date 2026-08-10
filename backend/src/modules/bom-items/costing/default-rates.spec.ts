import { classifyInspectionResource } from './default-rates';

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
