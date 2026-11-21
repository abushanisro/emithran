// A blow molded or rotomolded part's routes, priced on the staged memory/Roto & blow molding data and the Roto & Blow Molding calculators
// (migration 1108). Pure.
//
// The part is measured by cad-engine roto_blow/feature_extractor.py: a hollow shell's wall, the air it closes in, its spout, parting line and
// envelope, holes and voids. Its features take their operations by the reference's thresholds (roto-blow-features.ts). The routes:
//   Extrusion blow molding   Extrusion Blow Mold (cavities on the mold, dry cycle + inflate + cooling), Router (pinch-off, openings), Saw (moil)
//   Rotational molding       Grind (pellets to powder), Rotational Mold (carousel: oven, cooling, load station; molds per arm)
// A material is blow molded or rotomolded as memory/Roto & blow molding/Raw materials says; a route the material cannot take, or the part does
// not fit, is not a route for it. Each step on the cheapest capable machine of the location. The molds are tooling, kept out of the piece cost.
import type { ProcessLineCost } from '../../dto/cost-breakdown.dto';
import type { CadEvidenceKey } from '../shared/cad-evidence';
import type { DomainCalculatorSpec } from '../shared/calculators/domain-calculator-spec';
import { runReferenceCalculator, type CalcSeed, type ReferenceCalcRun, type ReferenceCalculatorDef } from '../shared/calculators/reference-calculator';
import type { CostContext } from '../casting/casting-finishing';
import { machineValue, type SandMachine } from '../casting/sand/sand-machines';
import type { SandReference } from '../casting/sand/sand-reference';
import { seedsFor, type SeedProvider, type SeedProviders } from '../casting/sand/sand-seeds';
import { selectAndCost, type CostedStep, type StepOutcome } from '../casting/sand/sand-steps';
import { featureOperations, type FeatureOp, type FeatureRules, type RotoBlowHole, type RotoBlowRouteKey, type RotoBlowSpout, type RotoBlowVoid } from './roto-blow-features';

export type { RotoBlowRouteKey } from './roto-blow-features';

export const ROTO_BLOW_DOMAIN = 'roto_blow';
export const ROTO_BLOW_PROCESS_GROUP = 'Roto & Blow Molding';

/** The HR Rates machine classes of the process group (migration 862, its India twins migration 1106). */
export const ROTO_BLOW_CLASS = {
  blow: 'roto_blow_molding_extrusion_blow_mold', roto: 'roto_blow_molding_rotational_mold', router: 'roto_blow_molding_router',
  saw: 'roto_blow_molding_saw', grind: 'roto_blow_molding_grind',
} as const;
export const ROTO_BLOW_ROUTE_CLASSES: readonly string[] = Object.values(ROTO_BLOW_CLASS);

export const ROTO_BLOW_ROUTES = [
  { key: 'blow', label: 'Extrusion blow molding', process: 'Extrusion Blow Mold', machineClass: ROTO_BLOW_CLASS.blow },
  { key: 'roto', label: 'Rotational molding', process: 'Rotational Mold', machineClass: ROTO_BLOW_CLASS.roto },
] as const;

const CALC = (name: string) => `Roto & Blow Molding - ${name}`;
export const ROTO_BLOW_CALC = {
  cooling: CALC('Cooling'), inflate: CALC('Inflate'), cavities: CALC('Blow mold cavities'), blow: CALC('Extrusion blow mold'),
  moldsPerArm: CALC('Molds per arm'), loadUnload: CALC('Load and unload'), roto: CALC('Rotational mold'), grind: CALC('Grind'),
  router: CALC('Router'), saw: CALC('Saw'), blowMaterial: CALC('Blow molded material'), rotoMaterial: CALC('Rotomolded material'),
  blowMold: CALC('Blow mold tooling'), trimTooling: CALC('Trim tooling'), rotoMold: CALC('Rotational mold tooling'),
} as const;

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const fail = (...reasons: string[]): StepOutcome => ({ ok: false, reasons });
const isGap = (l: ProcessLineCost) => l.physicsGap != null;
type Row = Readonly<Record<string, unknown>>;

