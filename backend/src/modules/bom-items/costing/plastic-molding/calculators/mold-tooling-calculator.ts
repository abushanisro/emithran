/**
 * The injection mold tooling cost, by its stored calculator (plastic-molding-calculators.json "Injection Mold - Tooling", migration 1012). The engine
 * supplies what the staged reference says for this mold (mold-tooling-engine.ts: which components, their subtotal, the design and assembly hours) and
 * the scenario; every price, hour and amortization step is a formula of the calculator, shown on the line and changeable for a part.
 */
import type { CalculationTraceStep } from '../../../dto/cost-breakdown.dto';
import { runReferenceCalculator, type CalcSeed, type ReferenceCalculators } from '../../shared/calculators/reference-calculator';
import type { MoldBaseReference, MoldExtrasReference, MoldToolingTables, ToolroomRates } from '../plastic-reference';
import type { MoldBaseChoice } from '../process/mold-base';
import type { MoldCavityLookup } from '../process/mold-cavity';
import type { BlockSize, SideActionSignals } from '../side-action-signals';
import { calculatorFingerprint, requirePlasticCalculator, withRegistryFormulas } from './plastic-cycle-time';

export const MOLD_TOOLING_CALCULATOR = 'Injection Mold - Tooling';
const OUTPUT = 'Tooling Cost Per Part';
const REF = 'memory/Plastic Modeling';
// Formula registry (plastic-molding/formula-registry.ts): F-27 (assembly extras), F-28 (slide and lifter blocks), F-29 (heat treatment), F-30 (cooling) are this
// calculator's formulas; the seeds below supply their inputs.
/** timePerTryoutBase's note: "basic hrs per tryout for <500T (x2 for bigger)". */
const TRYOUT_DOUBLE_ABOVE_TONNES = 500;
/** The approved cooling rule (F-30): water lines 3 line diameters apart. No pitch is on file; the input shows it and a part can change it. */
const WATER_LINE_PITCH_FACTOR = 3;

export interface MoldToolingFacts {
  /** The standard components the mold needs, priced (mold-tooling-engine.ts). */
  components: ReadonlyArray<{ componentName: string; qty: number; unitCostUsd: number }>;
  componentsSubtotalUsd: number;
  moldBaseAreaMm2: number;
  designHours: number;
  assemblyHours: number;
  tables: MoldToolingTables;
  /** The quote location's toolroom rates; null when memory/ holds none for it (USA only). */
  toolroomRates: ToolroomRates | null;
  location: string;
  annualVolume: number;
  productionLifeYears: number;
  cavityCount: number;
  toolLifeShots: number;
  /** Where the tool life came from: the tblToolLife row of the material type, or the reference default. */
  toolLifeSource: string;
  /** The standard mold base chosen for the part (mold-base.ts), or what is missing to choose one. */
  moldBase: MoldBaseChoice | { missing: string[] };
  moldBaseRef: MoldBaseReference;
  /** The part's height along the pull (the bounding box's smallest side), mm. */
  partHeightMm: number | null;
  /** The cavity machining rate for the part's complexity and size (mold-cavity.ts), or what is missing to choose it. */
  cavity: MoldCavityLookup | { missing: string[] };
  partSurfaceAreaMm2: number | null;
  /** The ejector pins, sprue bushing, locating ring and try-out (F-27). */
  extras: MoldExtrasReference;
  /** The press the part runs on (t): the try-out hours double above 500 t. Null when no press is chosen. */
  pressClampTonnes: number | null;
  /** The recognised slide and lifter bundles by size class (side-action-signals.ts); null when the CAD features were not recognised. */
  sideActionBlocks: SideActionSignals['blocks'] | null;
}

const SIZE_ORDER: readonly BlockSize[] = ['small', 'medium', 'large'];

/**
 * The slide and lifter blocks the mold needs (F-28): their volume by size class, and their surface as cubes of that volume (6 x V^(2/3)). Unsized
 * bundles and an unrecognised part add nothing; the scope warning names them (mold-tooling-engine.ts).
 */
