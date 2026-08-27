import { checkMachineCapability } from './machine-capability';
import type { PartGeometryForCapability } from './machine-capability';
import { EMPTY_CAPABILITY } from './machine-selection/seed-registry';
import type { MachineCapability } from './machine-selection/seed-registry';

function geometry(overrides: Partial<PartGeometryForCapability> = {}): PartGeometryForCapability {
  return {
    sheetThicknessMm: 3,
    flatPatternLengthMm: 500,
    flatPatternWidthMm: 300,
    ...overrides,
  };
}

function capability(overrides: Partial<MachineCapability> = {}): MachineCapability {
  return { ...EMPTY_CAPABILITY, ...overrides };
}

describe('checkMachineCapability — turret punch tonnage', () => {
  it('is capable when the real TPP force is within the registered machine tonnage', () => {
    // Theoretical force = (cutLength * thickness * shear) / 9810, recommended = *1.25
    // (500mm * 3mm * 400MPa) / 9810 = 61.16t theoretical -> 76.45t recommended
    // exceeds SM-PUNCH-CNC's 30t rating — should be INcapable; use a smaller
    // cut length to stay under the real 30t rating instead.
    const g = geometry({ punchCutLengthMm: 100, materialShearStrengthMpa: 400 });
    // (100*3*400)/9810 = 12.23t theoretical -> 15.28t recommended, under 30t
    const result = checkMachineCapability('turret_punch', 'SM-PUNCH-CNC', g);
    expect(result.capable).toBe(true);
    expect(result.estimatedTonnage).toBeCloseTo(15.28, 1);
  });

  it('fails with TONNAGE_EXCEEDED (punch force wording) when the real force exceeds the machine rating', () => {
    const g = geometry({ punchCutLengthMm: 500, materialShearStrengthMpa: 400 });
    const result = checkMachineCapability('turret_punch', 'SM-PUNCH-CNC', g);
    expect(result.capable).toBe(false);
    expect(result.reasonCodes).toContain('TONNAGE_EXCEEDED');
    expect(result.reasons.some((r) => r.includes('punch force'))).toBe(true);
  });

  it('skips the tonnage check (assumed capable on that axis) when shear strength or cut length is missing', () => {
    const g = geometry({ punchCutLengthMm: null, materialShearStrengthMpa: null });
    const result = checkMachineCapability('turret_punch', 'SM-PUNCH-CNC', g);
    expect(result.estimatedTonnage).toBeNull();
    // Still gated by the flat thickness limit + bed size, just not by tonnage
    expect(result.reasonCodes).not.toContain('TONNAGE_EXCEEDED');
  });

  it('still enforces the flat turret thickness limit independently of tonnage', () => {
    const g = geometry({ sheetThicknessMm: 8, punchCutLengthMm: 50, materialShearStrengthMpa: 300 });
    const result = checkMachineCapability('turret_punch', 'SM-PUNCH-CNC', g);
    expect(result.capable).toBe(false);
    expect(result.reasonCodes).toContain('CLASS_THICKNESS_LIMIT');
  });
});

describe('checkMachineCapability — press brake tonnage (no regression)', () => {
  it('still computes bend tonnage the same way, unaffected by the turret change', () => {
    const g = geometry({ bendLengthMm: 500, materialUtsMpa: 410 });
    const result = checkMachineCapability('press_brake', 'SM-BRAKE-80T', g);
    expect(result.estimatedTonnage).not.toBeNull();
    expect(result.reasons.every((r) => !r.includes('punch force'))).toBe(true);
  });
});

