// Plastic Molding reference data the injection-molding engines read, resolved
// from the staged rows of memory/Plastic Modeling (machining_reference_data,
// source_version '2026-Plastic', migration 823). Pure: the caller loads the
// rows (PlasticReferenceService); nothing here holds a reference value.
//
//   variables  clampForceSafetyFactor   margin on required clamp force
//              shotSizeSafetyFactor     margin on required shot size
//              flowRatioThreshold{Easy,Medium}Flow, minimumPercentClampForce
//              {Easy,Medium,Hard}Flow, {conventional,hot}RunnerMaxPressure-
//              ReductionFactor, minInjectionPressure   the clamp-force model
//              (clamp-force.ts)
//              cycleTimeAdjustmentFactor, defaultMoldTemperatureIncrease,
//              defaultRunnerSystem       the cycle-time model (cycle-time.ts)
//   injectionTimeAdjustmentFactors      fill-time factors by cavities per mold / gates per cavity
//   layoutNumCav                        the cavity counts a mold layout exists for
//   material "Polystyrene"              GPPS: press shot size is rated in GPPS grams. The
//                                       reference row at the reference GPPSMeltTemperature
//                                       (230 C) is the GPPS identity; its melt density
//                                       converts a press's GPPS grams to melt volume.
//   tblSpiType                          SPI mold classes 101-105 (Num Annual Mold Cycles)
//   cmStandardToolingComponents         purchased mold components: unit cost, quantity
//   cmToolAssemblyTimes                 assembly hours per component
//   cmToolAssemblyNumOperators          operators by mold-base area (m2, bracket upper bound)
//   cmMoldBaseDesignHours               design hours by mold-base area (mm2, bracket upper bound)
//   cmToolMachiningRates                "Cavity Core Plate General Machining" rate (m2/hr)
//   cmToolMachiningSetups               "Cavity / Core Plate General Machining" setups x hours
//   tblToolLife + variables defaultToolLife   shots one mold lasts, by material type
//                                       (defaultToolLife: the reference median, for types
//                                       with no row)
//   digital_factory_settings_usa        USA toolroom rates (design / machining / assembly);
//                                       memory/ has no other location's settings
//
// Any missing value leaves the reference null with the value named: the
// engine then decides no mold class, tooling cost or machine fit rather than
// deciding on a number the database does not hold.

import MANIFEST from '../../../processes/memory-reference-domains.json';
import { fingerprintRows } from './reference-fingerprint';

export const PLASTIC_REFERENCE_SOURCE_VERSION: string =
  MANIFEST.domains.find((d) => d.key === 'injection_molding')!.sourceVersion;

export const PLASTIC_VARIABLE_KEYS = [
  'clampForceSafetyFactor', 'shotSizeSafetyFactor', 'defaultToolLife',
  'cycleTimeAdjustmentFactor', 'defaultMoldTemperatureIncrease', 'defaultRunnerSystem', 'GPPSMeltTemperature',
  'defaultNumCavities', 'defaultNumberOfGatesPerCavity',
  'flowRatioThresholdEasyFlow', 'flowRatioThresholdMediumFlow',
  'minimumPercentClampForceEasyFlow', 'minimumPercentClampForceMediumFlow', 'minimumPercentClampForceHardFlow',
  'conventionalRunnerMaxPressureReductionFactor', 'hotRunnerMaxPressureReductionFactor', 'minInjectionPressure',
  // Feature rules (which core method a recognised feature needs): optional, read by plastic-catalog-operation-resolver.ts.
  'maxNoCoreInsertDiameter', 'drawDirectionOrthogonalEpsilonForSlides', 'drawDirectionOrthogonalEpsilonForLifters',
  'cmAutoIncludeManualFlashTrimming', 'cmManualFlashTrimmingRate',
  // The mold base and its plate stack (mold-base.ts).
  'aPlateFlatCavityRatio', 'aPlateMinThickness', 'bPlateMinThickness', 'betweenPartsMoldBorder',
  'topClampPlateThickness', 'bottomClampPlateThickness', 'supportPlateThickness', 'useMetricOrImperialValues',
  // The cavity and core: machining by complexity and the polish of the default finish (mold-cavity.ts).
  'defaultCavityFinishIM', 'cmMoldSurfaceCountThresholdSimple', 'cmMoldSurfaceCountThresholdAverage',
  // The mold assembly extras (mold-tooling-calculator.ts, F-27): ejector pins, sprue, locating ring, try-out; and the default cavity texture.
  'areaCoveredPerEjectorPin', 'sprueBushingCost', 'locatingRingsCost', 'timePerTryoutBase', 'defaultNumTryOuts', 'cavityTexture_IM',
  // The slide and lifter blocks (F-28): their volume by size class, and the CMM hours to inspect them.
  'smallSlideVolume', 'mediumSlideVolume', 'largeSlideVolume', 'smallLifterVolume', 'mediumLifterVolume', 'largeLifterVolume',
  'cmmInspectionMultiplier', 'cmmInspectionAdder',
  // The cooling lines (F-30): the line diameter and the water hardware prices.
  'defaultWaterLineDiameter', 'waterHosesCost', 'waterManifoldFittingsCost', 'waterManifoldsCost',
] as const;
export const PLASTIC_LOOKUP_KEYS = [
  'tblSpiType',
  'cmStandardToolingComponents',
  'cmToolAssemblyTimes',
  'cmToolAssemblyNumOperators',
  'cmMoldBaseDesignHours',
  'cmToolMachiningRates',
  'cmToolMachiningSetups',
  'tblToolLife',
  'digital_factory_settings_usa',
  'injectionTimeAdjustmentFactors',
  'layoutNumCav',
  'tblStandardMoldBaseSizes', 'tblEdgeMoldBorderX', 'tblEdgeMoldBorderY', 'tblCavityPlateDepthBorder', 'tblCorePlateDepthBorder',
  'digital_factory_tool_materials_usa',
  'tblHrsPerSqInchSimple', 'tblHrsPerSqInchAverage', 'tblHrsPerSqInchComplex', 'SPIFinishes',
] as const;

