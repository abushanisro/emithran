// The two process groups built layer by layer, priced by one engine (additive-route.ts): Additive Manufacturing (memory/Additive Manufacturing)
// and Rapid Prototyping (memory/Rapid prototyping). A domain is everything that differs between them: its reference data, materials,
// machines, calculators, the routes and post steps it runs, which machine builds and cures a material, and how its cleaning is timed. The
// route builder, the build direction, the nesting, the machine choice, the summary and the route comparison are shared.
import type { SandMachine } from '../casting/sand/sand-machines';
import type { SandReference } from '../casting/sand/sand-reference';

export type AdditiveRouteKey = 'metal_sintering' | 'laser_sintering' | 'printing' | 'resin_curing';

export interface AdditiveRouteDef {
  key: AdditiveRouteKey;
  label: string;
  /** The catalog process of the build step. */
  process: string;
  /** The material process that builds on it (the material's own: SLS, SLA, 3D Printing, DMLS). */
  materialProcess: string;
  machineClass: string;
  /** tblHandBreakoffRate's row for the route's support break-off; null: no break-off step. */
  breakoff: string | null;
}

/** The material as a route reads it (additive-route.ts AdditiveMaterial, minus the price columns). */
export interface DomainMaterial {
  name: string;
  materialType: string | null;
}

export interface AdditiveCalcNames {
  nesting: string;
  polymerMaterial: string;
  resinMaterial: string;
  gas: string;
  laserSintering: string;
  printing: string;
  resinCuring: string;
  partCuring: string;
  cleaning: string;
  /** Additive Manufacturing only: the metal route and its steps. */
  complexity?: string;
  metalMaterial?: string;
  metalSintering?: string;
  breakoff?: string;
  baseRemoval?: string;
  powderLoading?: string;
  sieving?: string;
  /** Rapid Prototyping only: one hole's or void's cleaning time, and the laser's own cost per hour of a build. */
  featureCleaning?: string;
  laserUse?: string;
}

export interface AdditiveDomain {
  /** The reference and calculator domain (memory-reference-domains.json key). */
  key: 'additive' | 'rapid_prototyping';
  processGroup: string;
  /** How notes and sources name it ("Additive variable slsLayerThickness"). */
  name: string;
  reference: { sourceVersion: string; label: string; stagedBy: number };
  /** The raw_materials group its materials are in. */
  materialGroup: string;
  /** The migration that writes its calculators, for the message when they are missing. */
  calculatorsMigration: string;
  routes: readonly AdditiveRouteDef[];
  classes: { partCuring: string; cleaning: string; sieving: string | null; powderLoading: string | null; baseRemoval: string | null; breakoff: string | null };
  calc: AdditiveCalcNames;
  /** Whether the machine builds the material; a reason when it does not. */
  machineBuilds(ref: SandReference, m: SandMachine, material: DomainMaterial, route: AdditiveRouteDef): string | null;
  buildCriterion: string;
  /** Whether a part of this material is post-cured after the route's build. */
  cured(route: AdditiveRouteDef, material: DomainMaterial): boolean;
  /** Whether the oven cures the material; a reason when it does not. */
  ovenCures(m: SandMachine, material: DomainMaterial): string | null;
  /** surface: blasted at the machine's rate over the part's surface; features: a time per hole and void (feature-cleaning.ts). */
  cleaning: 'surface' | 'features';
  /** The variable holding the base layers under an SLS build; null: none. */
  slsBaseVariable: string | null;
  /** The polymer powder calculator reads the powder's tapped density and recycling from additive_tblMaterialBuild. */
  powderLookups: boolean;
  /** The per-route price and density variables of a material that stands for "any material of the route" (memory's Default); null: none. */
  defaultMaterial: { matches(material: DomainMaterial): boolean; variables: Readonly<Record<string, { cost: string; density: string }>> } | null;
}

const flag = (m: SandMachine, key: string) => m.specs[key] === true || String(m.specs[key]).toLowerCase() === 'true';

// ── Additive Manufacturing ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The HR Rates machine classes of the additive routes' steps (migrations 793, 1070). */
export const ADDITIVE_CLASS = {
  metalSintering: 'metal_sintering', laserSintering: 'laser_sintering', printing: 'printing', resinCuring: 'resin_curing',
  partCuring: 'part_curing', breakoff: 'breakoff', powderLoading: 'powder_loading', baseRemoval: 'power_tool_base_removal',
  sieving: 'sieving', cleaning: 'cleaning',
} as const;

const ADDITIVE_CALC_NAME = (name: string) => `Additive - ${name}`;

