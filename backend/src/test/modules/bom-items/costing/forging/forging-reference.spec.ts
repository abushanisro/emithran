import { loadReference, material, referenceRows } from './forging-fixtures';
import {
  FORGING_REFERENCE_SOURCE_VERSION,
  resolveForgingReference,
} from '../../../../../modules/bom-items/costing/forging/forging-reference';

describe('forging reference (memory/Forging, migration 823)', () => {
  it('reads the manifest source version the staged rows carry', () => {
    expect(FORGING_REFERENCE_SOURCE_VERSION).toBe('2026-Forging');
  });

  it('resolves every variable, switch and lookup Phase 1 reads, with the staged values', () => {
    const ref = loadReference();
    // Values as in memory/Forging/forging_variables.csv and migration 823.
    expect(ref.variables.bandSawKerfWidth).toBe(3.175); // mm (1/8 in)
    expect(ref.variables.scaleLossAllowancePercentage).toBe(3);
    expect(ref.variables.scaleLossAllowancePercentageInductionHeating).toBe(1);
    expect(ref.variables.minBilletRatio).toBe(0.3);
    expect(ref.variables.maxBilletRatio).toBe(3.5);
    expect(ref.variables.inductionHeatMaxStockWidth).toBe(101.6); // mm
    expect(ref.variables.inductionHeatMinMultRatio).toBe(2);
    expect(ref.variables.pressToolLifeNumberOfParts).toBe(7500);
    expect(ref.variables.trimToolLifeNumberOfParts).toBe(7500);
    expect(ref.switches.enableScrapMaterialCredit).toBe(false);
    expect(ref.switches.disableInvestmentAmortization).toBe(false);
    // forging_partComplexityBasedData: no flash up to complexity 3, then 12 .. 40 %.
    expect([1, 2, 3, 4, 6, 7, 12].map((s) => ref.flashPctByComplexity.get(s))).toEqual([0, 0, 0, 12, 20, 21, 40]);
    expect(ref.roundBarSizesMm).toHaveLength(31);
    expect(ref.roundBarSizesMm[0]).toBe(6.35);
    expect(ref.toolCoatingFactor.get('None')).toBe(1);
    expect(ref.toolCoatingFactor.get('PVD TiN')).toBe(7.2);
  });

  it('names every missing variable and lookup instead of substituting one', () => {
    const rows = referenceRows();
    const r = resolveForgingReference({
      variables: rows.variables.filter((v) => v.key !== 'bandSawKerfWidth' && v.key !== 'enableScrapMaterialCredit'),
      lookups: { ...rows.lookups, forging_roundBarSizes: [] },
    });
    expect(r.reference).toBeNull();
    expect(r.missing).toEqual(['variables bandSawKerfWidth', 'variables enableScrapMaterialCredit', 'forging_roundBarSizes']);
  });

  it('reads a Forging material as migration 855 promotes it', () => {
    const m = material('Steel, Hot Worked, AISI 1045');
    expect(m).toEqual({
      name: 'Steel, Hot Worked, AISI 1045', materialType: 'Steel', densityKgM3: 7850,
      roundBarUsdPerKg: 1.479, cutCode: 1.2, forgingTempC: 1148,
    });
  });
});