export function sideActionBlocks(blocks: SideActionSignals['blocks'] | null, x: MoldExtrasReference) {
  const list: Array<{ kind: 'slide' | 'lifter'; size: BlockSize; volumeIn3: number }> = [];
  for (const kind of ['slide', 'lifter'] as const) {
    const volumes = kind === 'slide' ? x.slideVolumeIn3 : x.lifterVolumeIn3;
    for (const size of SIZE_ORDER) for (let i = 0; i < (blocks?.[kind][size] ?? 0); i++) list.push({ kind, size, volumeIn3: volumes[size] });
  }
  const volume = (kind: 'slide' | 'lifter') => list.filter((b) => b.kind === kind).reduce((t, b) => t + b.volumeIn3, 0);
  const describe = (kind: 'slide' | 'lifter') => SIZE_ORDER
    .map((size) => [size, list.filter((b) => b.kind === kind && b.size === size).length] as const)
    .filter(([, n]) => n > 0)
    .map(([size, n]) => `${n} ${size} x ${(kind === 'slide' ? x.slideVolumeIn3 : x.lifterVolumeIn3)[size]} in³ (${size}${kind === 'slide' ? 'Slide' : 'Lifter'}Volume)`)
    .join(' + ');
  return {
    count: list.length,
    slideVolumeIn3: volume('slide'),
    lifterVolumeIn3: volume('lifter'),
    surfaceIn2: list.reduce((t, b) => t + 6 * b.volumeIn3 ** (2 / 3), 0),
    slideSource: describe('slide') || 'no slide bundles recognised',
    lifterSource: describe('lifter') || 'no lifter bundles recognised',
  };
}

export type MoldToolingRun =
  | { derivable: true; outputs: Record<string, number>; perPartUsd: number; trace: CalculationTraceStep[]; calculator: { id: string | null; version: number | null; name: string; fingerprint: string } }
  | { derivable: false; missing: string[]; calculatorProblem?: string };

