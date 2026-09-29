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

export const PLASTIC_REFERENCE_SOURCE_VERSION: string =
  MANIFEST.domains.find((d) => d.key === 'injection_molding')!.sourceVersion;

export const PLASTIC_VARIABLE_KEYS = [
  'clampForceSafetyFactor', 'shotSizeSafetyFactor', 'defaultToolLife',
  'cycleTimeAdjustmentFactor', 'defaultMoldTemperatureIncrease', 'defaultRunnerSystem', 'GPPSMeltTemperature',
  'defaultNumCavities', 'defaultNumberOfGatesPerCavity',
  'flowRatioThresholdEasyFlow', 'flowRatioThresholdMediumFlow',
  'minimumPercentClampForceEasyFlow', 'minimumPercentClampForceMediumFlow', 'minimumPercentClampForceHardFlow',
  'conventionalRunnerMaxPressureReductionFactor', 'hotRunnerMaxPressureReductionFactor', 'minInjectionPressure',
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

export interface PlasticReference {
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
  /** Ordered cheapest (lowest rating) first. */
  spiClasses: Array<{ moldClass: MoldClass; cycleRating: number }>;
  tooling: MoldToolingTables;
  /** tblToolLife: shots one mold lasts, by raw_materials material_type. */
  toolLifeShotsByType: Array<{ materialType: string; shots: number }>;
  /** variables defaultToolLife: for a material type with no tblToolLife row. */
  defaultToolLifeShots: number;
  /** digital_factory_settings_usa, Default profile. USA only: no other location is on file. */
  toolroomRatesUsa: { designUsdPerHr: number; machiningUsdPerHr: number; assemblyUsdPerHr: number };
}

export interface PlasticReferenceRows {
  variables: ReadonlyArray<{ key: string; value: string | number | null }>;
  /** The GPPS reference material row (raw), or undefined when not staged. */
  gppsMaterial?: Record<string, unknown>;
  /** lookup_table key -> its staged rows. */
  lookups: Readonly<Record<string, ReadonlyArray<Record<string, unknown>> | undefined>>;
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
      clampForceSafetyFactor,
      clampModel,
      cycleModel,
      defaultNumCavities,
      cavityLayouts,
      defaultGatesPerCavity,
      shotSizeSafetyFactor,
      spiClasses: (spiClasses as Array<{ moldClass: MoldClass; cycleRating: number }>).sort((a, b) => a.cycleRating - b.cycleRating),
      tooling: { components, assemblyTimes, operatorsByArea, designHoursByArea, plateMachiningRateM2PerHr, cavityPlateSetupHr, corePlateSetupHr },
      toolLifeShotsByType,
      defaultToolLifeShots,
      toolroomRatesUsa,
    },
    missing: [],
  };
}