/** The reference material whose melt density converts GPPS-rated shot size (see header). */
export const GPPS_REFERENCE_MATERIAL = 'Polystyrene';

export type MoldClass = 'Class101' | 'Class102' | 'Class103' | 'Class104' | 'Class105';

export interface MoldToolingTables {
  components: Array<{ name: string; unitCostUsd: number | null; quantity: number | null }>;
  assemblyTimes: Array<{ name: string; hours: number }>;
  operatorsByArea: Array<{ areaM2: number; operators: number }>;
  designHoursByArea: Array<{ areaMm2: number; hours: number }>;
  plateMachiningRateM2PerHr: number;
  cavityPlateSetupHr: number;
  corePlateSetupHr: number;
}

/** The reference clamp-force model's parameters (clamp-force.ts). */
export interface ClampModel {
  clampForceSafetyFactor: number;
  /** Material flow length ratio at or above which flow is Easy / Medium (else Hard). */
  easyFlowRatio: number;
  mediumFlowRatio: number;
  /** Share of adjusted injection pressure acting as cavity pressure, per flow class (%). */
  percentClampForce: { easy: number; medium: number; hard: number };
  /** Injection pressure reduction through the runner, by runner system. */
  runnerPressureReduction: { cold: number; hot: number };
  /** Floor on the adjusted injection pressure (MPa). */
  minInjectionPressureMpa: number;
}

/** The reference cycle-time parameters (cycle-time.ts). */
export interface CycleModel {
  /** variables cycleTimeAdjustmentFactor: global multiplier on the cycle. */
  cycleTimeAdjustmentFactor: number;
  /** variables defaultMoldTemperatureIncrease (C), added to the mold wall temperature. */
  moldTemperatureIncreaseC: number;
  /** variables defaultRunnerSystem: the runner a mold gets unless the part says otherwise. */
  defaultRunner: 'hot' | 'cold';
  /** injectionTimeAdjustmentFactors, bracket upper bounds, ascending. */
  fillFactorByCavities: Array<{ upTo: number; factor: number }>;
  fillFactorByGates: Array<{ upTo: number; factor: number }>;
  /** GPPS melt density (kg/m3), for press shot sizes rated in GPPS grams. */
  gppsMeltDensityKgM3: number;
}