/** The calculator's inputs from the facts, or what is missing. Nothing is defaulted: a location without toolroom rates is a named gap. */
export function moldToolingSeeds(f: MoldToolingFacts): { seeds: Record<string, CalcSeed> } | { missing: string[] } {
  const missing: string[] = [];
  if (!f.toolroomRates) missing.push(`toolroom rates for ${f.location} (memory/ holds digital_factory_settings_usa only)`);
  if ('missing' in f.moldBase) missing.push(...f.moldBase.missing.map((m) => `mold base: ${m}`));
  if (!(f.partHeightMm != null && f.partHeightMm > 0)) missing.push('the part height (CAD bounding box)');
  if ('missing' in f.cavity) missing.push(...f.cavity.missing.map((m) => `cavity: ${m}`));
  if (!(f.pressClampTonnes != null && f.pressClampTonnes > 0)) missing.push('the press force (the try-out hours depend on it)');
  if (missing.length > 0 || !f.toolroomRates || 'missing' in f.moldBase || 'missing' in f.cavity) return { missing };
  const cav = f.cavity;
  const b = f.moldBase;
  const mb = f.moldBaseRef;
  const x = f.extras;
  const sa = sideActionBlocks(f.sideActionBlocks, x);
  const vars = `${REF}/variables`;
  const steel = `${REF}/process/digital_factory_tool_materials_usa: ${mb.steel.name} (digital_factory_settings_usa defaultToolMaterialName)`;
  const listed = f.components.map((c) => `${c.componentName} ${c.qty} x ${c.unitCostUsd}`).join(', ');
  const settings = `${REF}/process/digital_factory_settings_usa: Default`;
  return {
    seeds: {
      'Purchased Components Cost': { value: f.componentsSubtotalUsd, source: `${REF}/lookup/cmStandardToolingComponents: ${listed || 'none'}`, lookup: true },
      'Mold Base Area': { value: f.moldBaseAreaMm2, source: `CAD projected area x ${f.cavityCount} cavit${f.cavityCount === 1 ? 'y' : 'ies'} (the required mold window)` },
      'Design Hours': { value: f.designHours, source: `${REF}/lookup/cmMoldBaseDesignHours: the first row covering ${Math.round(f.moldBaseAreaMm2)} mm²`, lookup: true },
      'Plate Machining Rate': { value: f.tables.plateMachiningRateM2PerHr, source: `${REF}/lookup/cmToolMachiningRates: Cavity Core Plate General Machining`, lookup: true },
      'Plate Setup Hours': { value: f.tables.cavityPlateSetupHr + f.tables.corePlateSetupHr, source: `${REF}/lookup/cmToolMachiningSetups: cavity ${f.tables.cavityPlateSetupHr} h + core ${f.tables.corePlateSetupHr} h`, lookup: true },
      'Assembly Hours': { value: f.assemblyHours, source: `${REF}/lookup/cmToolAssemblyTimes: hours per component x its quantity`, lookup: true },
      'Design Rate': { value: f.toolroomRates.designUsdPerHr, source: `${settings} designRateUsdPerHr` },
      'Machining Rate': { value: f.toolroomRates.machiningUsdPerHr, source: `${settings} machiningRateUsdPerHr` },
      'Assembly Rate': { value: f.toolroomRates.assemblyUsdPerHr, source: `${settings} assemblyRateUsdPerHr` },
      'Annual Volume': { value: f.annualVolume, source: 'Scenario: annual volume' },
      'Production Life': { value: f.productionLifeYears, source: 'Scenario: production life (years)' },
      'Cavities per Mold': { value: f.cavityCount, source: 'The costed cavity count' },
      'Tool Life Shots': { value: f.toolLifeShots, source: f.toolLifeSource, lookup: true },
      'Mold Base Width': {
        value: b.base.widthMm, lookup: true,
        source: `${REF}/lookup/tblStandardMoldBaseSizes: ${b.base.name} (${mb.system}), the smallest holding ${Math.round(b.requiredWidthMm)} x ${Math.round(b.requiredLengthMm)} mm: `
          + `${b.layout.widthWise} x ${b.layout.lengthWise} cavities (layoutNumCav) with ${mb.betweenPartsMm} mm between parts, edge borders ${b.edgeBorderXMm} / ${b.edgeBorderYMm} mm (tblEdgeMoldBorderX/Y)`,
      },
      'Mold Base Length': { value: b.base.lengthMm, source: `${REF}/lookup/tblStandardMoldBaseSizes: ${b.base.name}`, lookup: true },
      'Part Height': { value: f.partHeightMm!, source: 'CAD bounding box: the smallest side, along the pull direction' },
      'A Plate Cavity Ratio': { value: mb.aPlateCavityRatio, source: `${vars}: aPlateFlatCavityRatio` },
      'Cavity Plate Depth Border': { value: b.cavityDepthBorderMm, source: `${REF}/lookup/tblCavityPlateDepthBorder: by the press force (inches, in mm)`, lookup: true },
      'Core Plate Depth Border': { value: b.coreDepthBorderMm, source: `${REF}/lookup/tblCorePlateDepthBorder: by the press force (inches, in mm)`, lookup: true },
      'A Plate Min Thickness': { value: mb.aPlateMinMm, source: `${vars}: aPlateMinThickness` },
      'B Plate Min Thickness': { value: mb.bPlateMinMm, source: `${vars}: bPlateMinThickness` },
      'Top Clamp Plate Thickness': { value: mb.topClampMm, source: `${vars}: topClampPlateThickness` },
      'Support Plate Thickness': { value: mb.supportPlateMm, source: `${vars}: supportPlateThickness` },
      'Bottom Clamp Plate Thickness': { value: mb.bottomClampMm, source: `${vars}: bottomClampPlateThickness` },
      'Tool Steel Density': { value: mb.steel.densityKgM3, source: `${steel}: densityKgPerM3`, lookup: true },
      'Tool Steel Price': { value: mb.steel.priceUsdPerKg, source: `${steel}: materialCostUsdPerKg`, lookup: true },
      'Mold Base Cost Factor': { value: mb.steel.moldBaseCostFactor, source: `${steel}: moldBaseCostFactor`, lookup: true },
      'Part Surface Area': { value: f.partSurfaceAreaMm2!, source: 'CAD part surface area' },
      'Cavity Machining Hours Per Sq In': {
        value: cav.hoursPerSqIn, lookup: true,
        source: `${REF}/lookup/tblHrsPerSqInch${cav.complexity}: the row up to ${cav.rowUpToSqIn} in² (${cav.complexity}: ${cav.faceCount} CAD faces against `
          + `cmMoldSurfaceCountThreshold ${mb.complexityFaceThresholds.simple} / ${mb.complexityFaceThresholds.average}, borrowed from compression molding)`,
      },
      'Polish Hours Per Sq Meter': { value: mb.finish.hoursPerSqM, source: `${REF}/lookup/SPIFinishes: ${mb.finish.name} (defaultCavityFinishIM)`, lookup: true },
      'Area Per Ejector Pin': { value: x.areaPerEjectorPinMm2, source: `${vars}: areaCoveredPerEjectorPin` },
      'Ejector Pin Cost': { value: x.ejectorPinUsd, source: `${REF}/lookup/cmStandardToolingComponents: Ejector Pin (its quantity "is calculated in the cost model")`, lookup: true },
      'Ejector Pin Assembly Hours': { value: x.ejectorPinAssemblyHours, source: `${REF}/lookup/cmToolAssemblyTimes: Ejector Pin`, lookup: true },
      'Sprue Bushing Cost': { value: x.sprueBushingUsd, source: `${vars}: sprueBushingCost (one per mold)` },
      'Locating Ring Cost': { value: x.locatingRingUsd, source: `${vars}: locatingRingsCost (one per mold)` },
      'Tryout Base Hours': { value: x.tryoutBaseHours, source: `${vars}: timePerTryoutBase` },
      'Tryout Press Multiplier': {
        value: f.pressClampTonnes! > TRYOUT_DOUBLE_ABOVE_TONNES ? 2 : 1,
        source: `${vars}: timePerTryoutBase note "<500T (x2 for bigger)": the press is ${Math.round(f.pressClampTonnes!)} t`,
      },
      'Number of Tryouts': { value: x.tryouts, source: `${vars}: defaultNumTryOuts` },
      'Tryout Rate': { value: f.toolroomRates.tryoutUsdPerHr, source: `${settings} tryoutRateUsdPerHr` },
      'Slide Block Volume': { value: sa.slideVolumeIn3, source: `CAD slide bundles: ${sa.slideSource}`, lookup: true },
      'Lifter Block Volume': { value: sa.lifterVolumeIn3, source: `CAD lifter bundles (a bundle a slide could also serve is costed as a lifter): ${sa.lifterSource}`, lookup: true },
      'Side Action Block Surface': { value: sa.surfaceIn2, source: `each of the ${sa.count} block${sa.count === 1 ? '' : 's'} as a cube of its volume, 6 x V^(2/3) in², summed` },
      'Side Actions': { value: sa.count, source: f.sideActionBlocks ? 'CAD: the recognised slide and lifter bundles with a size class' : 'CAD features not recognised: no bundles to price' },
      'CMM Hours Per Side Action': { value: x.cmmHoursPerSideAction, source: `${vars}: cmmInspectionMultiplier` },
      'CMM Base Hours': { value: x.cmmBaseHours, source: `${vars}: cmmInspectionAdder` },
      'Heat Treat Rate': { value: f.toolroomRates.heatTreatUsdPerKg, source: `${settings} heatTreatRateUsdPerKg (the cavity and core plates and the slide and lifter blocks)` },
      'Stress Relief Rate': { value: f.toolroomRates.stressReliefUsdPerKg, source: `${settings} stressReliefRateUsdPerKg (the clamp and support plates)` },
      'Water Line Diameter': { value: x.waterLineDiameterMm, source: `${vars}: defaultWaterLineDiameter` },
      'Water Line Pitch Factor': { value: WATER_LINE_PITCH_FACTOR, source: 'Approved rule: lines 3 line diameters apart across the cavity plate (no pitch is on file)' },
      'Line Drilling Rate': { value: x.lineDrillingMmPerMin, source: `${REF}/lookup/cmToolMachiningRates: Heater Line Drilling (the only line drilling rate on file)`, lookup: true },
      'Water Hose Cost': { value: x.waterHoseUsd, source: `${vars}: waterHosesCost (2 per line)` },
      'Water Fitting Cost': { value: x.waterFittingUsd, source: `${vars}: waterManifoldFittingsCost (2 per line)` },
      'Water Manifold Cost': { value: x.waterManifoldUsd, source: `${vars}: waterManifoldsCost (one per side)` },
    },
  };
}

