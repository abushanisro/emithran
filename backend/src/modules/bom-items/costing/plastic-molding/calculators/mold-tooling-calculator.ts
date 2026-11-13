/**
 * The injection mold tooling cost, by its stored calculator (plastic-molding-calculators.json "Injection Mold - Tooling", migration 1012). The engine
 * supplies what the staged reference says for this mold (mold-tooling-engine.ts: which components, their subtotal, the design and assembly hours) and
 * the scenario; every price, hour and amortization step is a formula of the calculator, shown on the line and changeable for a part.
 */
import type { CalculationTraceStep } from '../../../dto/cost-breakdown.dto';
import { runReferenceCalculator, type CalcSeed, type ReferenceCalculators } from '../../shared/calculators/reference-calculator';
import type { MoldBaseReference, MoldToolingTables } from '../plastic-reference';
import type { MoldBaseChoice } from '../process/mold-base';
import { calculatorFingerprint, requirePlasticCalculator, withRegistryFormulas } from './plastic-cycle-time';

export const MOLD_TOOLING_CALCULATOR = 'Injection Mold - Tooling';
const OUTPUT = 'Tooling Cost Per Part';
const REF = 'memory/Plastic Modeling';

export interface MoldToolingFacts {
  /** The standard components the mold needs, priced (mold-tooling-engine.ts). */
  components: ReadonlyArray<{ componentName: string; qty: number; unitCostUsd: number }>;
  componentsSubtotalUsd: number;
  moldBaseAreaMm2: number;
  designHours: number;
  assemblyHours: number;
  tables: MoldToolingTables;
  /** The quote location's toolroom rates; null when memory/ holds none for it (USA only). */
  toolroomRates: { designUsdPerHr: number; machiningUsdPerHr: number; assemblyUsdPerHr: number } | null;
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
  if (missing.length > 0 || !f.toolroomRates || 'missing' in f.moldBase) return { missing };
  const b = f.moldBase;
  const mb = f.moldBaseRef;
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