/** What sizes and prices a mold base, from memory/Plastic Modeling. Lengths in mm. */
export interface MoldBaseReference {
  /** tblStandardMoldBaseSizes of the system useMetricOrImperialValues names (Metric: the mm sizes, Imperial: the inch sizes, converted). */
  bases: Array<{ name: string; widthMm: number; lengthMm: number }>;
  system: 'Metric' | 'Imperial';
  /** tblEdgeMoldBorderX / Y: the steel beside the cavities, by the press force (first row whose force covers it). */
  edgeBorderXByKn: Array<{ maxKn: number; mm: number }>;
  edgeBorderYByKn: Array<{ maxKn: number; mm: number }>;
  /** tblCavityPlateDepthBorder / tblCorePlateDepthBorder (inches in the table, mm here): the steel behind the cavity, by the press force. */
  cavityDepthBorderByKn: Array<{ maxKn: number; mm: number }>;
  coreDepthBorderByKn: Array<{ maxKn: number; mm: number }>;
  /** layoutNumCav: how a cavity count is laid out. */
  layouts: Array<{ cavities: number; widthWise: number; lengthWise: number; runnerCoefficient: number }>;
  betweenPartsMm: number;
  aPlateCavityRatio: number;
  aPlateMinMm: number;
  bPlateMinMm: number;
  topClampMm: number;
  bottomClampMm: number;
  supportPlateMm: number;
  /** digital_factory_settings_usa defaultToolMaterialName, and its row of digital_factory_tool_materials_usa. */
  steel: { name: string; densityKgM3: number; priceUsdPerKg: number; moldBaseCostFactor: number };
  /** tblHrsPerSqInch{Simple,Average,Complex}: cavity machining hours per square inch of part surface, by the surface area (in2, the first row covering it). */
  cavityHoursPerSqInByComplexity: Record<MoldComplexity, Array<{ upToSqIn: number; hoursPerSqIn: number }>>;
  /** cmMoldSurfaceCountThreshold{Simple,Average}: the face counts up to which a part is simple, then average (staged for compression molding). */
  complexityFaceThresholds: { simple: number; average: number };
  /** defaultCavityFinishIM and its SPIFinishes row: the polish hours per square meter of cavity surface. */
  finish: { name: string; hoursPerSqM: number };
}

export type MoldComplexity = 'Simple' | 'Average' | 'Complex';

export interface PlasticReference {
  /** The staged dataset these rows belong to (e.g. '2026-Plastic') and a fingerprint of the exact rows read: a saved calculation records both (calculation-snapshot.ts). */
  sourceVersion: string;
  datasetFingerprint: string;
  clampForceSafetyFactor: number;
  clampModel: ClampModel;
  cycleModel: CycleModel;
  /** variables defaultNumCavities: cavities per mold unless the user sets it. */
  defaultNumCavities: number;
  /** layoutNumCav: the cavity counts a reference mold layout exists for, ascending. */
  cavityLayouts: number[];
  /** variables defaultNumberOfGatesPerCavity. */
  defaultGatesPerCavity: number;
  shotSizeSafetyFactor: number;
  /** Ordered cheapest (lowest rating) first. useInsert: tblSpiType Use Insert, whether the class builds its cavity as inserts (null when not staged). */
  spiClasses: Array<{ moldClass: MoldClass; cycleRating: number; useInsert: boolean | null }>;
  tooling: MoldToolingTables;
  /** tblToolLife: shots one mold lasts, by raw_materials material_type. */
  toolLifeShotsByType: Array<{ materialType: string; shots: number }>;
  /** variables defaultToolLife: for a material type with no tblToolLife row. */
  defaultToolLifeShots: number;
  /** digital_factory_settings_usa, Default profile. USA only: no other location is on file. */
  toolroomRatesUsa: ToolroomRates;
  /** The mold assembly extras: the ejector pins, sprue bushing, locating ring and try-out, and the default cavity texture (F-27). */
  moldExtras: MoldExtrasReference;
  /** The mold base: standard sizes, borders, the plate stack and the default tool steel (mold-base.ts). */
  moldBase: MoldBaseReference;
  /**
   * Variables that decide which catalog operation a recognised feature needs. Optional, unlike the rest of the reference: a database without them
   * still costs the part, and the operations the missing variable would decide are reported undecided (plastic-catalog-operation-resolver.ts).
   */
  featureRules: FeatureRules;
}

/** digital_factory_settings_usa toolroom rates, USD per hour. */
export interface ToolroomRates {
  designUsdPerHr: number; machiningUsdPerHr: number; assemblyUsdPerHr: number; tryoutUsdPerHr: number;
  /** heatTreatRateUsdPerKg and stressReliefRateUsdPerKg: hardening and stress relief of the tool steel, per kg (F-29). */
  heatTreatUsdPerKg: number; stressReliefUsdPerKg: number;
}

