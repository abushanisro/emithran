import { checkMachineCapability } from './machine-capability';
import type { PartGeometryForCapability } from './machine-capability';

function geometry(overrides: Partial<PartGeometryForCapability> = {}): PartGeometryForCapability {
  return {
    sheetThicknessMm: 3,
    flatPatternLengthMm: 500,
    flatPatternWidthMm: 300,
    ...overrides,
  };
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
