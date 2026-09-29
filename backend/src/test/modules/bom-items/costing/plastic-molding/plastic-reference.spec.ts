/**
 * plastic-reference.ts resolves the injection-molding reference values from
 * the staged memory/Plastic Modeling rows; checked against the real files
 * migration 823 stages.
 */
import { componentNameKey, resolvePlasticReference } from '../../../../../modules/bom-items/costing/plastic-molding/plastic-reference';
import { computeMoldToolingCost } from '../../../../../modules/bom-items/costing/plastic-molding/process/mold-tooling-engine';
import { realPlasticReference } from './real-plastic-reference';

const REF = realPlasticReference();

describe('resolvePlasticReference', () => {
  it('reads the safety factors and SPI classes from the real files', () => {
    expect(REF.clampForceSafetyFactor).toBe(1.1);   // variables clampForceSafetyFactor
    expect(REF.shotSizeSafetyFactor).toBe(1.02);    // variables shotSizeSafetyFactor
    expect(REF.spiClasses.map((c) => [c.moldClass, c.cycleRating])).toEqual([
      ['Class105', 5_000], ['Class104', 100_000], ['Class103', 500_000], ['Class102', 1_000_000], ['Class101', 9_999_999_999],
    ]);
    expect(REF.tooling.plateMachiningRateM2PerHr).toBe(0.32);
    expect(REF.tooling.cavityPlateSetupHr).toBe(2);  // 2 setups x 1 hr
    expect(REF.tooling.corePlateSetupHr).toBe(2);
  });

  it('matches component names across tables by one spelling rule, never a hand map', () => {
    expect(componentNameKey('Side Lock')).toBe(componentNameKey('Side Locks'));
    expect(componentNameKey('Ejector Guide Pin Bushing')).toBe(componentNameKey('Ejector Guide Pin And Bushing'));
    expect(componentNameKey('Electrical Connection Or Switch')).toBe(componentNameKey('Electrical Connections Or Switches'));
    expect(componentNameKey('Return Pin And Shoulder Bushing')).toBe(componentNameKey('Return Pins And Shoulder Bushings'));
    expect(componentNameKey('Guide Bush')).not.toBe(componentNameKey('Guide Pin'));
  });

  it('returns no reference and names each absent value', () => {
    const { reference, missing } = resolvePlasticReference({ variables: [], lookups: {} });
    expect(reference).toBeNull();
    expect(missing).toContain('variables: clampForceSafetyFactor');
    expect(missing).toContain('tblSpiType (not staged)');
  });
});

describe('computeMoldToolingCost on the real tables', () => {
  it('counts Guide Pin at its real 0.25 h and says Guide Bush has no assembly time', () => {
    const r = computeMoldToolingCost({ moldBaseAreaMm2: 50_000, cavityCount: 1, undercutCount: 0, tables: REF.tooling, toolroomRates: null, location: 'India' });
    // Air Poppet 30x0.006 + Ejector Guide Pin Bushing 6x2 + Guide Pin 4x0.25 + Limit Switch 4x1 + Return Pin 6x1
    expect(r.estimatedAssemblyHrs).toBeCloseTo(30 * 0.006 + 6 * 2 + 4 * 0.25 + 4 * 1 + 6 * 1, 6);
    expect(r.warnings.some((w) => w.includes('No assembly time on file') && w.includes('Guide Bush'))).toBe(true);
    // Side-action hardware only with an undercut.
    expect(r.items.some((i) => i.componentName === 'Hydraulic Cylinder')).toBe(false);
    // No toolroom rate for India in memory/: hours reported, not priced.
    expect(r.labourCostUsd).toBeNull();
    expect(r.warnings.some((w) => w.includes('NOT priced') && w.includes('India'))).toBe(true);
  });

  it('prices the hours at the reference USA toolroom rates', () => {
    const r = computeMoldToolingCost({ moldBaseAreaMm2: 50_000, cavityCount: 1, undercutCount: 0, tables: REF.tooling, toolroomRates: REF.toolroomRatesUsa, location: 'USA' });
    expect(REF.toolroomRatesUsa).toEqual({ designUsdPerHr: 64.73, machiningUsdPerHr: 100.55, assemblyUsdPerHr: 76.81 });
    expect(r.labourCostUsd).toBeCloseTo(
      r.estimatedDesignHrs * 64.73 + r.estimatedMachiningHrs * 100.55 + r.estimatedAssemblyHrs * 76.81, 6);
  });
});

describe('tool life (tblToolLife)', () => {
  it('reads shots per tool by material type, with the reference default for other types', () => {
    expect(REF.toolLifeShotsByType.find((t) => t.materialType === 'ABS')?.shots).toBe(144_000);
    expect(REF.defaultToolLifeShots).toBe(260_000);
  });
});