export const ADDITIVE: AdditiveDomain = {
  key: 'additive',
  processGroup: 'Additive Manufacturing',
  name: 'Additive',
  reference: { sourceVersion: '2026-Additive', label: 'Additive Manufacturing', stagedBy: 823 },
  materialGroup: 'Additive Manufacturing',
  calculatorsMigration: '1073',
  routes: [
    { key: 'metal_sintering', label: 'Metal sintering (DMLS)', process: 'Metal Sintering', materialProcess: 'DMLS', machineClass: ADDITIVE_CLASS.metalSintering, breakoff: 'Direct Metal Laser Sintering' },
    { key: 'laser_sintering', label: 'Laser sintering (SLS)', process: 'Laser Sintering', materialProcess: 'SLS', machineClass: ADDITIVE_CLASS.laserSintering, breakoff: null },
    { key: 'printing', label: 'Material jetting', process: 'Printing', materialProcess: '3D Printing', machineClass: ADDITIVE_CLASS.printing, breakoff: 'Material Jetting' },
    { key: 'resin_curing', label: 'Stereolithography (SLA)', process: 'Resin Curing', materialProcess: 'SLA', machineClass: ADDITIVE_CLASS.resinCuring, breakoff: 'Stereolithography' },
  ],
  classes: {
    partCuring: ADDITIVE_CLASS.partCuring, cleaning: ADDITIVE_CLASS.cleaning, sieving: ADDITIVE_CLASS.sieving, powderLoading: ADDITIVE_CLASS.powderLoading,
    baseRemoval: ADDITIVE_CLASS.baseRemoval, breakoff: ADDITIVE_CLASS.breakoff,
  },
  calc: {
    nesting: ADDITIVE_CALC_NAME('Parts per build'), complexity: ADDITIVE_CALC_NAME('Melt complexity'), metalMaterial: ADDITIVE_CALC_NAME('Metal powder'),
    polymerMaterial: ADDITIVE_CALC_NAME('Polymer powder'), resinMaterial: ADDITIVE_CALC_NAME('Resin and support material'), gas: ADDITIVE_CALC_NAME('Build gas'),
    metalSintering: ADDITIVE_CALC_NAME('Metal sintering'), laserSintering: ADDITIVE_CALC_NAME('Laser sintering'), printing: ADDITIVE_CALC_NAME('Material jetting'),
    resinCuring: ADDITIVE_CALC_NAME('Stereolithography'), partCuring: ADDITIVE_CALC_NAME('Part curing'), breakoff: ADDITIVE_CALC_NAME('Support breakoff'),
    baseRemoval: ADDITIVE_CALC_NAME('Power tool base removal'), powderLoading: ADDITIVE_CALC_NAME('Powder loading'), sieving: ADDITIVE_CALC_NAME('Powder recovery'),
    cleaning: ADDITIVE_CALC_NAME('Cleaning'),
  },
  // A machine builds the material only when tblMaterialCompatibility lists it with that material.
  machineBuilds: (ref, m, material) => ref.table('tblMaterialCompatibility')
    .some((r) => r['Machine Name'] === m.name && String(r['Material Name'] ?? '').toLowerCase() === material.name.toLowerCase())
    ? null : `tblMaterialCompatibility does not list ${material.name} on it`,
  buildCriterion: 'tblMaterialCompatibility lists the material on it',
  cured: (route) => route.key === 'resin_curing',
  ovenCures: () => null,
  cleaning: 'surface',
  slsBaseVariable: 'slsBaseLayersHeight',
  powderLookups: true,
  defaultMaterial: null,
};

// ── Rapid Prototyping ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The HR Rates machine classes of Rapid Prototyping (migration 862, its India twins in the Rapid Prototyping machines migration). */
export const RAPID_PROTOTYPING_CLASS = {
  laserSintering: 'rapid_prototyping_laser_sintering', printing: 'rapid_prototyping_printing', resinCuring: 'rapid_prototyping_resin_curing',
  partCuring: 'rapid_prototyping_part_curing', cleaning: 'rapid_prototyping_cleaning',
} as const;

const RP_CALC_NAME = (name: string) => `Rapid Prototyping - ${name}`;

/** LaserForm (A6 Metal): sintered only on a machine that takes LaserForm, and cured in the LaserForm oven. V-Flash: its own printer only. */
const isLaserForm = (material: DomainMaterial) => (material.materialType ?? '').toLowerCase() === 'laserform';
const isVFlash = (material: DomainMaterial) => (material.materialType ?? '').toLowerCase() === 'v-flash';