/** What the mold's assembly extras cost, from memory/Plastic Modeling (F-27). */
export interface MoldExtrasReference {
  /** variables areaCoveredPerEjectorPin (mm2): one ejector pin per this much of the molded area. */
  areaPerEjectorPinMm2: number;
  /** cmStandardToolingComponents Ejector Pin unit cost (its quantity "is calculated in the cost model") and cmToolAssemblyTimes Ejector Pin hours. */
  ejectorPinUsd: number;
  ejectorPinAssemblyHours: number;
  /** variables sprueBushingCost and locatingRingsCost: one of each per mold. */
  sprueBushingUsd: number;
  locatingRingUsd: number;
  /** variables timePerTryoutBase (hours per try-out below 500 t, twice that above) and defaultNumTryOuts. */
  tryoutBaseHours: number;
  tryouts: number;
  /** variables cavityTexture_IM: the default cavity texture ("None": no texture). */
  cavityTexture: string;
  /** variables {small,medium,large}{Slide,Lifter}Volume (in3): the block steel of a slide or lifter of each size class (F-28). */
  slideVolumeIn3: { small: number; medium: number; large: number };
  lifterVolumeIn3: { small: number; medium: number; large: number };
  /** variables cmmInspectionMultiplier and cmmInspectionAdder: the CMM hours to inspect the slides and lifters. */
  cmmHoursPerSideAction: number;
  cmmBaseHours: number;
  /** The cooling lines (F-30): variables defaultWaterLineDiameter (mm) and the water hardware prices; cmToolMachiningRates Heater Line Drilling (mm/min). */
  waterLineDiameterMm: number;
  waterHoseUsd: number;
  waterFittingUsd: number;
  waterManifoldUsd: number;
  lineDrillingMmPerMin: number;
}

export interface FeatureRules {
  /** variables maxNoCoreInsertDiameter (mm): an obscured hole this small or smaller is made with an insert and needs no core. */
  maxNoCoreInsertDiameterMm: number | null;
  /** variable drawDirectionOrthogonalEpsilonForSlides (deg): how far from square to the pull a feature's axis may be and still be served by a slide (side core). */
  slideEpsilonDeg: number | null;
  /** variable drawDirectionOrthogonalEpsilonForLifters (deg): the same for a lifter. */
  lifterEpsilonDeg: number | null;
  /** variable cmAutoIncludeManualFlashTrimming: manual flash trimming is included by default for parts with no internal cutouts (compression molding). */
  autoManualFlashTrimming: boolean | null;
  /** variable cmManualFlashTrimmingRate (Length/Time, read as mm/s): the linear rate of manual flash removal; null when not staged. */
  manualFlashTrimmingRateMmPerS?: number | null;
}

export interface PlasticReferenceRows {
  variables: ReadonlyArray<{ key: string; value: string | number | null }>;
  /** The GPPS reference material row (raw), or undefined when not staged. */
  gppsMaterial?: Record<string, unknown>;
  /** lookup_table key -> its staged rows. */
  lookups: Readonly<Record<string, ReadonlyArray<Record<string, unknown>> | undefined>>;
}

/**
 * The staged rows in the one canonical form that is fingerprinted and stored (reference_data_snapshots.rows): variables sorted by key, the GPPS row or
 * null. resolvePlasticReference(restoreReferenceRows(canonicalReferenceRows(r))) equals resolvePlasticReference(r), so a stored copy rebuilds the
 * same reference the calculation read.
 */