/** The shell as the routes take it (cad-engine roto_blow/feature_extractor.py, via auto-fill's rotoBlowGeometry). */
export interface RotoBlowPart {
  envelope: { lengthMm: number; widthMm: number; depthMm: number };
  partVolumeMm3: number;
  surfaceAreaMm2: number;
  wallMm: number;
  hollow: boolean;
  insideVolumeMm3: number;
  partingLineMm: number | null;
  perimeterMm: number | null;
  spouts: RotoBlowSpout[];
  holes: RotoBlowHole[];
  voids: RotoBlowVoid[];
}

/** A Roto & Blow Molding material: whether it is blow molded or rotomolded, its density, price and melt properties. */
export interface RotoBlowMaterial {
  id: string;
  name: string;
  materialType: string | null;
  densityKgM3: number | null;
  costPerKgUsd: number | null;
  canBlowMold: boolean;
  canRotoMold: boolean;
  melt: { meltingTempC: number | null; moldTempC: number | null; ejectTempC: number | null; specificHeatJgC: number | null; conductivityWMC: number | null; densityKgM3: number | null };
}

export interface RotoBlowScenario {
  batchSize: number;
  route: RotoBlowRouteKey | null;
  colored: boolean;
  labels: number | null;
  inserts: number;
  /** The Cost Guide's oven time (s); null: the cooling time. */
  ovenTimeS: number | null;
  /** Parts the molds are spread over (annual volume x production life); null when the scenario gives none. */
  amortizationParts: number | null;
}

export interface RotoBlowRouteInput {
  ref: SandReference;
  spec: DomainCalculatorSpec;
  calculators: Readonly<Record<string, ReferenceCalculatorDef>>;
  material: RotoBlowMaterial;
  part: RotoBlowPart;
  machinesByClass: Readonly<Record<string, readonly SandMachine[]>>;
  scenario: RotoBlowScenario;
  costContext: CostContext;
}

/** A mold or trim tool the route needs: an investment kept out of the piece cost, spread over the job. */
export interface RotoBlowTool { key: string; description: string; detail: string; costUsd: number | null; perPartUsd: number | null }

export interface RotoBlowRoute {
  key: RotoBlowRouteKey;
  label: string;
  lines: ProcessLineCost[];
  features: FeatureOp[];
  material: { costUsd: number; massKg: number; partKg: number; run: ReferenceCalcRun | null };
  /** Parts per shot (blow: cavities x stations) or per arm (roto: molds per arm); null when no machine takes the part. */
  partsPerCycle: number | null;
  coolingTimeS: number | null;
  tooling: RotoBlowTool[];
  totalUsd: number | null;
  complete: boolean;
  warnings: string[];
}

export interface RotoBlowRouteGap { key: RotoBlowRouteKey; label: string; reason: string }

