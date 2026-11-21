// A part built layer by layer, priced on its domain's staged reference data and calculators (additive-domain.ts: Additive Manufacturing,
// migration 1073; Rapid Prototyping, migration 1105). Pure.
//
// The build is measured by cad-engine additive/feature_extractor.py: for each of the six axis directions the part could be built along, its
// height, footprint on the plate and, at each self-supporting angle, its overhang, support volume and plate contact. The direction is the
// Cost Guide's (additiveBuildDirection) or the one of least overhang at the material's own self-supporting angle (tblSelfSupportingAngles).
//
// A material is built by one process (its own: SLS, SLA, 3D Printing, DMLS), and only on the machines its domain says take it. The routes:
//   Additive Manufacturing
//     Metal sintering (DMLS)      Powder Loading, Metal Sintering, Sieving, Power Tool Base Removal, Breakoff, Cleaning
//     Laser sintering (SLS)       Laser Sintering, Sieving, Cleaning
//     Material jetting            Printing, Breakoff, Cleaning
//     Stereolithography (SLA)     Resin Curing, Breakoff, Cleaning, Part Curing
//   Rapid Prototyping (memory/Rapid prototyping/Processes)
//     Laser sintering (SLS)       Laser Sintering, Cleaning (Part Curing for a LaserForm part)
//     3D printing                 Printing, Cleaning
//     Stereolithography (SLA)     Resin Curing, Cleaning, Part Curing
// Each step on the cheapest capable machine of the location; the build's fixed steps are shared by the parts one build nests on the bed.
import type { FeatureOp, ProcessLineCost } from '../../dto/cost-breakdown.dto';
import type { CadEvidenceKey } from '../shared/cad-evidence';
import type { DomainCalculatorSpec } from '../shared/calculators/domain-calculator-spec';
import { runReferenceCalculator, type CalcSeed, type ReferenceCalcRun, type ReferenceCalculatorDef } from '../shared/calculators/reference-calculator';
import type { CostContext } from '../casting/casting-finishing';
import { machineValue, type SandMachine } from '../casting/sand/sand-machines';
import type { SandReference } from '../casting/sand/sand-reference';
import { seedsFor, type SeedProvider, type SeedProviders } from '../casting/sand/sand-seeds';
import { selectAndCost, type CostedStep, type StepOutcome } from '../casting/sand/sand-steps';
import type { AdditiveDomain, AdditiveRouteDef, AdditiveRouteKey } from './additive-domain';
import { CLEANING_RULES, type CleaningFeature } from './feature-cleaning';

export type { AdditiveRouteKey } from './additive-domain';

/** The six build directions the cad-engine measures. */
export const BUILD_AXES = ['+z', '-z', '+x', '-x', '+y', '-y'] as const;
export type BuildAxis = (typeof BUILD_AXES)[number];
const DEFAULT_SELF_SUPPORTING_DEG = 45;

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const fail = (...reasons: string[]): StepOutcome => ({ ok: false, reasons });
const isGap = (l: ProcessLineCost) => l.physicsGap != null;
type Row = Readonly<Record<string, unknown>>;

/** One build direction as measured (cad-engine additive candidates), at each self-supporting angle the reference names. */
export interface BuildCandidate {
  buildHeightMm: number;
  footprintMm: readonly [number, number];
  byAngle: Readonly<Record<string, { overhangAreaMm2: number; overhangProjectedAreaMm2: number; supportVolumeMm3: number; plateContactAreaMm2: number; overhangRegions: number }>>;
}

/** The part as the routes take it (cad-engine additive/feature_extractor.py, via auto-fill's additiveBuild). */
export interface AdditivePart {
  partVolumeMm3: number;
  surfaceAreaMm2: number;
  /** The direction the cad-engine chose (least support at 45 degrees, or the engineer's), whose faces the measurements name. */
  measuredAxis: BuildAxis;
  candidates: Readonly<Partial<Record<BuildAxis, BuildCandidate>>>;
  /** The holes and voids cleaning clears (feature-cleaning.ts); null when the analysis predates the voids. */
  cleaningFeatures: readonly CleaningFeature[] | null;
}

/** A material built layer by layer: its build process and powder properties, density and price. */
export interface AdditiveMaterial {
  id: string;
  name: string;
  grade: string;
  materialType: string | null;
  process: string | null;
  densityKgM3: number | null;
  costPerKgUsd: number | null;
  tappedDensityKgM3: number | null;
  maxPowderCycles: number | null;
  recycleFraction: number | null;
}

