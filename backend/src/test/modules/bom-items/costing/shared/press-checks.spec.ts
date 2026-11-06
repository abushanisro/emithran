import { checkPress, estimatedToolHeightMm, SHOT_NOT_DERIVABLE_REASON, type PressCapability, type PressNeeds } from '../../../../../modules/bom-items/costing/shared/capability/machine-selection/press-checks';
import { isCapable } from '../../../../../modules/bom-items/costing/shared/capability/machine-selection/selector';
import { injectionMoldingRequirement } from '../../../../../modules/bom-items/costing/shared/capability/machine-selection/physics';
import { evaluateIMCandidate } from '../../../../../modules/bom-items/costing/plastic-molding/machine/machine-selector-im';
import { requiredClampForce } from '../../../../../modules/bom-items/costing/plastic-molding/clamp-force';
import { shotGppsGramsPerCavity, shotWeightKgPerPart } from '../../../../../modules/bom-items/costing/plastic-molding/shot-size';
import type { MachineCandidate } from '../../../../../modules/bom-items/dto/machine-selection.dto';
import { allRealPresses, realMaterialClamp, realPlasticReference, realResinInputs } from '../plastic-molding/real-plastic-reference';

const press: PressCapability = { maxTonnage: 150, shotCapacityGrams: 100, tieBarXMm: 500, tieBarYMm: 400, minMoldHeightMm: 200, maxMoldHeightMm: 600 };
const need: PressNeeds = { clampTonnageRequired: 100, clampNotDerivableReason: null, shotGppsG: 60, partLengthMm: 200, partWidthMm: 100, estimatedToolHeightMm: 300 };

describe('checkPress: the one rule for whether a press can run a part', () => {
  it('a press that meets all four checks is capable, and says how much of it the part uses', () => {
    const r = checkPress(press, need);
    expect(r.capable).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(r.clampUtil).toBeCloseTo(100 / 150, 9);
    expect(r.shotUtil).toBeCloseTo(0.6, 9);
  });

  it.each([
    ['clamp too small', { ...need, clampTonnageRequired: 151 }, 'Clamp: need 151T, machine has 150T'],
    ['shot too small', { ...need, shotGppsG: 101 }, 'Shot: need 101g, machine has 100g'],
    ['part too long for the tie-bars (either orientation)', { ...need, partLengthMm: 460 }, 'Tie-bar: part + runner 505×145mm exceeds machine 500×400mm'],
    ['tool shorter than the press minimum', { ...need, estimatedToolHeightMm: 150 }, 'Daylight: tool 150mm < machine min 200mm'],
    ['tool taller than the press maximum', { ...need, estimatedToolHeightMm: 650 }, 'Daylight: tool 650mm > machine max 600mm'],
  ])('%s: not capable, with the reason', (_name, n, reason) => {
    const r = checkPress(press, n);
    expect(r.capable).toBe(false);
    expect(r.reasons).toEqual([reason]);
  });

  it('the mold may be turned 90 degrees on the platen', () => {
    expect(checkPress({ ...press, tieBarXMm: 300, tieBarYMm: 600 }, { ...need, partLengthMm: 500, partWidthMm: 200 }).capable).toBe(true);
  });

  it('a need that cannot be derived is not capable: nothing is passed unchecked', () => {
    expect(checkPress(press, { ...need, clampTonnageRequired: null, clampNotDerivableReason: 'Clamp force not derivable: no reference.' }).reasons).toEqual(['Clamp force not derivable: no reference.']);
    expect(checkPress(press, { ...need, shotGppsG: null }).reasons).toEqual([SHOT_NOT_DERIVABLE_REASON]);
  });

  it('a press value that is not on file is not capable where the rule needs it; a skipped check (no tool height, no tie-bars, no footprint) is not a failure', () => {
    expect(checkPress({ ...press, maxTonnage: null }, need).capable).toBe(false);
    expect(checkPress({ ...press, shotCapacityGrams: null }, need).reasons).toEqual(['Shot: the press has no shot size on file.']);
    expect(checkPress(press, { ...need, estimatedToolHeightMm: null }).capable).toBe(true);
    expect(checkPress({ ...press, tieBarXMm: null }, need).capable).toBe(true);
    expect(checkPress(press, { ...need, partLengthMm: null }).capable).toBe(true);
  });

  it('the tool height is the longest side plus the tooling allowance, and unknown when the part is', () => {
    expect(estimatedToolHeightMm(170.5)).toBe(270.5);
    expect(estimatedToolHeightMm(0)).toBeNull();
  });
});