export interface CanonicalReferenceRows {
  variables: Array<{ key: string; value: string | number | null }>;
  lookups: Record<string, ReadonlyArray<Record<string, unknown>> | undefined>;
  gppsMaterial: Record<string, unknown> | null;
}
export function canonicalReferenceRows(rows: PlasticReferenceRows): CanonicalReferenceRows {
  return {
    variables: [...rows.variables].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    lookups: { ...rows.lookups },
    gppsMaterial: rows.gppsMaterial ?? null,
  };
}
export function restoreReferenceRows(c: CanonicalReferenceRows): PlasticReferenceRows {
  return { variables: c.variables, lookups: c.lookups, ...(c.gppsMaterial ? { gppsMaterial: c.gppsMaterial } : {}) };
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Component names are spelled differently between tables for the same part
 *  ("Side Lock" / "Side Locks", "Ejector Guide Pin Bushing" / "Ejector Guide
 *  Pin And Bushing"): compare on lower case, without "and", singular words. */
export function componentNameKey(name: string): string {
  return name.toLowerCase().split(/\s+/).filter((w) => w && w !== 'and')
    .map((w) => (/(ch|sh|x|ss)es$/.test(w) ? w.slice(0, -2) : /[^s]s$/.test(w) ? w.slice(0, -1) : w))
    .join(' ');
}

export function resolvePlasticReference(rows: PlasticReferenceRows): { reference: PlasticReference | null; missing: string[] } {
  const missing: string[] = [];
  const vars = new Map(rows.variables.map((v) => [v.key, num(v.value)]));
  const text = new Map(rows.variables.map((v) => [v.key, v.value == null ? null : String(v.value)]));
  const variable = (k: string) => {
    const v = vars.get(k);
    if (v == null || v <= 0) { missing.push(`variables: ${k}`); return NaN; }
    return v;
  };
  const optionalPositive = (k: string): number | null => {
    const v = vars.get(k);
    return v != null && v > 0 ? v : null;
  };
  const table = (k: string) => {
    const t = rows.lookups[k];
    if (!t || t.length === 0) missing.push(`${k} (not staged)`);
    return t ?? [];
  };
  const named = (t: ReadonlyArray<Record<string, unknown>>, tableKey: string, rowName: string, field: string) => {
    const v = num(t.find((r) => r['name'] === rowName)?.[field]);
    if (v == null) missing.push(`${tableKey}: ${rowName} ${field}`);
    return v ?? NaN;
  };

  const clampForceSafetyFactor = variable('clampForceSafetyFactor');
  const clampModel: ClampModel = {
    clampForceSafetyFactor,
    easyFlowRatio: variable('flowRatioThresholdEasyFlow'),
    mediumFlowRatio: variable('flowRatioThresholdMediumFlow'),
    percentClampForce: {
      easy: variable('minimumPercentClampForceEasyFlow'),
      medium: variable('minimumPercentClampForceMediumFlow'),
      hard: variable('minimumPercentClampForceHardFlow'),
    },
    runnerPressureReduction: {
      cold: variable('conventionalRunnerMaxPressureReductionFactor'),
      hot: variable('hotRunnerMaxPressureReductionFactor'),
    },
    minInjectionPressureMpa: variable('minInjectionPressure'),
  };
  const shotSizeSafetyFactor = variable('shotSizeSafetyFactor');

  const spiClasses = table('tblSpiType').map((r) => ({
    moldClass: `Class${num(r['Spi Type'])}` as MoldClass,
    cycleRating: num(r['Num Annual Mold Cycles']),
    useInsert: ((v) => (v === 'true' ? true : v === 'false' ? false : null))(String(r['Use Insert'] ?? '').trim().toLowerCase()),
  }));
  if (spiClasses.some((c) => c.cycleRating == null)) missing.push('tblSpiType: Num Annual Mold Cycles');

  const components = table('cmStandardToolingComponents').map((r) => ({
    name: String(r['name']), unitCostUsd: num(r['unit_cost_usd']), quantity: num(r['quantity']),
  }));
  const assemblyTimes = table('cmToolAssemblyTimes').map((r) => ({ name: String(r['name']), hours: num(r['assembly_time_hr']) ?? NaN }));
  const operatorsByArea = table('cmToolAssemblyNumOperators')
    .map((r) => ({ areaM2: num(r['mold_base_area_m2']) ?? NaN, operators: num(r['num_operators_required']) ?? NaN }))
    .sort((a, b) => a.areaM2 - b.areaM2);
  const designHoursByArea = table('cmMoldBaseDesignHours')
    .map((r) => ({ areaMm2: num(r['mold_base_area_mm2']) ?? NaN, hours: num(r['base_design_hrs_hr']) ?? NaN }))
    .sort((a, b) => a.areaMm2 - b.areaMm2);
  if ([...assemblyTimes.map((a) => a.hours), ...operatorsByArea.flatMap((o) => [o.areaM2, o.operators]),
    ...designHoursByArea.flatMap((d) => [d.areaMm2, d.hours])].some((v) => !Number.isFinite(v))) {
    missing.push('cmToolAssemblyTimes / cmToolAssemblyNumOperators / cmMoldBaseDesignHours: non-numeric cell');
  }

  const rates = table('cmToolMachiningRates');
  const setups = table('cmToolMachiningSetups');
  const plateMachiningRateM2PerHr = named(rates, 'cmToolMachiningRates', 'Cavity Core Plate General Machining', 'rate');
  const setupHr = (rowName: string) =>
    named(setups, 'cmToolMachiningSetups', rowName, 'number_of_setups') * named(setups, 'cmToolMachiningSetups', rowName, 'setup_time_hr');
  const cavityPlateSetupHr = setupHr('Cavity Plate General Machining');
  const corePlateSetupHr = setupHr('Core Plate General Machining');

  const toolLifeShotsByType = table('tblToolLife').map((r) => ({ materialType: String(r['Material Type']), shots: num(r['Num Shots Per Tool']) ?? NaN }));
  if (toolLifeShotsByType.some((t) => !Number.isFinite(t.shots))) missing.push('tblToolLife: Num Shots Per Tool');
  const defaultToolLifeShots = variable('defaultToolLife');
  const settings = table('digital_factory_settings_usa').find((r) => r['name'] === 'Default');
  const rate = (field: string) => {
    const v = num(settings?.[field]);
    if (v == null || v <= 0) { missing.push(`digital_factory_settings_usa: Default ${field}`); return NaN; }
    return v;
  };
  const toolroomRatesUsa = {
    designUsdPerHr: rate('designRateUsdPerHr'),
    machiningUsdPerHr: rate('machiningRateUsdPerHr'),
    assemblyUsdPerHr: rate('assemblyRateUsdPerHr'),
    tryoutUsdPerHr: rate('tryoutRateUsdPerHr'),
    heatTreatUsdPerKg: rate('heatTreatRateUsdPerKg'),
    stressReliefUsdPerKg: rate('stressReliefRateUsdPerKg'),
  };
  const ejectorPin = components.find((c) => componentNameKey(c.name) === componentNameKey('Ejector Pin'));
  const ejectorPinHours = assemblyTimes.find((a) => componentNameKey(a.name) === componentNameKey('Ejector Pin'))?.hours;
  if (!(ejectorPin?.unitCostUsd != null && ejectorPin.unitCostUsd > 0)) missing.push('cmStandardToolingComponents: Ejector Pin unit_cost_usd');
  if (!(ejectorPinHours != null && ejectorPinHours > 0)) missing.push('cmToolAssemblyTimes: Ejector Pin assembly_time_hr');
  const texture = text.get('cavityTexture_IM')?.trim() || null;
  if (!texture) missing.push('variables: cavityTexture_IM');
  const moldExtras: MoldExtrasReference = {
    areaPerEjectorPinMm2: variable('areaCoveredPerEjectorPin'),
    ejectorPinUsd: ejectorPin?.unitCostUsd ?? NaN,
    ejectorPinAssemblyHours: ejectorPinHours ?? NaN,
    sprueBushingUsd: variable('sprueBushingCost'),
    locatingRingUsd: variable('locatingRingsCost'),
    tryoutBaseHours: variable('timePerTryoutBase'),
    tryouts: variable('defaultNumTryOuts'),
    cavityTexture: texture ?? '',
    slideVolumeIn3: { small: variable('smallSlideVolume'), medium: variable('mediumSlideVolume'), large: variable('largeSlideVolume') },
    lifterVolumeIn3: { small: variable('smallLifterVolume'), medium: variable('mediumLifterVolume'), large: variable('largeLifterVolume') },
    cmmHoursPerSideAction: variable('cmmInspectionMultiplier'),
    cmmBaseHours: variable('cmmInspectionAdder'),
    waterLineDiameterMm: variable('defaultWaterLineDiameter'),
    waterHoseUsd: variable('waterHosesCost'),
    waterFittingUsd: variable('waterManifoldFittingsCost'),
    waterManifoldUsd: variable('waterManifoldsCost'),
    lineDrillingMmPerMin: named(rates, 'cmToolMachiningRates', 'Heater Line Drilling', 'rate'),
  };

  const system = text.get('useMetricOrImperialValues') === 'Imperial' ? 'Imperial' : text.get('useMetricOrImperialValues') === 'Metric' ? 'Metric' : null;
  if (!system) missing.push('variables: useMetricOrImperialValues');
  const IN = 25.4;
  const bases = table('tblStandardMoldBaseSizes')
    .filter((r) => (system === 'Imperial' ? r['Reference Uom'] === 'inches' : r['Reference Uom'] === 'mm'))
    .map((r) => {
      const k = r['Reference Uom'] === 'inches' ? IN : 1;
      return { name: String(r['Mold Base Name']), widthMm: (num(r['Actual Width']) ?? NaN) * k, lengthMm: (num(r['Actual Length']) ?? NaN) * k };
    })
    .sort((a, b) => a.widthMm * a.lengthMm - b.widthMm * b.lengthMm);
  if (bases.length === 0 || bases.some((b) => !(b.widthMm > 0 && b.lengthMm > 0))) missing.push('tblStandardMoldBaseSizes: Actual Width / Actual Length');
  const byForce = (key: string, col: string, factor = 1) => table(key)
    .map((r) => ({ maxKn: num(r['Max Press Force (kN)']) ?? NaN, mm: (num(r[col]) ?? NaN) * factor }))
    .sort((a, b) => a.maxKn - b.maxKn);
  const edgeBorderXByKn = byForce('tblEdgeMoldBorderX', 'Edge Mold Border X (mm)');
  const edgeBorderYByKn = byForce('tblEdgeMoldBorderY', 'Edge Mold Border Y (mm)');
  const cavityDepthBorderByKn = byForce('tblCavityPlateDepthBorder', 'Cavity Plate Depth Border (in)', IN);
  const coreDepthBorderByKn = byForce('tblCorePlateDepthBorder', 'Core Plate Depth Border (in)', IN);
  if ([...edgeBorderXByKn, ...edgeBorderYByKn, ...cavityDepthBorderByKn, ...coreDepthBorderByKn].some((r) => !Number.isFinite(r.maxKn + r.mm))) {
    missing.push('tblEdgeMoldBorderX/Y, tblCavity/CorePlateDepthBorder: non-numeric cell');
  }
  const layouts = table('layoutNumCav').map((r) => ({
    cavities: num(r['number_of_cavities']) ?? NaN, widthWise: num(r['cavities_width_wise']) ?? NaN,
    lengthWise: num(r['cavities_length_wise']) ?? NaN, runnerCoefficient: num(r['coefficient_runner_region_width']) ?? NaN,
  }));
  if (layouts.some((l) => !Number.isFinite(l.cavities + l.widthWise + l.lengthWise + l.runnerCoefficient))) missing.push('layoutNumCav: non-numeric cell');
  const steelName = typeof settings?.['defaultToolMaterialName'] === 'string' ? settings['defaultToolMaterialName'] : null;
  const steelRow = table('digital_factory_tool_materials_usa').find((r) => r['name'] === steelName);
  if (!steelRow) missing.push(`digital_factory_tool_materials_usa: the default tool material ${steelName ?? '(defaultToolMaterialName not set)'}`);
  const hoursByArea = (key: string, label: string) => table(key)
    .map((r) => ({ upToSqIn: num(r[`Surface Area ${label} (in^2)`]) ?? NaN, hoursPerSqIn: num(r[`Hrs Per Sq Inch ${label} (hr)`]) ?? NaN }))
    .sort((a, b) => a.upToSqIn - b.upToSqIn);
  const cavityHoursPerSqInByComplexity = {
    Simple: hoursByArea('tblHrsPerSqInchSimple', 'Simple'),
    Average: hoursByArea('tblHrsPerSqInchAverage', 'Average'),
    Complex: hoursByArea('tblHrsPerSqInchComplex', 'Complex'),
  };
  if (Object.values(cavityHoursPerSqInByComplexity).some((rows) => rows.length === 0 || rows.some((r) => !(r.upToSqIn > 0 && r.hoursPerSqIn > 0)))) {
    missing.push('tblHrsPerSqInch{Simple,Average,Complex}: non-numeric cell');
  }
  const finishName = text.get('defaultCavityFinishIM') ?? null;
  const finishRow = table('SPIFinishes').find((r) => r['Finish Name'] === finishName);
  if (!finishRow) missing.push(`SPIFinishes: the default cavity finish ${finishName ?? '(defaultCavityFinishIM not set)'}`);
  const moldBase: MoldBaseReference = {
    bases, system: system ?? 'Metric', edgeBorderXByKn, edgeBorderYByKn, cavityDepthBorderByKn, coreDepthBorderByKn, layouts,
    betweenPartsMm: variable('betweenPartsMoldBorder'), aPlateCavityRatio: variable('aPlateFlatCavityRatio'),
    aPlateMinMm: variable('aPlateMinThickness'), bPlateMinMm: variable('bPlateMinThickness'),
    topClampMm: variable('topClampPlateThickness'), bottomClampMm: variable('bottomClampPlateThickness'), supportPlateMm: variable('supportPlateThickness'),
    steel: {
      name: steelName ?? '', densityKgM3: num(steelRow?.['densityKgPerM3']) ?? NaN, priceUsdPerKg: num(steelRow?.['materialCostUsdPerKg']) ?? NaN,
      moldBaseCostFactor: num(steelRow?.['moldBaseCostFactor']) ?? NaN,
    },
    cavityHoursPerSqInByComplexity,
    complexityFaceThresholds: { simple: variable('cmMoldSurfaceCountThresholdSimple'), average: variable('cmMoldSurfaceCountThresholdAverage') },
    finish: { name: finishName ?? '', hoursPerSqM: num(finishRow?.['Hrs Per Sq Meter (hr / m^2)']) ?? NaN },
  };

  const fillFactors = (attribute: string) => table('injectionTimeAdjustmentFactors')
    .filter((r) => r['attribute'] === attribute)
    .map((r) => ({ upTo: num(r['number']) ?? NaN, factor: num(r['adjustment_factor']) ?? NaN }))
    .sort((a, b) => a.upTo - b.upTo);
  const fillFactorByCavities = fillFactors('Cavities Per Mold');
  const fillFactorByGates = fillFactors('Gates Per Cavity');
  if (fillFactorByCavities.length === 0 || fillFactorByGates.length === 0
    || [...fillFactorByCavities, ...fillFactorByGates].some((f) => !Number.isFinite(f.upTo + f.factor))) {
    missing.push('injectionTimeAdjustmentFactors: Cavities Per Mold / Gates Per Cavity rows');
  }
  const runnerText = text.get('defaultRunnerSystem');
  const defaultRunner = runnerText === 'Hot Runner' ? 'hot' : runnerText === 'Cold Runner' ? 'cold' : null;
  if (!defaultRunner) missing.push('variables: defaultRunnerSystem');
  const moldIncrease = vars.get('defaultMoldTemperatureIncrease');
  if (moldIncrease == null) missing.push('variables: defaultMoldTemperatureIncrease');
  const gppsMelt = num(rows.gppsMaterial?.['physicalProperties.densityOfMeltKgM3']);
  const gppsTemp = num(rows.gppsMaterial?.['thermalProperties.meltingTempC']);
  if (gppsMelt == null) missing.push(`material ${GPPS_REFERENCE_MATERIAL}: densityOfMeltKgM3`);
  else if (gppsTemp !== vars.get('GPPSMeltTemperature')) {
    missing.push(`material ${GPPS_REFERENCE_MATERIAL}: melting temperature ${gppsTemp} is not the reference GPPSMeltTemperature`);
  }
  const cycleModel: CycleModel = {
    cycleTimeAdjustmentFactor: variable('cycleTimeAdjustmentFactor'),
    moldTemperatureIncreaseC: moldIncrease ?? NaN,
    defaultRunner: defaultRunner as 'hot' | 'cold', // null already recorded in missing
    fillFactorByCavities,
    fillFactorByGates,
    gppsMeltDensityKgM3: gppsMelt ?? NaN,
  };
  const defaultNumCavities = variable('defaultNumCavities');
  const cavityLayouts = [...new Set(table('layoutNumCav').map((r) => num(r['number_of_cavities'])).filter((n): n is number => n != null && n > 0))]
    .sort((a, b) => a - b);
  if (cavityLayouts.length === 0) missing.push('layoutNumCav: number_of_cavities');
  const defaultGatesPerCavity = variable('defaultNumberOfGatesPerCavity');

  if (missing.length > 0) return { reference: null, missing };
  return {
    reference: {
      sourceVersion: PLASTIC_REFERENCE_SOURCE_VERSION,
      datasetFingerprint: fingerprintRows(canonicalReferenceRows(rows)),
      clampForceSafetyFactor,
      clampModel,
      cycleModel,
      defaultNumCavities,
      cavityLayouts,
      defaultGatesPerCavity,
      shotSizeSafetyFactor,
      spiClasses: (spiClasses as Array<{ moldClass: MoldClass; cycleRating: number; useInsert: boolean | null }>).sort((a, b) => a.cycleRating - b.cycleRating),
      tooling: { components, assemblyTimes, operatorsByArea, designHoursByArea, plateMachiningRateM2PerHr, cavityPlateSetupHr, corePlateSetupHr },
      toolLifeShotsByType,
      defaultToolLifeShots,
      toolroomRatesUsa,
      moldExtras,
      moldBase,
      featureRules: {
        maxNoCoreInsertDiameterMm: optionalPositive('maxNoCoreInsertDiameter'),
        slideEpsilonDeg: optionalPositive('drawDirectionOrthogonalEpsilonForSlides'),
        lifterEpsilonDeg: optionalPositive('drawDirectionOrthogonalEpsilonForLifters'),
        autoManualFlashTrimming: ((v) => (v === 'true' ? true : v === 'false' ? false : null))(text.get('cmAutoIncludeManualFlashTrimming')?.trim().toLowerCase()),
        manualFlashTrimmingRateMmPerS: optionalPositive('cmManualFlashTrimmingRate'),
      },
    },
    missing: [],
  };
}