export interface AdditiveScenario {
  batchSize: number;
  route: AdditiveRouteKey | null;
  /** The Cost Guide's build direction; null: the one of least support at the material's angle. */
  buildAxis: BuildAxis | null;
}

export interface AdditiveRouteInput {
  domain: AdditiveDomain;
  ref: SandReference;
  spec: DomainCalculatorSpec;
  calculators: Readonly<Record<string, ReferenceCalculatorDef>>;
  material: AdditiveMaterial;
  part: AdditivePart;
  machinesByClass: Readonly<Record<string, readonly SandMachine[]>>;
  scenario: AdditiveScenario;
  costContext: CostContext;
}

export interface AdditiveBuild {
  axis: BuildAxis;
  source: 'engineer' | 'least_support';
  selfSupportingDeg: number;
  candidate: BuildCandidate;
}

/** One hole or void's cleaning time (Rapid Prototyping), as the Cost Guide lists it. */
export interface CleanedFeature {
  id: string;
  type: CleaningFeature['type'];
  label: string;
  size: number;
  measure: 'diameter' | 'volume';
  depthMm: number;
  timeSec: number;
}

export interface AdditiveRoute {
  key: AdditiveRouteKey;
  label: string;
  build: AdditiveBuild;
  lines: ProcessLineCost[];
  /** The material bought per part (massKg: the part, its supports and the powder spent) and the part's own mass. */
  material: { costUsd: number; massKg: number; partKg: number; supportVolumeMm3: number; runs: Record<string, ReferenceCalcRun> };
  partsPerBuild: number | null;
  layers: number | null;
  /** The holes and voids cleaning timed (Rapid Prototyping); empty when its cleaning is by surface. */
  cleaned: CleanedFeature[];
  totalUsd: number | null;
  complete: boolean;
  warnings: string[];
}

export interface AdditiveRouteGap { key: AdditiveRouteKey; label: string; reason: string }

/** The material's self-supporting angle (tblSelfSupportingAngles by Material Type); the larger default for a material the table does not list. */
export function selfSupportingAngle(ref: SandReference, materialType: string | null): { deg: number; source: string } {
  const row = ref.table('tblSelfSupportingAngles').find((r) => String(r['Material Type'] ?? '').toLowerCase() === (materialType ?? '').toLowerCase());
  const deg = Number(row?.['Min Self Supporting Angle (deg)']);
  return Number.isFinite(deg) && deg > 0
    ? { deg, source: `tblSelfSupportingAngles (${materialType})` }
    : { deg: DEFAULT_SELF_SUPPORTING_DEG, source: `${DEFAULT_SELF_SUPPORTING_DEG} degrees: tblSelfSupportingAngles lists no ${materialType ?? 'material type'}` };
}

/** The build: the Cost Guide's direction, else the one of least overhang at the angle (of equal ones, within 2 %, the lowest). */
export function chooseBuild(part: AdditivePart, angleDeg: number, forced: BuildAxis | null): AdditiveBuild | null {
  const key = String(Math.round(angleDeg));
  const measured = BUILD_AXES.filter((a) => part.candidates[a]?.byAngle[key]);
  if (measured.length === 0) return null;
  if (forced && part.candidates[forced]?.byAngle[key]) return { axis: forced, source: 'engineer', selfSupportingDeg: angleDeg, candidate: part.candidates[forced]! };
  const area = (a: BuildAxis) => part.candidates[a]!.byAngle[key]!.overhangAreaMm2;
  const least = Math.min(...measured.map(area));
  const near = measured.filter((a) => area(a) <= least + Math.max(1e-6, least * 0.02));
  const axis = near.sort((a, b) => part.candidates[a]!.buildHeightMm - part.candidates[b]!.buildHeightMm || BUILD_AXES.indexOf(a) - BUILD_AXES.indexOf(b))[0]!;
  return { axis, source: 'least_support', selfSupportingDeg: angleDeg, candidate: part.candidates[axis]! };
}

