/**
 * plastic-reference.ts resolves the injection-molding reference values from
 * the staged memory/Plastic Modeling rows; checked against the real files
 * migration 823 stages.
 */
import { componentNameKey, resolvePlasticReference } from '../../../../../modules/bom-items/costing/plastic-molding/plastic-reference';
import { computeMoldToolingCost, toolingGapIds, toolingScopeWarning } from '../../../../../modules/bom-items/costing/plastic-molding/process/mold-tooling-engine';
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

describe('computeMoldToolingCost on the real tables (the lookups; the prices are the tooling calculator\'s)', () => {
  const COLD = { runner: 'cold' as const, classUsesInserts: false, cavityTexture: 'None', sideActionsPriced: false, ribInsertsPriced: false, steelTreatmentKnown: true };

  it('leaves the ejector pins to the calculator (their quantity "is calculated in the cost model"), not reported missing', () => {
    const r = computeMoldToolingCost({ moldBaseAreaMm2: 50_000, cavityCount: 1, undercutCount: 0, slideBundles: null, slideOrLifterBundles: 0, tables: REF.tooling, scope: COLD });
    expect(r.items.some((i) => i.componentName === 'Ejector Pin')).toBe(false);
    expect(r.missingComponents.join(' ')).not.toMatch(/Ejector Pin/);
    expect(REF.moldExtras).toMatchObject({
      areaPerEjectorPinMm2: 7903.21, ejectorPinUsd: 5, ejectorPinAssemblyHours: 0.25, sprueBushingUsd: 70, locatingRingUsd: 85,
      tryoutBaseHours: 12, tryouts: 3, cavityTexture: 'None',
      slideVolumeIn3: { small: 75, medium: 1100, large: 2000 }, lifterVolumeIn3: { small: 75, medium: 500, large: 1500 },
      cmmHoursPerSideAction: 1.52, cmmBaseHours: 5,
      waterLineDiameterMm: 8, waterHoseUsd: 1.25, waterFittingUsd: 2.5, waterManifoldUsd: 55, lineDrillingMmPerMin: 25.4,
    });
    expect(REF.toolroomRatesUsa.tryoutUsdPerHr).toBe(76.81);
    expect(REF.spiClasses.map((c) => [c.moldClass, c.useInsert])).toEqual([['Class105', false], ['Class104', false], ['Class103', false], ['Class102', true], ['Class101', true]]);
  });

  it('names only the gaps that apply to the mold: no hot drops on a cold runner, no inserts for a class built without, no texture for None', () => {
    expect(toolingGapIds(COLD)).toEqual(['G-03', 'G-04', 'G-06']);
    expect(toolingGapIds({ runner: 'hot', classUsesInserts: true, cavityTexture: 'Mold-Tech-A-11000 10.2um (400uin) depth', sideActionsPriced: false, ribInsertsPriced: false, steelTreatmentKnown: true })).toEqual(['G-03', 'G-04', 'G-05', 'G-06', 'G-07', 'G-08']);
    // every bundle recognised and sized: the slides and lifters are priced (F-28), not a gap
    expect(toolingGapIds({ ...COLD, sideActionsPriced: true })).toEqual(['G-04', 'G-06']);
    // every rib measured and classed: the rib inserts are priced (F-31), not a gap
    expect(toolingGapIds({ ...COLD, sideActionsPriced: true, ribInsertsPriced: true })).toEqual(['G-06']);
    expect(toolingScopeWarning({ ...COLD, sideActionsPriced: true, ribInsertsPriced: true })).toMatch(/try-out, the slide and lifter blocks, the heat treatment the tool steel grade needs, the cooling lines, the rib inserts and their EDM, and the toolroom hours; it does NOT include water baffles/);
    const w = toolingScopeWarning(COLD);
    expect(w).toMatch(/includes .*the cavity and core machining and polish.*ejector pins, sprue bushing, locating ring, try-out/);
    expect(w).toMatch(/does NOT include slides and lifters \(the CAD bundles are not all recognised and sized\), the rib inserts and their EDM \(the CAD ribs are not all measured, or one is too large for an insert class\), water baffles \(no count on file\) \(/);
    expect(toolingScopeWarning({ runner: 'hot', classUsesInserts: true, cavityTexture: 'None', sideActionsPriced: false, ribInsertsPriced: false, steelTreatmentKnown: true })).toMatch(/the hot-runner manifold and controller \(no price on file\), cavity inserts/);
  });

  it('counts Guide Pin at its real 0.25 h and says Guide Bush has no assembly time', () => {
    const r = computeMoldToolingCost({ moldBaseAreaMm2: 50_000, cavityCount: 1, undercutCount: 0, slideBundles: null, slideOrLifterBundles: 0, tables: REF.tooling, scope: COLD });
    // Air Poppet 30x0.006 + Ejector Guide Pin Bushing 6x2 + Guide Pin 4x0.25 + Limit Switch 4x1 + Return Pin 6x1
    expect(r.estimatedAssemblyHrs).toBeCloseTo(30 * 0.006 + 6 * 2 + 4 * 0.25 + 4 * 1 + 6 * 1, 6);
    expect(r.warnings.some((w) => w.includes('No assembly time on file') && w.includes('Guide Bush'))).toBe(true);
    // Side-action hardware only with an undercut.
    expect(r.items.some((i) => i.componentName === 'Hydraulic Cylinder')).toBe(false);
  });

  it('reads the reference USA toolroom rates the tooling calculator prices the hours at', () => {
    expect(REF.toolroomRatesUsa).toEqual({ designUsdPerHr: 64.73, machiningUsdPerHr: 100.55, assemblyUsdPerHr: 76.81, tryoutUsdPerHr: 76.81, heatTreatUsdPerKg: 2.11, stressReliefUsdPerKg: 2.11, edmUsdPerHr: 74.3 });
    expect(REF.moldExtras.hotDrop).toEqual({ type: 'Standard', usd: 3750 });
  });
});

describe('tool life (tblToolLife)', () => {
  it('reads shots per tool by material type, with the reference default for other types', () => {
    expect(REF.toolLifeShotsByType.find((t) => t.materialType === 'ABS')?.shots).toBe(144_000);
    expect(REF.defaultToolLifeShots).toBe(260_000);
  });
});
