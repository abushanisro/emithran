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
import { planRibInserts, ribInsertQuantities, type RibSignals } from '../process/rib-inserts';
import type { SteelTreatment } from '../reference/im-reference';
import { calculatorFingerprint, requirePlasticCalculator, withRegistryFormulas } from './plastic-cycle-time';
import { componentNameKey } from '../plastic-reference';
import { plasticLookup, plasticVariable, withRef } from './plastic-input-sources';

export const MOLD_TOOLING_CALCULATOR = 'Injection Mold - Tooling';
const OUTPUT = 'Tooling Cost Per Part';
const REF = 'memory/Plastic Modeling';
// Formula registry (plastic-molding/formula-registry.ts): F-27 (assembly extras), F-28 (slide and lifter blocks), F-29 (heat treatment), F-30 (cooling), F-31 (rib inserts, EDM), F-33 (hot drops) are this
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
  /** The mold_base_area_mm2 of the cmMoldBaseDesignHours row the design hours were read from; absent when not known. */
  designHoursRowAreaMm2?: number | null;
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
  /** The Material Type of the tblToolLife row the tool life was read from; null when it is the reference default (defaultToolLife). Absent: not known. */
  toolLifeMaterialType?: string | null;
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
  /** The ribs the CAD engine measured (rib-inserts.ts); null when the graph has none to read. */
  ribs: RibSignals | null;
  /** How the default tool steel grade is treated (reference/mold-steel-treatment-reference.csv); null when the grade has no row. */
  steelTreatment: SteelTreatment | null;
  /** The runner and the gates per cavity: a hot runner has one drop per gate (F-33). */
  runner: 'hot' | 'cold';
  gatesPerCavity: number;
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
  const ri = x.ribInsert;
  const st = f.steelTreatment;
  const treatmentSource = (column: string, applies: boolean | undefined) => st
    ? `reference/mold-steel-treatment-reference.csv: ${st.steelGrade} (${st.deliveryCondition}) ${column} -> ${applies ? 'charged' : 'not charged'} (${st.confidence}${st.reviewRequired ? ', review required' : ''}; ${st.source})`
    : `reference/mold-steel-treatment-reference.csv: no row for ${mb.steel.name}, not charged (named gap)`;
  const rq = ribInsertQuantities(planRibInserts(f.ribs, ri), ri);
  const ribSource = `CAD ribs taller than machinedRibThreshold ${ri.thresholdMm} mm, classed by footprint (length x thickness) against {small,medium,large}InsertArea: ${rq.breakdown}`;
  const vars = `${REF}/variables`;
  const steel = `${REF}/process/digital_factory_tool_materials_usa: ${mb.steel.name} (digital_factory_settings_usa defaultToolMaterialName)`;
  const listed = f.components.map((c) => `${c.componentName} ${c.qty} x ${c.unitCostUsd}`).join(', ');
  const settings = `${REF}/process/digital_factory_settings_usa: Default`;
  // Where each value was read (plastic-input-sources.ts): the staged variable, or the lookup table's column and row. A value summed or multiplied over
  // several rows or variables (the component subtotal, the assembly hours, the plate setups, the block volumes, the rib insert quantities), a CAD
  // bounding-box size, the scenario and the approved rules have no one place to open, so they carry none.
  const v = plasticVariable;
  const settingsRef = (column: string) => plasticLookup('digital_factory_settings_usa', column, { name: 'Default' });
  const steelRef = (column: string) => plasticLookup('digital_factory_tool_materials_usa', column, { name: mb.steel.name });
  const machiningRate = (rowName: string) => plasticLookup('cmToolMachiningRates', 'rate', { name: rowName });
  /** A component's staged row name (the tables spell components differently: componentNameKey), for its row. */
  const stagedName = (rows: ReadonlyArray<{ name: string }>, wanted: string) => rows.find((r) => componentNameKey(r.name) === componentNameKey(wanted))?.name;
  const rowNamed = (table: string, column: string, rows: ReadonlyArray<{ name: string }>, wanted: string) => {
    const name = stagedName(rows, wanted);
    return name ? plasticLookup(table, column, { name }) : undefined;
  };
  // A base name repeats in the table (two 11X12 sizes in inches): the row is the one with this name, unit and size, in the table's own unit.
  const baseUnitMm = mb.system === 'Imperial' ? 25.4 : 1;
  const baseRow = {
    'Mold Base Name': b.base.name, 'Reference Uom': mb.system === 'Imperial' ? 'inches' : 'mm',
    'Actual Width': b.base.widthMm / baseUnitMm, 'Actual Length': b.base.lengthMm / baseUnitMm,
  };
  const toolLifeRef = f.toolLifeMaterialType === undefined ? undefined
    : f.toolLifeMaterialType === null ? v('defaultToolLife') : plasticLookup('tblToolLife', 'Num Shots Per Tool', { 'Material Type': f.toolLifeMaterialType });
  const designRef = f.designHoursRowAreaMm2 != null ? plasticLookup('cmMoldBaseDesignHours', 'base_design_hrs_hr', { mold_base_area_mm2: f.designHoursRowAreaMm2 }) : undefined;
  return {
    seeds: {
      'Purchased Components Cost': { value: f.componentsSubtotalUsd, source: `${REF}/lookup/cmStandardToolingComponents: ${listed || 'none'}`, lookup: true },
      'Mold Base Area': { value: f.moldBaseAreaMm2, source: `CAD projected area x ${f.cavityCount} cavit${f.cavityCount === 1 ? 'y' : 'ies'} (the required mold window)` },
      'Design Hours': withRef({ value: f.designHours, source: `${REF}/lookup/cmMoldBaseDesignHours: the first row covering ${Math.round(f.moldBaseAreaMm2)} mm²`, lookup: true }, designRef),
      'Plate Machining Rate': {
        value: f.tables.plateMachiningRateM2PerHr, source: `${REF}/lookup/cmToolMachiningRates: Cavity Core Plate General Machining`, lookup: true,
        ref: machiningRate('Cavity Core Plate General Machining'),
      },
      'Plate Setup Hours': { value: f.tables.cavityPlateSetupHr + f.tables.corePlateSetupHr, source: `${REF}/lookup/cmToolMachiningSetups: cavity ${f.tables.cavityPlateSetupHr} h + core ${f.tables.corePlateSetupHr} h`, lookup: true },
      'Assembly Hours': { value: f.assemblyHours, source: `${REF}/lookup/cmToolAssemblyTimes: hours per component x its quantity`, lookup: true },
      'Design Rate': { value: f.toolroomRates.designUsdPerHr, source: `${settings} designRateUsdPerHr`, ref: settingsRef('designRateUsdPerHr') },
      'Machining Rate': { value: f.toolroomRates.machiningUsdPerHr, source: `${settings} machiningRateUsdPerHr`, ref: settingsRef('machiningRateUsdPerHr') },
      'Assembly Rate': { value: f.toolroomRates.assemblyUsdPerHr, source: `${settings} assemblyRateUsdPerHr`, ref: settingsRef('assemblyRateUsdPerHr') },
      'Annual Volume': { value: f.annualVolume, source: 'Scenario: annual volume' },
      'Production Life': { value: f.productionLifeYears, source: 'Scenario: production life (years)' },
      'Cavities per Mold': { value: f.cavityCount, source: 'The costed cavity count' },
      'Tool Life Shots': withRef({ value: f.toolLifeShots, source: f.toolLifeSource, lookup: true }, toolLifeRef),
      'Mold Base Width': {
        value: b.base.widthMm, lookup: true, ref: plasticLookup('tblStandardMoldBaseSizes', 'Actual Width', baseRow),
        source: `${REF}/lookup/tblStandardMoldBaseSizes: ${b.base.name} (${mb.system}), the smallest holding ${Math.round(b.requiredWidthMm)} x ${Math.round(b.requiredLengthMm)} mm: `
          + `${b.layout.widthWise} x ${b.layout.lengthWise} cavities (layoutNumCav) with ${mb.betweenPartsMm} mm between parts, edge borders ${b.edgeBorderXMm} / ${b.edgeBorderYMm} mm (tblEdgeMoldBorderX/Y)`,
      },
      'Mold Base Length': { value: b.base.lengthMm, source: `${REF}/lookup/tblStandardMoldBaseSizes: ${b.base.name}`, lookup: true, ref: plasticLookup('tblStandardMoldBaseSizes', 'Actual Length', baseRow) },
      'Part Height': { value: f.partHeightMm!, source: 'CAD bounding box: the smallest side, along the pull direction' },
      'A Plate Cavity Ratio': { value: mb.aPlateCavityRatio, source: `${vars}: aPlateFlatCavityRatio`, ref: v('aPlateFlatCavityRatio') },
      'Cavity Plate Depth Border': {
        value: b.cavityDepthBorderMm, source: `${REF}/lookup/tblCavityPlateDepthBorder: by the press force (inches, in mm)`, lookup: true,
        ref: plasticLookup('tblCavityPlateDepthBorder', 'Cavity Plate Depth Border (in)', { 'Max Press Force (kN)': b.cavityDepthBorderRowKn }),
      },
      'Core Plate Depth Border': {
        value: b.coreDepthBorderMm, source: `${REF}/lookup/tblCorePlateDepthBorder: by the press force (inches, in mm)`, lookup: true,
        ref: plasticLookup('tblCorePlateDepthBorder', 'Core Plate Depth Border (in)', { 'Max Press Force (kN)': b.coreDepthBorderRowKn }),
      },
      'A Plate Min Thickness': { value: mb.aPlateMinMm, source: `${vars}: aPlateMinThickness`, ref: v('aPlateMinThickness') },
      'B Plate Min Thickness': { value: mb.bPlateMinMm, source: `${vars}: bPlateMinThickness`, ref: v('bPlateMinThickness') },
      'Top Clamp Plate Thickness': { value: mb.topClampMm, source: `${vars}: topClampPlateThickness`, ref: v('topClampPlateThickness') },
      'Support Plate Thickness': { value: mb.supportPlateMm, source: `${vars}: supportPlateThickness`, ref: v('supportPlateThickness') },
      'Bottom Clamp Plate Thickness': { value: mb.bottomClampMm, source: `${vars}: bottomClampPlateThickness`, ref: v('bottomClampPlateThickness') },
      'Tool Steel Density': { value: mb.steel.densityKgM3, source: `${steel}: densityKgPerM3`, lookup: true, ref: steelRef('densityKgPerM3') },
      'Tool Steel Price': { value: mb.steel.priceUsdPerKg, source: `${steel}: materialCostUsdPerKg`, lookup: true, ref: steelRef('materialCostUsdPerKg') },
      'Mold Base Cost Factor': { value: mb.steel.moldBaseCostFactor, source: `${steel}: moldBaseCostFactor`, lookup: true, ref: steelRef('moldBaseCostFactor') },
      'Part Surface Area': { value: f.partSurfaceAreaMm2!, source: 'CAD part surface area', ref: { kind: 'cad', evidence: 'part_surface' } },
      'Cavity Machining Hours Per Sq In': {
        value: cav.hoursPerSqIn, lookup: true,
        ref: plasticLookup(`tblHrsPerSqInch${cav.complexity}`, `Hrs Per Sq Inch ${cav.complexity} (hr)`, { [`Surface Area ${cav.complexity} (in^2)`]: cav.rowUpToSqIn }),
        source: `${REF}/lookup/tblHrsPerSqInch${cav.complexity}: the row up to ${cav.rowUpToSqIn} in² (${cav.complexity}: ${cav.faceCount} CAD faces against `
          + `cmMoldSurfaceCountThreshold ${mb.complexityFaceThresholds.simple} / ${mb.complexityFaceThresholds.average}, borrowed from compression molding)`,
      },
      'Polish Hours Per Sq Meter': {
        value: mb.finish.hoursPerSqM, source: `${REF}/lookup/SPIFinishes: ${mb.finish.name} (defaultCavityFinishIM)`, lookup: true,
        ref: plasticLookup('SPIFinishes', 'Hrs Per Sq Meter (hr / m^2)', { 'Finish Name': mb.finish.name }),
      },
      'Area Per Ejector Pin': { value: x.areaPerEjectorPinMm2, source: `${vars}: areaCoveredPerEjectorPin`, ref: v('areaCoveredPerEjectorPin') },
      'Ejector Pin Cost': withRef(
        { value: x.ejectorPinUsd, source: `${REF}/lookup/cmStandardToolingComponents: Ejector Pin (its quantity "is calculated in the cost model")`, lookup: true },
        rowNamed('cmStandardToolingComponents', 'unit_cost_usd', f.tables.components, 'Ejector Pin'),
      ),
      'Ejector Pin Assembly Hours': withRef(
        { value: x.ejectorPinAssemblyHours, source: `${REF}/lookup/cmToolAssemblyTimes: Ejector Pin`, lookup: true },
        rowNamed('cmToolAssemblyTimes', 'assembly_time_hr', f.tables.assemblyTimes, 'Ejector Pin'),
      ),
      'Sprue Bushing Cost': { value: x.sprueBushingUsd, source: `${vars}: sprueBushingCost (one per mold)`, ref: v('sprueBushingCost') },
      'Locating Ring Cost': { value: x.locatingRingUsd, source: `${vars}: locatingRingsCost (one per mold)`, ref: v('locatingRingsCost') },
      'Tryout Base Hours': { value: x.tryoutBaseHours, source: `${vars}: timePerTryoutBase`, ref: v('timePerTryoutBase') },
      'Tryout Press Multiplier': {
        value: f.pressClampTonnes! > TRYOUT_DOUBLE_ABOVE_TONNES ? 2 : 1,
        source: `${vars}: timePerTryoutBase note "<500T (x2 for bigger)": the press is ${Math.round(f.pressClampTonnes!)} t`,
      },
      'Number of Tryouts': { value: x.tryouts, source: `${vars}: defaultNumTryOuts`, ref: v('defaultNumTryOuts') },
      'Tryout Rate': { value: f.toolroomRates.tryoutUsdPerHr, source: `${settings} tryoutRateUsdPerHr`, ref: settingsRef('tryoutRateUsdPerHr') },
      'Slide Block Volume': { value: sa.slideVolumeIn3, source: `CAD slide bundles: ${sa.slideSource}`, lookup: true },
      'Lifter Block Volume': { value: sa.lifterVolumeIn3, source: `CAD lifter bundles (a bundle a slide could also serve is costed as a lifter): ${sa.lifterSource}`, lookup: true },
      'Side Action Block Surface': { value: sa.surfaceIn2, source: `each of the ${sa.count} block${sa.count === 1 ? '' : 's'} as a cube of its volume, 6 x V^(2/3) in², summed` },
      'Side Actions': { value: sa.count, source: f.sideActionBlocks ? 'CAD: the recognised slide and lifter bundles with a size class' : 'CAD features not recognised: no bundles to price' },
      'CMM Hours Per Side Action': { value: x.cmmHoursPerSideAction, source: `${vars}: cmmInspectionMultiplier`, ref: v('cmmInspectionMultiplier') },
      'CMM Base Hours': { value: x.cmmBaseHours, source: `${vars}: cmmInspectionAdder`, ref: v('cmmInspectionAdder') },
      'Heat Treat Rate': {
        value: f.toolroomRates.heatTreatUsdPerKg, source: `${settings} heatTreatRateUsdPerKg (the cavity and core plates and the slide and lifter blocks)`,
        ref: settingsRef('heatTreatRateUsdPerKg'),
      },
      'Stress Relief Rate': { value: f.toolroomRates.stressReliefUsdPerKg, source: `${settings} stressReliefRateUsdPerKg (the clamp and support plates)`, ref: settingsRef('stressReliefRateUsdPerKg') },
      'Water Line Diameter': { value: x.waterLineDiameterMm, source: `${vars}: defaultWaterLineDiameter`, ref: v('defaultWaterLineDiameter') },
      'Water Line Pitch Factor': { value: WATER_LINE_PITCH_FACTOR, source: 'Approved rule: lines 3 line diameters apart across the cavity plate (no pitch is on file)' },
      'Line Drilling Rate': {
        value: x.lineDrillingMmPerMin, source: `${REF}/lookup/cmToolMachiningRates: Heater Line Drilling (the only line drilling rate on file)`, lookup: true,
        ref: machiningRate('Heater Line Drilling'),
      },
      'Water Hose Cost': { value: x.waterHoseUsd, source: `${vars}: waterHosesCost (2 per line)`, ref: v('waterHosesCost') },
      'Water Fitting Cost': { value: x.waterFittingUsd, source: `${vars}: waterManifoldFittingsCost (2 per line)`, ref: v('waterManifoldFittingsCost') },
      'Water Manifold Cost': { value: x.waterManifoldUsd, source: `${vars}: waterManifoldsCost (one per side)`, ref: v('waterManifoldsCost') },
      'Rib Inserts': { value: rq.inserts, source: ribSource, lookup: true },
      'Rib Insert Area': { value: rq.areaIn2, source: `${rq.breakdown} x {small,medium,large}InsertArea ${ri.areaIn2.small} / ${ri.areaIn2.medium} / ${ri.areaIn2.large} in²`, lookup: true },
      'Rib Insert Electrode Volume': {
        value: rq.electrodeIn3, lookup: true,
        source: `${rq.breakdown} x {small,medium,large}CalcRibInsertElectrodeSize ${ri.electrodeIn3.small} / ${ri.electrodeIn3.medium} / ${ri.electrodeIn3.large} in³ x num*InsertsBurns (one electrode per burn)`,
      },
      'Rib Insert Burned Volume': { value: rq.burnedIn3, source: `the electrode volume x edmElectrodeVolumeBurn ${ri.electrodeBurnFraction}` },
      'Rib Insert Design Hours': { value: rq.designHours, source: `${rq.breakdown} x cmDesignHrsRibInsert{Small,Medium,Large} ${ri.designHours.small} / ${ri.designHours.medium} / ${ri.designHours.large} h`, lookup: true },
      'Cutter Path Hours Per Insert': { value: ri.cutterPathHours, source: `${vars}: cutterPathHrsPerInsert`, ref: v('cutterPathHrsPerInsert') },
      'Spotting Hours Per Insert': { value: ri.spottingHours, source: `${vars}: spottingHrsPerInsert`, ref: v('spottingHrsPerInsert') },
      'Rib Insert Assembly Hours': withRef(
        { value: ri.assemblyHours, source: `${REF}/lookup/cmToolAssemblyTimes: Rib Insert`, lookup: true },
        rowNamed('cmToolAssemblyTimes', 'assembly_time_hr', f.tables.assemblyTimes, 'Rib Insert'),
      ),
      'Electrode Material Cost': {
        value: ri.electrodeUsdPerIn3, source: `${settings} edmMaterialCostCarbonUsdPerIn3 (graphite, the approved electrode material)`,
        ref: settingsRef('edmMaterialCostCarbonUsdPerIn3'),
      },
      'EDM Burn Rate': { value: ri.burnRateMm3PerMin, source: `${REF}/lookup/cmToolMachiningRates: EDM Electrode Burn`, lookup: true, ref: machiningRate('EDM Electrode Burn') },
      'EDM Rate': { value: f.toolroomRates.edmUsdPerHr, source: `${settings} edmRateUsdPerHr`, ref: settingsRef('edmRateUsdPerHr') },
      'Insert Pocket Rate': { value: ri.pocketRateMm3PerMin, source: `${REF}/lookup/cmToolMachiningRates: Insert Pocket Machining`, lookup: true, ref: machiningRate('Insert Pocket Machining') },
      'Insert Pocket Setup Hours': { value: ri.pocketSetupHours, source: `${REF}/lookup/cmToolMachiningSetups: Insert Pocket (setups x hours)`, lookup: true },
      'Hardening Applies': { value: st?.hardening ? 1 : 0, source: treatmentSource('heat_treatment_required', st?.hardening), lookup: true },
      'Stress Relief Applies': { value: st?.stressRelief ? 1 : 0, source: treatmentSource('stress_relief_required', st?.stressRelief), lookup: true },
      'Hot Drops': {
        value: f.runner === 'hot' ? f.cavityCount * f.gatesPerCavity : 0,
        source: f.runner === 'hot' ? `hot runner: ${f.cavityCount} cavit${f.cavityCount === 1 ? 'y' : 'ies'} x ${f.gatesPerCavity} gate(s) per cavity (defaultNumberOfGatesPerCavity), one drop per gate` : 'cold runner: no hot drops',
      },
      'Hot Drop Unit Cost': {
        value: x.hotDrop.usd, source: `${vars}: ${x.hotDrop.type === 'SVG' ? 'costPerSVGHotDrop' : 'costPerStandardHotDrop'} (defaultHotDropType ${x.hotDrop.type})`,
        ref: v(x.hotDrop.type === 'SVG' ? 'costPerSVGHotDrop' : 'costPerStandardHotDrop'),
      },
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