/** Every route of the part (each complete or with its gaps), the routes it cannot take and why, and what keeps any route from being built. */
export function buildAdditiveRoutes(input: AdditiveRouteInput): { routes: AdditiveRoute[]; gaps: AdditiveRouteGap[]; missing: string[] } {
  const { domain, ref, part, scenario, material } = input;
  const C = domain.calc;
  const none = (...missing: string[]) => ({ routes: [], gaps: [], missing });
  const num = (name: string) => ref.number(name);
  const defaults = domain.defaultMaterial?.matches(material) ? domain.defaultMaterial : null;
  if (!defaults && (material.densityKgM3 == null || !(material.densityKgM3 > 0))) return none(`${material.name}: its density`);
  if (!defaults && (material.costPerKgUsd == null || !(material.costPerKgUsd > 0))) return none(`${material.name}: its price per kg (cost_usa)`);
  const angle = selfSupportingAngle(ref, material.materialType);
  const build = chooseBuild(part, angle.deg, scenario.buildAxis);
  if (!build) return none(`the build measurements at ${angle.deg} degrees: press Refresh analysis so the part is measured for its build`);
  const at = build.candidate.byAngle[String(Math.round(angle.deg))]!;
  const [footLong, footShort] = [Math.max(...build.candidate.footprintMm), Math.min(...build.candidate.footprintMm)];
  // The calculator dialog's eye highlights the faces a measurement was taken on; they are the cad-engine's own direction's, at 45 degrees.
  const measuredHere = build.axis === part.measuredAxis && Math.round(angle.deg) === DEFAULT_SELF_SUPPORTING_DEG;
  const cadSeed = (value: number, source: string, evidence: CadEvidenceKey): CalcSeed => ({ value, source, ...(measuredHere ? { ref: { kind: 'cad' as const, evidence } } : {}) });
  const cad: Record<string, CalcSeed | undefined> = {
    build_height: cadSeed(build.candidate.buildHeightMm, `build height along ${build.axis} (mm)`, 'build_height'),
    footprint_length: cadSeed(footLong, 'footprint on the plate, long side (mm)', 'footprint_length'),
    footprint_width: cadSeed(footShort, 'footprint on the plate, short side (mm)', 'footprint_width'),
    part_volume: { value: part.partVolumeMm3, source: "the solid's volume (mm³)", ref: { kind: 'cad', evidence: 'part_volume' } },
    surface_area: { value: part.surfaceAreaMm2, source: 'every face of the part (mm²)', ref: { kind: 'cad', evidence: 'part_surface' } },
    overhang_regions: { value: at.overhangRegions, source: `overhanging faces needing support at ${angle.deg} degrees` },
    overhang_area: cadSeed(at.overhangAreaMm2, `overhang flatter than ${angle.deg} degrees (mm²)`, 'overhang_area'),
    plate_contact_area: cadSeed(at.plateContactAreaMm2, 'the faces on the plate and the overhang seen from below (mm²)', 'plate_contact_area'),
  };

  // ── Seeding: every input from its declared source; the key before a " (" note is the value's name ──────────────────────────────────
  const named = (values: Readonly<Record<string, CalcSeed | undefined>>): SeedProvider => (key) => values[key.split(' (')[0]!.trim()] ?? values[key] ?? null;
  const variableSeed = (name: string): CalcSeed | null => {
    const value = num(name);
    return value == null ? null : { value, source: `${domain.name} variable ${name}${ref.unit(name) ? ` (${ref.unit(name)})` : ''}`, ref: { kind: 'variable', domain: domain.key, name } };
  };
  const variable: SeedProvider = (name) => variableSeed(name);
  // The material a route prices: the material's own density and price, or (memory's Default material) the route's default ones.
  let current: { density: CalcSeed | null; cost: CalcSeed | null } = { density: null, cost: null };
  const materialSeeds = (r: AdditiveRouteDef): { density: CalcSeed | null; cost: CalcSeed | null } => {
    if (defaults) {
      const v = defaults.variables[r.key];
      return v ? { density: variableSeed(v.density), cost: variableSeed(v.cost) } : { density: null, cost: null };
    }
    const own = (value: number, label: string, column: string): CalcSeed => ({ value, source: `${material.name}: ${label}`, ref: { kind: 'material', materialId: material.id, materialName: material.name, column } });
    return { density: own(material.densityKgM3!, 'density (kg/m³)', 'density_kg_m3'), cost: own(material.costPerKgUsd!, 'price (USD/kg)', 'cost') };
  };
  const materialProvider: SeedProvider = (column) => (column === 'density_kg_m3' ? current.density : column === 'cost' ? current.cost : null);
  type Run = { run: ReferenceCalcRun } | { reasons: string[] };
  const run = (calculator: string, machine: SandMachine | null, engine: Record<string, CalcSeed | undefined>, lookups: Record<string, CalcSeed | undefined> = {}): Run => {
    const calc = input.spec.calculators.find((c) => c.name === calculator);
    if (!calc) return { reasons: [`${calculator} is not in the calculator spec`] };
    const providers: SeedProviders = {
      variable, cad: named(cad), engine: named(engine), lookup: named(lookups), scenario: named({ batch_size: { value: scenario.batchSize, source: 'batch size' } }),
      material: materialProvider,
      machine: (key) => {
        const value = machine ? machineValue(machine, key) : null;
        return value == null || !machine ? null : {
          value, source: `machine ${machine.name}: ${key}`,
          ref: { kind: 'machine', machineId: machine.id, machineName: machine.name, machineClass: machine.machineClass, location: machine.location, column: key },
        };
      },
    };
    const { seeds, missing } = seedsFor(calc, providers);
    if (missing.length) return { reasons: missing.map((m) => `${calculator}: ${m}`) };
    const result = runReferenceCalculator(input.calculators, calculator, seeds, calc.output ?? 'Cycle Time');
    return result.value == null ? { reasons: result.missing } : { run: result };
  };
  const seed = (value: number, source: string): CalcSeed => ({ value, source });
  const lookupSeed = (table: string, row: Row | undefined, column: string, identity: readonly string[]): CalcSeed | undefined => {
    if (!row || row[column] == null || !Number.isFinite(Number(row[column]))) return undefined;
    const id = Object.fromEntries(identity.map((c) => [c, row[c] as string | number]));
    return {
      value: Number(row[column]), source: `${table} (${identity.map((c) => `${c} ${row[c]}`).join(', ')}): ${column}`, lookup: true, match: { table, row: id },
      ref: { kind: 'lookup', domain: domain.key, table, column, row: id },
    };
  };
  const step = (process: string, machineClass: string, evaluate: (m: SandMachine) => StepOutcome, criteria: string[]): CostedStep =>
    selectAndCost({
      process, machineClass, machines: input.machinesByClass[machineClass] ?? [], evaluate, criteria,
      batchSize: scenario.batchSize, costContext: input.costContext, ref, partName: 'part', processGroup: domain.processGroup,
    });
  const timed = (calculator: string, m: SandMachine, engine: Record<string, CalcSeed | undefined>, lookups: Record<string, CalcSeed | undefined> = {}, extra: Record<string, unknown> = {}): StepOutcome => {
    const r = run(calculator, m, engine, lookups);
    return 'run' in r ? { ok: true, sec: r.run.value!, run: r.run, energyCostUsd: 0, notes: [], ...extra } as StepOutcome : fail(...r.reasons);
  };
  /** The consumables a build spends per part: the machine's nitrogen and (Rapid Prototyping) its laser's cost per hour. */
  const consumables = (m: SandMachine, buildTime: number, parts: CalcSeed, from: string): number => {
    const time = seed(buildTime, `the build time (${from})`);
    const gas = run(C.gas, m, { build_time_s: time, parts_per_build: parts });
    const laser = C.laserUse ? run(C.laserUse, m, { build_time_s: time, parts_per_build: parts }) : null;
    return ('run' in gas ? gas.run.value! : 0) + (laser && 'run' in laser ? laser.run.value! : 0);
  };

  const allowance = num('nestingAllowance') ?? 0;
  /** How the part nests on a bed (the domain's Parts per build), or why it does not fit. */
  const nest = (m: SandMachine, buildHeight: number, stacks: boolean, baseHeight: number): { run: ReferenceCalcRun } | { reasons: string[] } => {
    const bedH = machineValue(m, 'bed_height_mm');
    if (bedH != null && buildHeight + baseHeight > bedH) return { reasons: [`the ${r2(buildHeight)} mm build is taller than its ${bedH} mm bed${baseHeight ? ` (with the ${baseHeight} mm base)` : ''}`] };
    const r = run(C.nesting, m, {
      build_height_mm: seed(buildHeight, 'the build height (mm)'), stacks: seed(stacks ? 1 : 0, stacks ? 'a powder bed stacks the parts' : 'one layer of parts on the plate'),
      base_height_mm: seed(baseHeight, baseHeight ? (domain.slsBaseVariable ?? 'base layers') : 'no base layers'),
    });
    if ('reasons' in r) return r;
    if (!((r.run.outputs['Parts per Layer'] ?? 0) >= 1)) return { reasons: [`the ${r2(footLong)} x ${r2(footShort)} mm footprint (with the ${allowance} mm nesting allowance) does not fit its ${machineValue(m, 'bed_length_mm')} x ${machineValue(m, 'bed_width_mm')} mm bed`] };
    return r;
  };

  // ── Cleaning: by surface (Additive), or per hole and void (Rapid Prototyping) ────────────────────────────────────────────────────────
  const cleaned: CleanedFeature[] = [];
  const cleaningRuns: string[] = [];
  if (domain.cleaning === 'features' && C.featureCleaning && part.cleaningFeatures) {
    for (const f of part.cleaningFeatures) {
      const rule = CLEANING_RULES[f.type];
      const v = (name: string) => variableSeed(name) ?? undefined;
      const r = run(C.featureCleaning, null, {
        base_time_s: v(rule.base), size: seed(f.size, rule.measure === 'diameter' ? `${f.id}: diameter (mm)` : `${f.id}: volume (mm³)`),
        size_small_limit: v(rule.size.smallLimit), size_large_limit: v(rule.size.largeLimit),
        size_small_multiplier: v(rule.size.small), size_medium_multiplier: v(rule.size.medium), size_large_multiplier: v(rule.size.large),
        depth_mm: seed(f.depthMm, `${f.id}: depth (mm)`), depth_small_limit: v(rule.depth.smallLimit), depth_large_limit: v(rule.depth.largeLimit),
        depth_small_multiplier: v(rule.depth.small), depth_medium_multiplier: v(rule.depth.medium), depth_large_multiplier: v(rule.depth.large),
      });
      if ('reasons' in r) {
        cleaningRuns.push(...r.reasons);
        continue;
      }
      cleaned.push({ id: f.id, type: f.type, label: rule.label, size: r2(f.size), measure: rule.measure, depthMm: r2(f.depthMm), timeSec: r2(r.run.value!) });
    }
  }
  const featureSeconds = cleaned.reduce((s, f) => s + f.timeSec, 0);
  const cleaningStep = (): CostedStep => step('Cleaning', domain.classes.cleaning, (m) => {
    if (domain.cleaning === 'surface') return timed(C.cleaning, m, {});
    if (!part.cleaningFeatures) return fail('the holes and voids to clean: press Refresh analysis so the part is analysed for them');
    if (cleaningRuns.length) return fail(...cleaningRuns);
    return timed(C.cleaning, m, { feature_time_s: seed(r2(featureSeconds), `${cleaned.length} hole(s) and void(s): ${C.featureCleaning} each`) });
  }, domain.cleaning === 'surface' ? ['A cleaning rate'] : ['Any cleaning station']);

  const routes: AdditiveRoute[] = [];
  const gaps: AdditiveRouteGap[] = [];
  // The build (its direction, height and supports) is shown in the Cost Guide's panel (summary.additive), not as a warning.
  const warnings: string[] = [];
  const breakoffRates = ref.table('tblHandBreakoffRate');
  for (const r of domain.routes) {
    if (!defaults && material.process !== r.materialProcess) {
      gaps.push({ key: r.key, label: r.label, reason: material.process ? `${material.name} is built by ${material.process}, not by ${r.process}` : `${material.name} has no build process` });
      continue;
    }
    current = materialSeeds(r);
    if (!current.density || !current.cost) {
      gaps.push({ key: r.key, label: r.label, reason: `${material.name}: no ${r.label} default price and density in the ${domain.name} variables` });
      continue;
    }
    const density = current.density.value;
    const dmls = r.key === 'metal_sintering';
    const sls = r.key === 'laser_sintering';
    const baseSupport = dmls ? num('baseSupportHeightPowerRemoval') ?? 0 : 0;
    // The supports: the overhang's columns and, under a metal part, the support base it is cut off along.
    const supportVolume = sls ? 0 : at.supportVolumeMm3 + (dmls ? at.plateContactAreaMm2 * baseSupport : 0);
    const supportSeed = seed(supportVolume, dmls ? `overhang supports and the ${baseSupport} mm support base under the part (mm³)` : sls ? 'none: a powder bed holds the part' : 'overhang supports (mm³)');

    // ── The build step: the part nested on the machine's bed ───────────────────────────────────────────────────────────────────────────
    let partsPerBuild: number | null = null;
    let layers: number | null = null;
    let bedPowderKg = 0;
    let chosenBuild: SandMachine | null = null;
    let materialRun: ReferenceCalcRun | null = null;
    const slsBase = domain.slsBaseVariable ? num(domain.slsBaseVariable) ?? 0 : 0;
    const buildStep = step(r.process, r.machineClass, (m) => {
      const refused = domain.machineBuilds(ref, m, material, r);
      if (refused) return fail(refused);
      const height = build.candidate.buildHeightMm + baseSupport;
      const n = nest(m, height, sls, sls ? slsBase : 0);
      if ('reasons' in n) return fail(...n.reasons);
      const perLayer = n.run.outputs['Parts per Layer']!;
      const parts = n.run.value!;
      const nestSeed = seed(parts, `${parts} parts per build (${C.nesting}: ${perLayer} per layer${sls ? `, ${n.run.outputs['Parts Stacked']} stacked` : ''})`);
      const bedL = machineValue(m, 'bed_length_mm') ?? 0;
      const bedW = machineValue(m, 'bed_width_mm') ?? 0;
      if (dmls && C.complexity && C.metalMaterial && C.metalSintering) {
        const machineMin = machineValue(m, 'minimum_layer_thickness_mm');
        const tableMin = Number(ref.table('tblLayerThickness').find((x) => x['Process Name'] === 'Metal Sintering')?.['Minimum Layer Thickness (mm)']);
        const t = Math.max(machineMin ?? 0, Number.isFinite(tableMin) ? tableMin : 0);
        if (!(t > 0)) return fail('no layer thickness: the machine has no minimum and tblLayerThickness has no Metal Sintering row');
        const cx = run(C.complexity, m, {});
        if ('reasons' in cx) return fail(...cx.reasons);
        const mat = run(C.metalMaterial, m, { support_volume_mm3: supportSeed });
        if ('reasons' in mat) return fail(...mat.reasons);
        const out = timed(C.metalSintering, m, {
          layer_thickness_mm: seed(t, `the machine's minimum layer, not below tblLayerThickness Metal Sintering (${t} mm)`),
          melted_volume_mm3: seed(mat.run.outputs['Melted Volume']!, `the part and its lattice supports (${C.metalMaterial})`),
          complexity_factor: seed(cx.run.value!, `melt complexity (surface over volume ${r3(cx.run.outputs['Melting Modulus'] ?? 0)} per mm)`),
          parts_per_build: nestSeed,
        });
        if (!out.ok) return out;
        return { ...out, materialCostUsd: consumables(m, out.run.outputs['Build Time']!, nestSeed, C.metalSintering), parts, layers: out.run.outputs.Layers, materialRun: mat.run,
          bedKg: (bedL * bedW * (out.run.outputs.Layers! * t) * (material.tappedDensityKgM3 ?? density)) / 1e9 } as StepOutcome;
      }
      if (sls) {
        const t = num('slsLayerThickness') ?? 0;
        const stackedRows = Math.ceil(parts / Math.max(1, perLayer));
        const fill = Math.min(machineValue(m, 'bed_height_mm') ?? Infinity, stackedRows * (build.candidate.buildHeightMm + 2 * allowance) + slsBase);
        const fillSeed = seed(fill, `${stackedRows} stacked row(s) of ${r2(build.candidate.buildHeightMm + 2 * allowance)} mm${slsBase ? ` over the ${slsBase} mm base layers` : ''}`);
        const out = timed(C.laserSintering, m, { bed_fill_height_mm: fillSeed, parts_per_build: nestSeed });
        if (!out.ok) return out;
        const powder = domain.powderLookups ? ref.table('additive_tblMaterialBuild').find((x) => x['Grade'] === material.grade) : undefined;
        const mat = run(C.polymerMaterial, m, { bed_fill_height_mm: fillSeed, parts_per_build: nestSeed }, domain.powderLookups ? {
          'additive_tblMaterialBuild.Tapped Density (kg / m^3)': lookupSeed('additive_tblMaterialBuild', powder, 'Tapped Density (kg / m^3)', ['Grade']),
          'additive_tblMaterialBuild.Recycle Percentage': lookupSeed('additive_tblMaterialBuild', powder, 'Recycle Percentage', ['Grade']),
          'additive_tblMaterialBuild.Max Powder Cycles': lookupSeed('additive_tblMaterialBuild', powder, 'Max Powder Cycles', ['Grade']),
        } : {});
        if ('reasons' in mat) return fail(...mat.reasons);
        return { ...out, materialCostUsd: consumables(m, out.run.outputs['Build Time']!, nestSeed, C.laserSintering), parts, layers: out.run.outputs.Layers, materialRun: mat.run,
          bedKg: (bedL * bedW * fill * (material.tappedDensityKgM3 ?? density)) / 1e9 } as StepOutcome;
      }
      const printing = r.key === 'printing';
      const perRow = Math.max(1, Math.floor(bedL / (footLong + 2 * allowance)));
      const nestedLength = Math.min(bedL, Math.min(parts, perRow) * (footLong + 2 * allowance));
      const nestedWidth = Math.min(bedW, Math.ceil(parts / perRow) * (footShort + 2 * allowance));
      const lattice = num('printingLatticeSpacingFactor');
      const mat = run(C.resinMaterial, m, {
        support_volume_mm3: supportSeed,
        support_fill: printing
          ? (lattice != null ? { value: lattice, source: `${domain.name} variable printingLatticeSpacingFactor` } : seed(1, `solid supports: the ${domain.name} variables hold no printingLatticeSpacingFactor`))
          : { value: num('slaSupportVolumeFraction') ?? 0, source: `${domain.name} variable slaSupportVolumeFraction` },
        support_density: printing ? { value: num('printingSupportMaterialDensity') ?? 0, source: `${domain.name} variable printingSupportMaterialDensity` } : { ...current.density!, source: `${current.density!.source} (the supports are of the resin)` },
        support_unit_cost: printing ? { value: num('printingSupportMaterialCost') ?? 0, source: `${domain.name} variable printingSupportMaterialCost` } : { ...current.cost!, source: `${current.cost!.source} (the supports are of the resin)` },
      });
      if ('reasons' in mat) return fail(...mat.reasons);
      const out = printing
        ? timed(C.printing, m, {
          nested_length_mm: seed(nestedLength, `${Math.min(parts, perRow)} part(s) along the bed (mm)`), nested_width_mm: seed(nestedWidth, `${Math.ceil(parts / perRow)} row(s) across the bed (mm)`),
          parts_per_build: nestSeed,
        })
        : timed(C.resinCuring, m, { support_volume_mm3: supportSeed, parts_per_build: nestSeed });
      if (!out.ok) return out;
      const extra = printing || !C.laserUse ? 0 : consumables(m, out.run.outputs['Build Time']!, nestSeed, C.resinCuring);
      return { ...out, ...(extra ? { materialCostUsd: extra } : {}), parts, layers: out.run.outputs.Layers, materialRun: mat.run } as StepOutcome;
    }, [domain.buildCriterion, 'The build fits its bed (footprint with the nesting allowance, height)']);
    const bo = buildStep.outcome as (Extract<StepOutcome, { ok: true }> & { parts?: number; layers?: number; materialRun?: ReferenceCalcRun; bedKg?: number }) | null;
    if (bo) {
      partsPerBuild = bo.parts ?? null; layers = bo.layers ?? null; bedPowderKg = bo.bedKg ?? 0;
      chosenBuild = buildStep.machine; materialRun = bo.materialRun ?? null;
    }
    const partsSeed = seed(partsPerBuild ?? 1, partsPerBuild != null ? `${partsPerBuild} parts per build on ${chosenBuild?.name ?? 'the build machine'}` : 'one part (the build step has no machine)');

    // ── Post steps ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    const { classes } = domain;
    const steps: Array<{ s: CostedStep; kind: 'build' | 'support' | 'whole' | 'features' }> = [];
    if (dmls && classes.powderLoading && C.powderLoading) {
      steps.push({ s: step('Powder Loading', classes.powderLoading, (m) => timed(C.powderLoading!, m, { parts_per_build: partsSeed }), ['Any loader']), kind: 'whole' });
    }
    steps.push({ s: buildStep, kind: 'build' });
    if ((dmls || sls) && classes.sieving && C.sieving) {
      steps.push({ s: step('Sieving', classes.sieving, (m) => timed(C.sieving!, m, {
        bed_powder_mass_kg: seed(r3(bedPowderKg), `the bed's powder: its area times the build's height at the tapped density (${r3(bedPowderKg)} kg)`), parts_per_build: partsSeed,
      }), ['Any sieve']), kind: 'whole' });
    }
    if (dmls && classes.baseRemoval && C.baseRemoval) steps.push({ s: step('Power Tool Base Removal', classes.baseRemoval, (m) => timed(C.baseRemoval!, m, {}), ['A cutting rate']), kind: 'support' });
    if (r.breakoff && at.overhangRegions > 0 && classes.breakoff && C.breakoff) {
      const row = breakoffRates.find((x) => x['Process Name'] === r.breakoff);
      steps.push({ s: step('Breakoff', classes.breakoff, (m) => timed(C.breakoff!, m, {}, {
        'tblHandBreakoffRate.Hand Breakoff Rate (mm^2 / s)': lookupSeed('tblHandBreakoffRate', row, 'Hand Breakoff Rate (mm^2 / s)', ['Process Name']),
      }), ['Any break-off bench']), kind: 'support' });
    }
    steps.push({ s: cleaningStep(), kind: domain.cleaning === 'features' && cleaned.length ? 'features' : 'whole' });
    if (domain.cured(r, material)) {
      steps.push({ s: step('Part Curing', classes.partCuring, (m) => {
        const refused = domain.ovenCures(m, material);
        if (refused) return fail(refused);
        const n = nest(m, build.candidate.buildHeightMm, false, 0);
        if ('reasons' in n) return fail(...n.reasons);
        return timed(C.partCuring, m, { parts_per_load: seed(n.run.value!, `${n.run.value} parts per oven load (${C.nesting} on the oven)`) });
      }, ['The oven takes the part']), kind: 'whole' });
    }

    const supportOps: FeatureOp[] = at.overhangRegions > 0 ? [{ name: 'Support structure', featureType: 'SupportStructure', timeSec: 0, count: at.overhangRegions, featureIds: ['support-structure'] }] : [];
    const cleaningOps: FeatureOp[] = cleaned.map((f) => ({ name: `${f.label} cleaning`, featureType: f.type === 'ComplexVoid' ? 'Void' : f.type, timeSec: f.timeSec, count: 1, featureIds: [f.id] }));
    const lines: ProcessLineCost[] = steps.map(({ s, kind }) => kind === 'build'
      ? { ...s.line, formsPartFeatures: true }
      : kind === 'support' && supportOps.length ? { ...s.line, featureBreakdown: supportOps.map((o) => ({ ...o, timeSec: r2((s.line.cycleTimeMin ?? 0) * 60) })) }
        : kind === 'features' && !isGap(s.line) ? { ...s.line, featureBreakdown: cleaningOps } : { ...s.line, actsOnWholePart: true });
    const complete = !lines.some(isGap) && materialRun != null;
    const materialCost = materialRun?.value ?? 0;
    const massKg = materialRun ? (materialRun.outputs['Powder Mass'] ?? ((materialRun.outputs['Part Mass'] ?? 0) + (materialRun.outputs['Spent Powder Mass'] ?? 0) + (materialRun.outputs['Support Mass'] ?? 0))) : 0;
    routes.push({
      key: r.key, label: r.label, build, lines,
      material: { costUsd: materialCost, massKg: r3(massKg), partKg: r3((part.partVolumeMm3 * density) / 1e9), supportVolumeMm3: r2(supportVolume), runs: materialRun ? { material: materialRun } : {} },
      partsPerBuild, layers, cleaned, totalUsd: complete ? r2(materialCost + lines.reduce((s, l) => s + l.totalCost, 0)) : null, complete,
      warnings: [...warnings, ...steps.flatMap(({ s }) => s.warnings), ...(materialRun ? [] : [`${r.label}: the material is not costed (the build step has no machine).`])],
    });
  }
  return { routes, gaps, missing: [] };
}