// The Cost Summary picks its press with the shared selector (isCapable) and the Route Comparison with the plastic tier evaluator: for every real press and
// a range of parts they must agree, which is the point of having one rule.
describe('the Cost Summary selector and the Route Comparison evaluator agree on every real press', () => {
  const REF = realPlasticReference();
  const CLAMP = realMaterialClamp('Nylon, Type 66');
  const RESIN = realResinInputs('Nylon, Type 66');
  // A synthetic daylight window per press so the tool-height check is exercised too (the staged presses carry none in this fixture).
  const pool: MachineCandidate[] = allRealPresses().map((p, i) => ({
    machineId: p.name, machineName: p.name, machineClass: 'injection_molding', hourlyRate: p.mhrUsd, availabilityStatus: 'available',
    capability: { maxTonnage: p.maxTonnage, shotCapacityGrams: p.shotCapacityGrams, tieBarXMm: p.tieBarXMm, tieBarYMm: p.tieBarYMm, minMoldHeightMm: 100 + (i % 5) * 25, maxMoldHeightMm: 500 + (i % 7) * 100 },
  } as unknown as MachineCandidate));
  const parts = [
    { lengthMm: 40, widthMm: 30, volumeMm3: 2_000 }, { lengthMm: 120, widthMm: 80, volumeMm3: 45_000 }, { lengthMm: 170.5, widthMm: 93.6, volumeMm3: 18_674 },
    { lengthMm: 400, widthMm: 250, volumeMm3: 600_000 }, { lengthMm: 900, widthMm: 500, volumeMm3: 4_000_000 },
  ];

  it.each(parts)('part %#: same verdict from both for all presses', (p) => {
    const area = p.lengthMm * p.widthMm;
    const shotG = shotGppsGramsPerCavity({ shotWeightKg: shotWeightKgPerPart((p.volumeMm3 / 1e9) * 1346, 'cold'), meltDensityKgM3: RESIN.densityOfMeltKgM3, reference: REF });
    const clamp = requiredClampForce({ model: REF.clampModel, material: CLAMP, materialLabel: 'PA66', projectedAreaMm2: area, cavityCount: 1, runner: 'cold' });
    const requirement = injectionMoldingRequirement({
      projectedAreaMm2: area, clampTonnageRequired: clamp.derivable ? clamp.requiredTonnes : null, clampNotDerivableReason: clamp.derivable ? null : clamp.reason,
      shotGppsG: shotG, partLengthMm: p.lengthMm, partWidthMm: p.widthMm, estimatedToolHeightMm: estimatedToolHeightMm(p.lengthMm),
    });
    let capableCount = 0;
    for (const m of pool) {
      const tier = evaluateIMCandidate(m, {
        projectedAreaMm2: area, cavityCount: 1, shotGppsGPerCavity: shotG, material: CLAMP, materialLabel: 'PA66', runner: 'cold',
        partLengthMm: p.lengthMm, partWidthMm: p.widthMm, partHeightMm: 30, estimatedToolHeightMm: estimatedToolHeightMm(p.lengthMm), clampModel: REF.clampModel,
      });
      expect(isCapable(m, requirement)).toBe(tier.capable);
      expect(tier.blockReasons.length === 0).toBe(tier.capable);
      if (tier.capable) capableCount += 1;
    }
    // The grid is not vacuous: the small parts have capable presses and the largest has none.
    if (p.volumeMm3 <= 600_000) expect(capableCount).toBeGreaterThan(0);
  });
});