export const RAPID_PROTOTYPING: AdditiveDomain = {
  key: 'rapid_prototyping',
  processGroup: 'Rapid Prototyping',
  name: 'Rapid Prototyping',
  reference: { sourceVersion: '2026-RapidProto', label: 'Rapid Prototyping', stagedBy: 863 },
  materialGroup: 'Rapid Prototyping',
  calculatorsMigration: '1105',
  // memory/Rapid prototyping/Processes: the build, then Cleaning, and Part Curing for a resin (and a LaserForm part). No sieving, no break-off.
  routes: [
    { key: 'laser_sintering', label: 'Laser sintering (SLS)', process: 'Laser Sintering', materialProcess: 'SLS', machineClass: RAPID_PROTOTYPING_CLASS.laserSintering, breakoff: null },
    { key: 'printing', label: '3D printing', process: 'Printing', materialProcess: '3D Printing', machineClass: RAPID_PROTOTYPING_CLASS.printing, breakoff: null },
    { key: 'resin_curing', label: 'Stereolithography (SLA)', process: 'Resin Curing', materialProcess: 'SLA', machineClass: RAPID_PROTOTYPING_CLASS.resinCuring, breakoff: null },
  ],
  classes: { partCuring: RAPID_PROTOTYPING_CLASS.partCuring, cleaning: RAPID_PROTOTYPING_CLASS.cleaning, sieving: null, powderLoading: null, baseRemoval: null, breakoff: null },
  calc: {
    nesting: RP_CALC_NAME('Parts per build'), polymerMaterial: RP_CALC_NAME('SLS powder'), resinMaterial: RP_CALC_NAME('Resin and support material'),
    gas: RP_CALC_NAME('Build gas'), laserSintering: RP_CALC_NAME('Laser sintering'), printing: RP_CALC_NAME('3D printing'), resinCuring: RP_CALC_NAME('Stereolithography'),
    partCuring: RP_CALC_NAME('Part curing'), cleaning: RP_CALC_NAME('Cleaning'), featureCleaning: RP_CALC_NAME('Feature cleaning'), laserUse: RP_CALC_NAME('Laser use'),
  },
  machineBuilds: (_ref, m, material, route) => {
    if (route.key === 'laser_sintering' && isLaserForm(material) && !flag(m, 'can_use_laserform_materials')) return `it does not take LaserForm materials (${material.name})`;
    if (route.key === 'printing' && isVFlash(material) !== flag(m, 'can_use_v_flash_material')) {
      return isVFlash(material) ? `${material.name} prints only on a V-Flash printer` : 'a V-Flash printer prints only V-Flash material';
    }
    return null;
  },
  buildCriterion: 'It takes the material (LaserForm on a LaserForm sinterer, V-Flash on its own printer)',
  cured: (route, material) => route.key === 'resin_curing' || (route.key === 'laser_sintering' && isLaserForm(material)),
  ovenCures: (m, material) => (isLaserForm(material) && !flag(m, 'can_cure_laserform_materials') ? `it does not cure LaserForm materials (${material.name})` : null),
  cleaning: 'features',
  slsBaseVariable: null,
  powderLookups: false,
  // memory/Rapid prototyping/Raw Materials "Default": "Add $50 for SLA, Add $100 for 3DP"; the variables hold each route's price and density.
  defaultMaterial: {
    matches: (material) => (material.materialType ?? '').toLowerCase() === 'default',
    variables: {
      laser_sintering: { cost: 'slsDefaultMaterialCost', density: 'slsDefaultMaterialDensity' },
      printing: { cost: 'printingDefaultMaterialCost', density: 'printingDefaultMaterialDensity' },
      resin_curing: { cost: 'slaDefaultMaterialCost', density: 'slaDefaultMaterialDensity' },
    },
  },
};

export const ADDITIVE_DOMAINS: readonly AdditiveDomain[] = [ADDITIVE, RAPID_PROTOTYPING];

/** Every HR Rates machine class a domain's routes and post steps use. */
export function domainMachineClasses(d: AdditiveDomain): string[] {
  return [...new Set([...d.routes.map((r) => r.machineClass), ...Object.values(d.classes).filter((c): c is string => c != null)])];
}

/** The domain a part is priced in: Rapid Prototyping when its Process is, else Additive Manufacturing. */
export function additiveDomainOf(processGroup: unknown): AdditiveDomain {
  return processGroup === RAPID_PROTOTYPING.processGroup ? RAPID_PROTOTYPING : ADDITIVE;
}