/** The route to quote: the one set in the Cost Guide when it is a route for the part, else the cheapest complete one; and a note saying which and why. */
export function chooseAdditiveRoute(domain: AdditiveDomain, routes: readonly AdditiveRoute[], gaps: readonly AdditiveRouteGap[], chosen: AdditiveRouteKey | null): { route: AdditiveRoute | null; note: string | null } {
  if (routes.length === 0) return { route: null, note: null };
  const money = (n: number) => `${n.toFixed(2)} USD`;
  const said = (r: AdditiveRoute) => (r.complete ? `${r.label} ${money(r.totalUsd!)}` : `${r.label} incomplete (${r.lines.filter(isGap).map((l) => l.process).join(', ') || 'material'})`);
  const others = (pick: AdditiveRoute) => [...routes.filter((r) => r !== pick).map(said), ...gaps.map((g) => `${g.label} not a route for this part (${g.reason})`)].join('; ');
  const user = chosen ? routes.find((r) => r.key === chosen) : undefined;
  if (user) return { route: user, note: `${domain.name}: ${user.label} is set in the Cost Guide. ${others(user)}.` };
  const complete = routes.filter((r) => r.complete).sort((a, b) => a.totalUsd! - b.totalUsd!);
  const pick = complete[0] ?? [...routes].sort((a, b) => a.lines.filter(isGap).length - b.lines.filter(isGap).length)[0]!;
  const why = complete[0] ? 'the cheapest complete route (material and process per part)' : 'no route is complete: the one with the fewest gaps';
  const own = pick.complete ? ` (${money(pick.totalUsd!)} per part)` : '';
  return { route: pick, note: `${domain.name}: ${pick.label} is quoted${own}, ${why}.${others(pick) ? ` ${others(pick)}.` : ''}` };
}