/** The mold tooling cost by the stored calculator, or what is missing (an input, or the calculator itself). */
export function runMoldTooling(f: MoldToolingFacts, calculators: ReferenceCalculators | null | undefined): MoldToolingRun {
  const seeded = moldToolingSeeds(f);
  if ('missing' in seeded) return { derivable: false, missing: seeded.missing };
  const found = requirePlasticCalculator(calculators, MOLD_TOOLING_CALCULATOR);
  if ('problem' in found) return { derivable: false, missing: [found.problem], calculatorProblem: found.problem };
  const run = runReferenceCalculator(calculators, MOLD_TOOLING_CALCULATOR, seeded.seeds, OUTPUT);
  if (run.missing.length > 0 || run.value == null) return { derivable: false, missing: run.missing.length > 0 ? run.missing : [`${MOLD_TOOLING_CALCULATOR} produced no ${OUTPUT.toLowerCase()}`] };
  return {
    derivable: true, outputs: run.outputs, perPartUsd: run.value, trace: withRegistryFormulas(run.trace, MOLD_TOOLING_CALCULATOR),
    calculator: { id: run.calculatorId, version: run.calculatorVersion, name: MOLD_TOOLING_CALCULATOR, fingerprint: calculatorFingerprint(found.def) },
  };
}