/** Every route of the part (each complete or with its gaps), the routes it cannot take and why, and what keeps any route from being built. */
export function buildRotoBlowRoutes(input: RotoBlowRouteInput): { routes: RotoBlowRoute[]; gaps: RotoBlowRouteGap[]; missing: string[] } {
  const { ref, part, scenario, material } = input;
  const none = (...missing: string[]) => ({ routes: [], gaps: [], missing });
  const num = (name: string) => ref.number(name);
  if (material.densityKgM3 == null || !(material.densityKgM3 > 0)) return none(`${material.name}: its density`);
  if (material.costPerKgUsd == null || !(material.costPerKgUsd > 0)) return none(`${material.name}: its price per kg (cost_usa)`);
  if (!part.hollow || !(part.insideVolumeMm3 > 0)) return none('a hollow part: the analysis finds no air the shell closes in, so it is not blow or roto molded (choose Plastic Molding for a solid part)');
  if (!(part.wallMm > 0)) return none('the wall thickness: press Refresh analysis so the shell is measured');

  // ── Seeding: every input from its declared source; the key before a " (" note is the value's name ──────────────────────────────────
  const named = (values: Readonly<Record<string, CalcSeed | undefined>>): SeedProvider => (key) => values[key.split(' (')[0]!.trim()] ?? values[key] ?? null;
  const variableSeed = (name: string): CalcSeed | null => {
    const value = num(name);
    return value == null ? null : { value, source: `Roto & Blow variable ${name}${ref.unit(name) ? ` (${ref.unit(name)})` : ''}`, ref: { kind: 'variable', domain: ROTO_BLOW_DOMAIN, name } };
  };
  const cadSeed = (value: number, source: string, evidence?: CadEvidenceKey): CalcSeed => ({ value, source, ...(evidence ? { ref: { kind: 'cad' as const, evidence } } : {}) });
  const cad: Record<string, CalcSeed | undefined> = {
    part_volume: cadSeed(part.partVolumeMm3, "the solid's volume (mm³)", 'part_volume'),
    inside_volume: cadSeed(part.insideVolumeMm3, 'the air the shell closes in (mm³)'),
    parting_line: part.partingLineMm != null ? cadSeed(part.partingLineMm, 'where the mold halves meet (mm)') : undefined,
  };
  const materialProvider: SeedProvider = (column) => {
    const v = column === 'density_kg_m3' ? material.densityKgM3 : column === 'cost' ? material.costPerKgUsd : null;
    return v == null ? null : { value: v, source: `${material.name}: ${column === 'cost' ? 'price (USD/kg)' : 'density (kg/m³)'}`, ref: { kind: 'material', materialId: material.id, materialName: material.name, column } };
  };
  const lookupSeed = (table: string, row: Row | undefined, column: string, identity: readonly string[]): CalcSeed | undefined => {
    if (!row || row[column] == null || !Number.isFinite(Number(row[column]))) return undefined;
    const id = Object.fromEntries(identity.map((c) => [c, row[c] as string | number]));
    return {
      value: Number(row[column]), source: `${table} (${identity.map((c) => `${c} ${row[c]}`).join(', ')}): ${column}`, lookup: true, match: { table, row: id },
      ref: { kind: 'lookup', domain: ROTO_BLOW_DOMAIN, table, column, row: id },
    };
  };
  type Run = { run: ReferenceCalcRun } | { reasons: string[] };
  const run = (calculator: string, machine: SandMachine | null, engine: Record<string, CalcSeed | undefined>, lookups: Record<string, CalcSeed | undefined> = {}): Run => {
    const calc = input.spec.calculators.find((c) => c.name === calculator);
    if (!calc) return { reasons: [`${calculator} is not in the calculator spec`] };
    const providers: SeedProviders = {
      variable: (name) => variableSeed(name), cad: named(cad), engine: named(engine), lookup: named(lookups),
      scenario: named({ batch_size: { value: scenario.batchSize, source: 'batch size' } }), material: materialProvider,
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
  const step = (process: string, machineClass: string, evaluate: (m: SandMachine) => StepOutcome, criteria: string[]): CostedStep =>
    selectAndCost({
      process, machineClass, machines: input.machinesByClass[machineClass] ?? [], evaluate, criteria,
      batchSize: scenario.batchSize, costContext: input.costContext, ref, partName: 'part', processGroup: ROTO_BLOW_PROCESS_GROUP,
    });
  const timed = (calculator: string, m: SandMachine, engine: Record<string, CalcSeed | undefined>, lookups: Record<string, CalcSeed | undefined> = {}, extra: Record<string, unknown> = {}): StepOutcome => {
    const r = run(calculator, m, engine, lookups);
    return 'run' in r ? { ok: true, sec: r.run.value!, run: r.run, energyCostUsd: 0, notes: [], ...extra } as StepOutcome : fail(...r.reasons);
  };

  // ── The part, the material and the reference ──────────────────────────────────────────────────────────────────────────────────────
  const [lengthMm, widthMm] = [Math.max(part.envelope.lengthMm, part.envelope.widthMm), Math.min(part.envelope.lengthMm, part.envelope.widthMm)];
  const dims = {
    part_length_mm: seed(lengthMm, 'the envelope across the parting plane, long side (mm)'),
    part_width_mm: seed(widthMm, 'the envelope across the parting plane, short side (mm)'),
    part_depth_mm: seed(part.envelope.depthMm, 'the envelope along the pull (mm)'),
  };
  const diagonal = Math.sqrt(lengthMm ** 2 + widthMm ** 2 + part.envelope.depthMm ** 2);
  const partKg = (part.partVolumeMm3 * material.densityKgM3) / 1e9;
  const melt = material.melt;
  const meltSeed = (value: number | null, label: string): CalcSeed | undefined => (value == null || !(value > 0) ? undefined : seed(value, `${material.name}: ${label}`));
  const cooling = run(ROTO_BLOW_CALC.cooling, null, {
    wall_mm: seed(2 * part.wallMm, `twice the ${r2(part.wallMm)} mm wall: the shell is cooled from the mold side only`),
    thermal_conductivity: meltSeed(melt.conductivityWMC, 'thermal conductivity of melt (W/m·°C)'),
    melt_density: meltSeed(melt.densityKgM3, 'density of melt (kg/m³)'),
    specific_heat: meltSeed(melt.specificHeatJgC, 'specific heat of melt (J/g·°C)'),
    melt_temperature: meltSeed(melt.meltingTempC, 'melting temperature (°C)'),
    mold_temperature: meltSeed(melt.moldTempC, 'mold temperature (°C)'),
    eject_temperature: meltSeed(melt.ejectTempC, 'eject deflection temperature (°C)'),
  });
  const coolingSec = 'run' in cooling ? cooling.run.value! : null;
  const coolingSeed = coolingSec != null ? seed(r2(coolingSec), `${ROTO_BLOW_CALC.cooling}: ${r2(coolingSec)} s`) : undefined;
  const rules: FeatureRules = {
    minBlowHoleDiameter: num('minBlowHoleDiameter') ?? 0, maxBlowHoleDiameter: num('maxBlowHoleDiameter') ?? 0,
    maxBlowMoldSimpleHoleDepth: num('maxBlowMoldSimpleHoleDepth') ?? 0, maxCorableHoleDiameter: num('maxCorableHoleDiameter') ?? 0,
    voidDepthConstant: num('voidDepthConstant') ?? Infinity, trimStockAllowance: num('trimStockAllowance') ?? 0,
  };
  const labels = scenario.labels ?? num('defaultNumLabels') ?? 0;
  const colorant = scenario.colored ? num('colorantCost') ?? 0 : 0;
  const colorantSeed = seed(colorant, scenario.colored ? 'Roto & Blow variable colorantCost: the part is colored' : 'not colored (Cost Guide)');
  const labelsSeed = seed(labels, scenario.labels != null ? `${labels} in-mold label(s) (Cost Guide)` : `${labels} (defaultNumLabels)`);
  const insertsSeed = seed(scenario.inserts, `${scenario.inserts} insert(s) (Cost Guide)`);
  const toolLife = (() => {
    const row = ref.table('tblToolLife').find((r) => String(r['Material Type'] ?? '').toLowerCase() === (material.materialType ?? '').toLowerCase());
    const shots = Number(row?.['Num Shots Per Tool']);
    return Number.isFinite(shots) && shots > 0 ? { shots, source: `tblToolLife (${material.materialType})` } : { shots: num('defaultToolLife') ?? 0, source: 'defaultToolLife' };
  })();
  const handlingRow = [...ref.table('materialHandling')].sort((a, b) => Number(a['Weight']) - Number(b['Weight'])).find((r) => Number(r['Weight']) >= partKg);
  const handling = { 'materialHandling.Handling Time (s)': lookupSeed('materialHandling', handlingRow, 'Handling Time (s)', ['Weight']) };
  const sawRate = { 'circularSawCutting.Cutting Rate (mm^2 / min)': lookupSeed('circularSawCutting', ref.table('circularSawCutting')[0], 'Cutting Rate (mm^2 / min)', ['Material Type']) };
  const parts = scenario.amortizationParts;
  /** A tool's cost spread over the job: the molds the job wears out (its parts over the tool life's shots), each priced by the calculator. */
  const tool = (key: string, description: string, calculator: string, size: number, largest: number, sizeLabel: string, shotsPerTool: number | null, copies: number): RotoBlowTool => {
    const r = run(calculator, null, { size: seed(size, sizeLabel), largest: seed(largest, 'the same measure of the largest machine') });
    if ('reasons' in r) return { key, description, detail: r.reasons.join('; '), costUsd: null, perPartUsd: null };
    const sets = parts && shotsPerTool ? Math.max(1, Math.ceil(parts / shotsPerTool)) : 1;
    const cost = r2(r.run.value! * copies * sets);
    const detail = `${copies} x ${r2(r.run.value!)} USD (${Math.round((r.run.outputs['Size Share'] ?? 0) * 100)} % of the limit range)${sets > 1 ? `, ${sets} sets over the job (${toolLife.source}: ${toolLife.shots.toLocaleString('en-US')} shots each)` : ''}`;
    return { key, description, detail, costUsd: cost, perPartUsd: parts ? Math.round((cost / parts) * 10000) / 10000 : null };
  };

  // A rotational mold: the part grown by its shrinkage, with the flange and framework each side; its outer surface sizes its cost, against
  // the largest mold the largest carousel swings (a cube within its cylinder and mounting margin).
  const shrink = 1 + (num('rotoMoldingShrinkageAllowance') ?? 0) / 100;
  const structure = num('rotoMoldStructureMargin') ?? 0;
  const moldSides = [lengthMm * shrink + 2 * structure, widthMm * shrink + 2 * structure, part.envelope.depthMm * shrink + 2 * structure] as const;
  const moldArea = 2 * (moldSides[0] * moldSides[1] + moldSides[0] * moldSides[2] + moldSides[1] * moldSides[2]);
  const rotoSide = Math.max(1, ...(input.machinesByClass[ROTO_BLOW_CLASS.roto] ?? []).map((x) => machineValue(x, 'max_cylinder_dia_mm') ?? 0)) - 2 * (num('rotoMoldMountingMargin') ?? 0);
  const rotoLargest = Math.max(1, 6 * rotoSide * rotoSide);

  const routes: RotoBlowRoute[] = [];
  const gaps: RotoBlowRouteGap[] = [];
  for (const r of ROTO_BLOW_ROUTES) {
    if (r.key === 'blow' && !material.canBlowMold) { gaps.push({ key: r.key, label: r.label, reason: `${material.name} is not blow molded (memory/Roto & blow molding: Can Blow Mold false)` }); continue; }
    if (r.key === 'roto' && !material.canRotoMold) { gaps.push({ key: r.key, label: r.label, reason: `${material.name} is not rotomolded (memory/Roto & blow molding: Can Rotational Mold false)` }); continue; }
    if (r.key === 'roto') {
      const lo = num('minRotoMoldableWallThickness');
      const hi = num('maxRotoMoldableWallThickness');
      if ((lo != null && part.wallMm < lo) || (hi != null && part.wallMm > hi)) {
        gaps.push({ key: r.key, label: r.label, reason: `the ${r2(part.wallMm)} mm wall is outside the ${lo}-${hi} mm a rotational mold forms` });
        continue;
      }
    }
    const features = featureOperations(r.key, { wallMm: part.wallMm, partingLineMm: part.partingLineMm, spouts: part.spouts, holes: part.holes, voids: part.voids }, rules);
    const cores = features.filter((f) => f.operation === 'Coring').length;
    const routed = features.filter((f) => f.process === 'Router');
    const sawn = features.filter((f) => f.process === 'Saw');
    const trimmed = features.filter((f) => f.operation === 'Trimming');
    const warnings: string[] = [];
    const steps: CostedStep[] = [];
    let partsPerCycle: number | null = null;
    let materialRun: ReferenceCalcRun | null = null;
    let chosen: SandMachine | null = null;

    if (r.key === 'blow') {
      const inflate = run(ROTO_BLOW_CALC.inflate, null, {});
      const mat = run(ROTO_BLOW_CALC.blowMaterial, null, { wall_mm: seed(part.wallMm, 'the shell\'s nominal wall (mm)'), colorant_usd_per_kg: colorantSeed, labels: labelsSeed });
      if ('run' in mat) materialRun = mat.run;
      const molding = step(r.process, r.machineClass, (m) => {
        if (coolingSec == null) return fail(...('reasons' in cooling ? cooling.reasons : []));
        if ('reasons' in inflate) return fail(...inflate.reasons);
        const cav = run(ROTO_BLOW_CALC.cavities, m, dims);
        if ('reasons' in cav) return fail(...cav.reasons);
        const cavities = cav.run.value!;
        if (!(cavities >= 1)) return fail(`the ${r2(lengthMm)} x ${r2(widthMm)} x ${r2(part.envelope.depthMm)} mm part with its envelope margin does not fit its ${machineValue(m, 'mold_length_mm')} x ${machineValue(m, 'mold_width_mm')} mm mold, ${machineValue(m, 'mold_depth_mm')} mm deep a half`);
        const out = timed(ROTO_BLOW_CALC.blow, m, {
          inflate_time_s: seed(r2(inflate.run.value!), `${ROTO_BLOW_CALC.inflate}: ${r2(inflate.run.value!)} s`), cooling_time_s: coolingSeed,
          vacuum_factor: labels > 0 ? { ...(variableSeed('blowMoldVacuumFactor') ?? seed(1, 'no vacuum factor')) } : seed(1, 'no in-mold labels: no vacuum'),
          cavities: seed(cavities, `${cavities} cavities (${ROTO_BLOW_CALC.cavities})`),
        });
        return out.ok ? { ...out, partsPerCycle: cavities * (machineValue(m, 'number_of_stations') ?? 1), cavities } as StepOutcome : out;
      }, ['The part fits its mold (envelope margin, depth of its halves)', 'Its head extrudes the parisons']);
      steps.push(molding);
      const mo = molding.outcome as (Extract<StepOutcome, { ok: true }> & { partsPerCycle?: number; cavities?: number }) | null;
      partsPerCycle = mo?.partsPerCycle ?? null;
      chosen = molding.machine;
      if (routed.length) {
        const length = routed.reduce((s, f) => s + (f.cutLengthMm ?? 0), 0);
        steps.push(step('Router', ROTO_BLOW_CLASS.router, (m) => {
          const tl = machineValue(m, 'table_length_mm');
          const tw = machineValue(m, 'table_width_mm');
          if (tl != null && tw != null && (lengthMm > tl || widthMm > tw)) return fail(`the part is larger than its ${tl} x ${tw} mm table`);
          return timed(ROTO_BLOW_CALC.router, m, {
            cut_length_mm: seed(r2(length), `${routed.length} routed edge(s): ${routed.map((f) => f.featureType).join(', ')} (mm)`), cuts: seed(routed.length, `${routed.length} cut(s)`),
            part_diagonal_mm: seed(r2(diagonal), 'the part\'s diagonal (mm)'),
          }, handling);
        }, ['The part fits its table']));
      }
      if (sawn.length) {
        const area = sawn.reduce((s, f) => s + (f.sawAreaMm2 ?? 0), 0);
        steps.push(step('Saw', ROTO_BLOW_CLASS.saw, (m) => timed(ROTO_BLOW_CALC.saw, m, { cut_area_mm2: seed(r2(area), `${sawn.length} neck moil(s): π x Ø x wall (mm²)`) }, { ...handling, ...sawRate }), ['Any saw']));
      }
    } else {
      const trimWaste = trimmed.reduce((s, f) => s + (f.wasteVolumeMm3 ?? 0), 0);
      const trimLength = trimmed.reduce((s, f) => s + (f.cutLengthMm ?? 0), 0);
      const mat = run(ROTO_BLOW_CALC.rotoMaterial, null, {
        trim_waste_mm3: seed(r2(trimWaste), trimmed.length ? `${trimmed.length} cut-out plug(s) and their trim stock (mm³)` : 'no cut-outs'),
        colorant_usd_per_kg: colorantSeed, inserts: insertsSeed, labels: labelsSeed,
      });
      if ('run' in mat) materialRun = mat.run;
      const chargeKg = materialRun?.outputs['Material Mass'] ?? partKg;
      const chargeSeed = seed(r3(chargeKg), `${r3(chargeKg)} kg: the material one part takes (${ROTO_BLOW_CALC.rotoMaterial})`);
      // grindProcessEnable: the pellets are ground to powder in the shop (memory: true); 'false' buys powder and skips the step.
      if ((ref.text('grindProcessEnable') ?? 'true').trim().toLowerCase() !== 'false') {
        steps.push(step('Grind', ROTO_BLOW_CLASS.grind, (m) => timed(ROTO_BLOW_CALC.grind, m, { charge_kg: chargeSeed }), ['Any grinder']));
      }
      const clamps = Math.max(num('minNumberOfClamps') ?? 0, Math.ceil(((part.partingLineMm ?? part.perimeterMm ?? 0) * shrink) / Math.max(num('clampSpacing') ?? 1, 1)));
      const oneMold = run(ROTO_BLOW_CALC.rotoMold, null, { size: seed(r2(moldArea), 'the mold\'s outer surface (mm²)'), largest: seed(rotoLargest, 'the same measure of the largest machine') });
      const moldUsd = 'run' in oneMold ? oneMold.run.value! : null;
      const molding = step(r.process, r.machineClass, (m) => {
        if (coolingSec == null) return fail(...('reasons' in cooling ? cooling.reasons : []));
        const arm = run(ROTO_BLOW_CALC.moldsPerArm, m, { ...dims, charge_kg: chargeSeed });
        if ('reasons' in arm) return fail(...arm.reasons);
        const slots = Math.min(arm.run.value!, Math.max(1, scenario.batchSize));
        if (!(slots >= 1)) return fail(`the ${r2(moldSides[0])} x ${r2(moldSides[1])} x ${r2(moldSides[2])} mm mold does not swing within its ${machineValue(m, 'max_cylinder_dia_mm')} mm cylinder, or its charge is over its ${machineValue(m, 'weight_capacity_kg')} kg capacity`);
        const oven = scenario.ovenTimeS ?? coolingSec;
        const indexS = machineValue(m, 'station_index_time_s') ?? 0;
        const loadOf = (molds: number) => run(ROTO_BLOW_CALC.loadUnload, m, {
          mold_area_mm2: seed(r2(moldArea), 'the mold\'s outer surface (mm²)'), clamps: seed(clamps, `${clamps} clamps: the parting line at clampSpacing, at least minNumberOfClamps`),
          cores: seed(cores, `${cores} cored feature(s)`), inserts: insertsSeed, labels: labelsSeed,
          trim_length_mm: seed(r2(trimLength), trimmed.length ? `${trimmed.length} cut-out edge(s) (mm)` : 'no cut-outs'), molds: seed(molds, `${molds} mold(s) on the arm`),
        });
        // The molds the arm runs: as many as cost least per part. Each more mold shares the index among more parts, and is one more mold to buy
        // (each wears out over the tool life). With no job volume to spread the molds over, the arm is filled.
        const ratePerS = ((m.machineRatePerHr ?? 0) + (m.labourRatePerHr ?? 0) * (m.operators ?? 0)) / 3600;
        const perPart = (molds: number): number | null => {
          const l = loadOf(molds);
          if ('reasons' in l) return null;
          const period = Math.max(oven, coolingSec, l.run.value!) + indexS;
          const sets = parts && toolLife.shots > 0 ? Math.max(1, Math.ceil(parts / (molds * toolLife.shots))) : 1;
          return (ratePerS * period) / molds + (parts && moldUsd != null ? (moldUsd * molds * sets) / parts : 0);
        };
        let molds = slots;
        if (parts && moldUsd != null) {
          let best = Infinity;
          for (let k = 1; k <= slots; k++) {
            const c = perPart(k);
            if (c != null && c < best - 1e-12) { best = c; molds = k; }
          }
        }
        const load = loadOf(molds);
        if ('reasons' in load) return fail(...load.reasons);
        const out = timed(ROTO_BLOW_CALC.roto, m, {
          oven_time_s: seed(r2(oven), scenario.ovenTimeS != null ? `${r2(oven)} s (Cost Guide)` : `${r2(oven)} s: the cooling time (no oven temperature in the reference)`),
          cooling_time_s: coolingSeed, load_time_s: seed(r2(load.run.value!), `${ROTO_BLOW_CALC.loadUnload}: ${r2(load.run.value!)} s`),
          molds_per_arm: seed(molds, `${molds} mold(s) on the arm: ${molds < slots ? `the number that costs least per part (machine time and molds over the job), of the ${slots} it takes` : `all ${slots} it takes (${ROTO_BLOW_CALC.moldsPerArm}${slots < arm.run.value! ? ', capped by the batch' : ''})`}`),
        });
        return out.ok ? { ...out, partsPerCycle: molds } as StepOutcome : out;
      }, ['The mold swings within its cylinder', 'The charges are within its weight capacity']);
      steps.push(molding);
      partsPerCycle = (molding.outcome as { partsPerCycle?: number } | null)?.partsPerCycle ?? null;
      chosen = molding.machine;
    }

    // ── Tooling: the molds (and a blow mold's trim tooling), kept out of the piece cost ─────────────────────────────────────────────────
    const tooling: RotoBlowTool[] = [];
    if (r.key === 'blow') {
      const margin = chosen ? machineValue(chosen, 'cavity_envelope_margin_mm') ?? 0 : 0;
      const cavities = Math.max(1, (partsPerCycle ?? 1) / Math.max(1, chosen ? machineValue(chosen, 'number_of_stations') ?? 1 : 1));
      const platens = (input.machinesByClass[ROTO_BLOW_CLASS.blow] ?? []).map((m) => (machineValue(m, 'mold_length_mm') ?? 0) * (machineValue(m, 'mold_width_mm') ?? 0));
      const largest = Math.max(1, ...platens);
      const area = (lengthMm + 2 * margin) * (widthMm + 2 * margin) * cavities;
      const shots = toolLife.shots > 0 ? toolLife.shots * cavities : null;
      tooling.push(tool('blow-mold', `Blow mold (${cavities} cavit${cavities === 1 ? 'y' : 'ies'})`, ROTO_BLOW_CALC.blowMold, r2(area), largest, 'the cavities\' area on the platen (mm²)', shots, 1));
      const routedLength = routed.reduce((s, f) => s + (f.cutLengthMm ?? 0), 0);
      if (routedLength > 0) {
        const perimeters = (input.machinesByClass[ROTO_BLOW_CLASS.blow] ?? []).map((m) => 2 * ((machineValue(m, 'mold_length_mm') ?? 0) + (machineValue(m, 'mold_width_mm') ?? 0)));
        tooling.push(tool('trim-tooling', 'Trim-transfer tooling', ROTO_BLOW_CALC.trimTooling, r2(routedLength), Math.max(1, ...perimeters), 'the routed length (mm)', shots, 1));
      }
    } else {
      // Each mold on the arm wears out over the tool life on its share of the job.
      const moldShots = toolLife.shots > 0 ? toolLife.shots * Math.max(1, partsPerCycle ?? 1) : null;
      tooling.push(tool('roto-mold', `Rotational mold${partsPerCycle && partsPerCycle > 1 ? ` (${partsPerCycle} on the arm)` : ''}`, ROTO_BLOW_CALC.rotoMold, r2(moldArea), rotoLargest, 'the mold\'s outer surface (mm²)', moldShots, Math.max(1, partsPerCycle ?? 1)));
    }

    const lines: ProcessLineCost[] = steps.map((s, i) => (i === 0 || s.line.process === r.process ? { ...s.line, formsPartFeatures: s.line.process === r.process } : { ...s.line, actsOnWholePart: true }));
    const complete = !lines.some(isGap) && materialRun != null;
    const materialCost = materialRun?.value ?? 0;
    const massKg = materialRun?.outputs['Material Mass'] ?? 0;
    if (!materialRun) warnings.push(`${r.label}: the material is not costed.`);
    routes.push({
      key: r.key, label: r.label, lines, features,
      material: { costUsd: materialCost, massKg: r3(massKg), partKg: r3(partKg), run: materialRun },
      partsPerCycle, coolingTimeS: coolingSec != null ? r2(coolingSec) : null, tooling,
      totalUsd: complete ? r2(materialCost + lines.reduce((s, l) => s + l.totalCost, 0)) : null, complete,
      warnings: [...warnings, ...steps.flatMap((s) => s.warnings)],
    });
  }
  return { routes, gaps, missing: [] };
}

/** The route to quote: the one set in the Cost Guide when it is a route for the part, else the cheapest complete one; and a note saying which and why. */
export function chooseRotoBlowRoute(routes: readonly RotoBlowRoute[], gaps: readonly RotoBlowRouteGap[], chosen: RotoBlowRouteKey | null): { route: RotoBlowRoute | null; note: string | null } {
  if (routes.length === 0) return { route: null, note: null };
  const money = (n: number) => `${n.toFixed(2)} USD`;
  const said = (r: RotoBlowRoute) => (r.complete ? `${r.label} ${money(r.totalUsd!)}` : `${r.label} incomplete (${r.lines.filter(isGap).map((l) => l.process).join(', ') || 'material'})`);
  const others = (pick: RotoBlowRoute) => [...routes.filter((r) => r !== pick).map(said), ...gaps.map((g) => `${g.label} not a route for this part (${g.reason})`)].join('; ');
  const user = chosen ? routes.find((r) => r.key === chosen) : undefined;
  if (user) return { route: user, note: `Roto & Blow Molding: ${user.label} is set in the Cost Guide. ${others(user)}.` };
  const complete = routes.filter((r) => r.complete).sort((a, b) => a.totalUsd! - b.totalUsd!);
  const pick = complete[0] ?? [...routes].sort((a, b) => a.lines.filter(isGap).length - b.lines.filter(isGap).length)[0]!;
  const why = complete[0] ? 'the cheapest complete route (material and process per part)' : 'no route is complete: the one with the fewest gaps';
  return { route: pick, note: `Roto & Blow Molding: ${pick.label} is quoted${pick.complete ? ` (${money(pick.totalUsd!)} per part)` : ''}, ${why}.${others(pick) ? ` ${others(pick)}.` : ''}` };
}