// P0.1 — machine-selection/selector.ts's real, DB-first hydrated capability
// (mhr_records -> seed registry -> class defaults) now takes priority over
// the static MACHINE_CAPABILITY_REGISTRY whenever it's available. These
// tests prove the exact live defect the audit found is fixed, and that the
// static-registry fallback is unchanged when no real capability is passed.
describe('checkMachineCapability — real per-machine capability (P0.1)', () => {
  it('rejects a job the real machine cannot bend, even with no commodity code — the confirmed live defect', () => {
    // 10mm mild steel, 3000mm bend -> ~222.6t required (1.42*410*3000*10^2/(1000*80))
    const g = geometry({
      sheetThicknessMm: 10, bendLengthMm: 3000, materialUtsMpa: 410,
      flatPatternLengthMm: 3000, flatPatternWidthMm: 1500,
    });
    // Old behaviour for this exact input: no commodity code -> assumed capable.
    // This is the bug: the real selector already proved no machine on file
    // could do this job (200T < 222.6t * 1.15 margin) and passed null through.
    const oldResult = checkMachineCapability('press_brake', null, g);
    expect(oldResult.capable).toBe(true);

    const realCap = capability({ maxTonnage: 200, maxLengthMm: 4000, maxThicknessMm: 20 });
    const newResult = checkMachineCapability('press_brake', null, g, realCap);
    expect(newResult.capable).toBe(false);
    expect(newResult.reasonCodes).toContain('TONNAGE_EXCEEDED');
    expect(newResult.confidence).toBe('high');
  });

  it('judges a real machine whose commodity code is not in the static registry on its own real numbers, not a default-capable guess', () => {
    const g = geometry({ sheetThicknessMm: 12, flatPatternLengthMm: 2000, flatPatternWidthMm: 1000 });
    const oldResult = checkMachineCapability('press_brake', 'BEND-BRAKE-01', g); // not a registry key
    expect(oldResult.capable).toBe(true); // SPEC_NOT_ON_FILE -> old "assumed capable"

    const realCap = capability({ maxThicknessMm: 8 }); // this real machine can't actually do 12mm
    const newResult = checkMachineCapability('press_brake', 'BEND-BRAKE-01', g, realCap);
    expect(newResult.capable).toBe(false);
    expect(newResult.reasonCodes).toContain('THICKNESS_EXCEEDED');
  });

  it('honors material-family-specific laser thickness limits instead of the flat generic limit', () => {
    const g = geometry({
      sheetThicknessMm: 10, materialGrade: 'SS304',
      flatPatternLengthMm: 1000, flatPatternWidthMm: 500,
    });
    // Generic limit (20mm) would pass 10mm, but the real stainless-specific
    // limit (6mm) must govern for an SS304 part.
    const realCap = capability({ maxThicknessMm: 20, maxThicknessSsMm: 6, maxXMm: 4000, maxYMm: 2000 });
    const result = checkMachineCapability('fiber_laser', 'SM-LASER-4K', g, realCap);
    expect(result.capable).toBe(false);
    expect(result.reasonCodes).toContain('THICKNESS_EXCEEDED');
  });

  it('fits a laser job within the real material-specific thickness limit and real bed', () => {
    const g = geometry({
      sheetThicknessMm: 4, materialGrade: 'SS304',
      flatPatternLengthMm: 1000, flatPatternWidthMm: 500,
    });
    const realCap = capability({ maxThicknessMm: 20, maxThicknessSsMm: 6, maxXMm: 4000, maxYMm: 2000 });
    const result = checkMachineCapability('fiber_laser', 'SM-LASER-4K', g, realCap);
    expect(result.capable).toBe(true);
    expect(result.confidence).toBe('high');
  });

  it('checks the real bed footprint rotation-aware, like machine-selection/selector.ts does', () => {
    const g = geometry({ sheetThicknessMm: 2, flatPatternLengthMm: 1900, flatPatternWidthMm: 900 });
    // Bed is 1000 x 2200 — the part (with 10% margin: 2090 x 990) only fits
    // when rotated 90 degrees on the bed, not as drawn.
    const realCap = capability({ maxThicknessMm: 10, maxXMm: 1000, maxYMm: 2200 });
    const result = checkMachineCapability('fiber_laser', 'SM-LASER-2K', g, realCap);
    expect(result.capable).toBe(true);
  });

  it('falls back to the static registry unchanged when no real capability is available', () => {
    const g = geometry();
    const result = checkMachineCapability('fiber_laser', 'SM-LASER-2K', g);
    expect(result.capable).toBe(true);
    expect(result.confidence).toBe('high');
  });

  // Identity + provenance: capabilitySource must come from the SAME candidate
  // realCapability was read off (see bom-items.service.ts's call sites — both
  // fields are read from one local `cand`/`candidate`, so they can never point
  // at two different machines). Confidence must reflect how real that data
  // actually is, not just "a realCapability object was passed at all" — a
  // class-wide default guess is not the same certainty as imported DB data,
  // even though both take this same code path.
  it('reports medium confidence (with a verify-against-plate caveat) when capability came from a name-matched seed guess, not real DB data', () => {
    const g = geometry({ sheetThicknessMm: 4 });
    const realCap = capability({ maxThicknessMm: 8, maxXMm: 3000, maxYMm: 1500 });
    const result = checkMachineCapability('fiber_laser', 'SM-LASER-2K', g, realCap, 'seed');
    expect(result.capable).toBe(true);
    expect(result.confidence).toBe('medium');
    expect(result.reasons.some((r) => r.includes('verify against machine plate'))).toBe(true);
  });

  it('reports low confidence (with a no-data caveat) when capability is only a conservative class-wide default', () => {
    const g = geometry({ sheetThicknessMm: 4 });
    const realCap = capability({ maxThicknessMm: 8, maxXMm: 3000, maxYMm: 1500 });
    const result = checkMachineCapability('fiber_laser', 'SM-LASER-2K', g, realCap, 'default_class');
    expect(result.capable).toBe(true);
    expect(result.confidence).toBe('low');
    expect(result.reasons.some((r) => r.includes('conservative class defaults'))).toBe(true);
  });

  it('reports high confidence for real imported DB data, distinct from a guess even when both pass the same geometry', () => {
    const g = geometry({ sheetThicknessMm: 4 });
    const realCap = capability({ maxThicknessMm: 8, maxXMm: 3000, maxYMm: 1500 });
    const result = checkMachineCapability('fiber_laser', 'SM-LASER-2K', g, realCap, 'imported');
    expect(result.capable).toBe(true);
    expect(result.confidence).toBe('high');
  });
});
