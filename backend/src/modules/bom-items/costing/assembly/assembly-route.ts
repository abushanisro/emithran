// An assembly's routes, priced on the staged memory/Assembly data and the assembly calculators (migration 1078). Pure.
//
// What is costed is the assembly's own work: each component loaded (Pick and Place, by its weight and size), every joint made (assembly-joints.ts)
// and the finished assembly unloaded. The components themselves are not: the BOM roll-up adds each child's own cost once.
//
// Two routes: Manual (every weld by hand) and Robotic (the MIG, TIG and spot welds on a robot). Fastening, sealing, bonding and the beam
// processes are the same on both. Each line runs on the cheapest capable machine of the location; a machine's setup is charged once per batch,
// on its first line.
import { gap, type CostContext } from '../casting/casting-finishing';
import { machineValue, type SandMachine } from '../casting/sand/sand-machines';
import { type CostedStep, type StepOutcome } from '../casting/sand/sand-steps';
import { type CalcSeed, type ReferenceCalcRun, type ReferenceCalculatorDef } from '../shared/calculators/reference-calculator';
import { cell as n, fail, routeKit } from '../shared/calculators/route-kit';

import type { AssemblyComponent, AssemblyJoint } from './assembly-joints';
import type { FeatureOp, ProcessLineCost } from '../../dto/cost-breakdown.dto';
import type { SandReference } from '../casting/sand/sand-reference';
import type { DomainCalculatorSpec } from '../shared/calculators/domain-calculator-spec';

export const ASSEMBLY_DOMAIN = 'assembly';
export const ASSEMBLY_PROCESS_GROUP = 'Assembly';

/** The HR Rates machine class of each Assembly process (migrations 794, 1075, 1076). */
export const ASSEMBLY_PROCESS_CLASS: Readonly<Record<string, string>> = {
  'Pick and Place': 'pick_and_place', 'Mechanical Assembly': 'mechanical_assembly', 'Threaded Insert': 'threaded_insert', 'Lock Bolt': 'lock_bolt', Rivet: 'rivet',
  'Manual MIG Welding': 'manual_mig_welding', 'Robotic MIG Welding': 'robotic_mig_welding', 'Manual TIG Welding': 'manual_tig_welding', 'Robotic TIG Welding': 'robotic_tig_welding',
  'Manual Spot Welding': 'manual_spot_welding', 'Robotic Spot Welding': 'robotic_spot_welding', 'Electron Beam Welding': 'electron_beam_welding', 'Laser Welding': 'laser_welding',
  'Ultrasonic Welding': 'assembly_ultrasonic_welding', 'Adhesive Bonding': 'adhesive_bonding', 'Fay Sealing': 'fay_sealing', 'Fillet Sealing': 'fillet_sealing', 'Cap Sealing': 'cap_sealing',
  'Weld Prep': 'weld_prep', 'Weld Clean Up': 'weld_clean_up',
};
export const ASSEMBLY_ROUTE_CLASSES: readonly string[] = [...new Set(Object.values(ASSEMBLY_PROCESS_CLASS))];

export const ASSEMBLY_ROUTES = [
  { key: 'manual', label: 'Manual assembly' },
  { key: 'robotic', label: 'Robotic welding' },
] as const;
export type AssemblyRouteKey = (typeof ASSEMBLY_ROUTES)[number]['key'];

/** The welds a robot can make, and the process of each on either route. */
const ARC_WELDS: Readonly<Partial<Record<string, { manual: string; robotic: string; kind: 'MIG' | 'TIG' | 'Spot' }>>> = {
  'MIG Welding': { manual: 'Manual MIG Welding', robotic: 'Robotic MIG Welding', kind: 'MIG' },
  'TIG Welding': { manual: 'Manual TIG Welding', robotic: 'Robotic TIG Welding', kind: 'TIG' },
  'Spot Welding': { manual: 'Manual Spot Welding', robotic: 'Robotic Spot Welding', kind: 'Spot' },
};
/** Welds that have a length (prep and clean-up run along it). */
const SEAM_WELDS = new Set(['MIG Welding', 'TIG Welding', 'Electron Beam Welding', 'Laser Welding']);

export const CONSUMABLES_CALC = 'Assembly - Weld consumables';
export const BOND_MATERIAL_CALC = 'Assembly - Sealant and adhesive material';
/** The DFA row a lock bolt is handled like (it is placed as a screw is). */
const LOCK_BOLT_HANDLING_ROW = 'Screw Tighten - Manual';
const DFA_TABLE = 'assembly_tblDfaOperationTimes';
const TRAVEL_TABLE = 'tblWeldTravelSpeed_part1';

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const isGap = (l: ProcessLineCost) => l.physicsGap != null;
const gapReason = (l: ProcessLineCost): string | null => (l.physicsGap && 'reason' in l.physicsGap ? l.physicsGap.reason : l.physicsGap ? 'not costed' : null);
type Row = Readonly<Record<string, unknown>>;

export interface AssemblyRouteInput {
  ref: SandReference;
  spec: DomainCalculatorSpec;
  calculators: Readonly<Record<string, ReferenceCalculatorDef>>;
  components: readonly AssemblyComponent[];
  joints: readonly AssemblyJoint[];
  /** The finished assembly, unloaded once: its mass (kg) and largest dimension (mm), each with where it came from; null when unknown. */
  assembly: { massKg: number | null; maxDimensionMm: number | null; sizeSource: string };
  machinesByClass: Readonly<Record<string, readonly SandMachine[]>>;
  batchSize: number;
  costContext: CostContext;
  /**
   * The component whose model the page shows (a part set to Assembly with no parts under it is its own one component): its features and
   * faces can be highlighted, so its load, unload and joints point at them. Null when the components are other parts.
   */
  selfId?: string | null;
}

/** What one joint came to on a route: its line's process and cost, or why it could not be made. */
export interface AssemblyJointResult {
  jointId: string;
  process: string;
  cycleSec: number | null;
  consumablesUsd: number;
  reason: string | null;
}

export interface AssemblyRoute {
  key: AssemblyRouteKey;
  label: string;
  lines: ProcessLineCost[];
  joints: AssemblyJointResult[];
  /** The adhesive the bonded joints take (kg): reported, not priced (memory/Assembly gives no price for it). */
  adhesiveKg: number;
  /** The weld consumables (wire, gas, tips, nozzles, spray) on the weld lines, USD per assembly. */
  consumablesUsd: number;
  runs: Record<string, ReferenceCalcRun>;
  totalUsd: number | null;
  complete: boolean;
  warnings: string[];
}

export interface AssemblyRouteGap { key: AssemblyRouteKey; label: string; reason: string }

/**
 * The componentLoadTimes row for a component: of the rows whose weight and largest dimension both take it, the quickest to load (no lifting
 * equipment before a lifting aid). Null when no row takes it.
 */
export function loadRow(ref: SandReference, massKg: number, maxDimensionMm: number): Row | null {
  const fits = ref.table('componentLoadTimes').filter((r) => (n(r, 'Weight (kg)') ?? -1) >= massKg && (n(r, 'Part Max Dimension (mm)') ?? -1) >= maxDimensionMm);
  return [...fits].sort((a, b) => n(a, 'Load Time (s)')! - n(b, 'Load Time (s)')! || n(a, 'Weight (kg)')! - n(b, 'Weight (kg)')! || n(a, 'Part Max Dimension (mm)')! - n(b, 'Part Max Dimension (mm)')!)[0] ?? null;
}

/**
 * The passes a weld's throat takes (tblNumWeldPasses): each row is the throat a pass count starts above, so the passes are those of the
 * largest threshold below the throat (one pass up to 5.66 mm, an 8 mm leg).
 */
export function passesRow(ref: SandReference, kind: 'MIG' | 'TIG', throatMm: number): Row | null {
  const rows = ref.table('tblNumWeldPasses').filter((r) => r['Weld Process Type'] === kind).sort((a, b) => n(a, 'Max Design Throat (mm)')! - n(b, 'Max Design Throat (mm)')!);
  return [...rows].reverse().find((r) => n(r, 'Max Design Throat (mm)')! < throatMm) ?? rows[0] ?? null;
}

/** The MIG travel-speed row for a pass: the material and gas, the smallest tabled throat that takes the pass, the joint's wire else the largest. */
export function migRow(ref: SandReference, material: string, gas: string, passThroatMm: number, wireMm: number | null): Row | null {
  const rows = ref.table(TRAVEL_TABLE).filter((r) => r['Material Type'] === material && r['Gas Type'] === gas);
  const throat = Math.min(...rows.map((r) => n(r, 'Throat Thickness (mm)')!).filter((t) => t >= passThroatMm - 1e-9));
  const at = rows.filter((r) => n(r, 'Throat Thickness (mm)') === throat);
  return (wireMm != null ? at.find((r) => n(r, 'Wire Diameter (mm)') === wireMm) : [...at].sort((a, b) => n(b, 'Wire Diameter (mm)')! - n(a, 'Wire Diameter (mm)')!)[0]) ?? null;
}

/** The TIG row for a pass (tblTigWeldingV2): the material, the smallest tabled throat that takes the pass. */
export function tigRow(ref: SandReference, material: string, passThroatMm: number): Row | null {
  const rows = ref.table('tblTigWeldingV2').filter((r) => r.Material === material && (n(r, 'Max Throat Thickness (mm)') ?? -1) >= passThroatMm - 1e-9);
  return [...rows].sort((a, b) => n(a, 'Max Throat Thickness (mm)')! - n(b, 'Max Throat Thickness (mm)')!)[0] ?? null;
}

/** Every route of the assembly (each complete or with its gaps), the routes it cannot take and why, and what keeps any route from being built. */
export function buildAssemblyRoutes(input: AssemblyRouteInput): { routes: AssemblyRoute[]; gaps: AssemblyRouteGap[]; missing: string[] } {
  const { ref, components, batchSize } = input;
  const joints = input.joints.filter((j) => j.enabled);
  if (components.length === 0 && joints.length === 0) {
    return { routes: [], gaps: [], missing: ['the assembly has no components and no joints: add its parts under it in the BOM, or its joints in the Cost Guide'] };
  }
  const robotic = joints.some((j) => ARC_WELDS[j.process]);
  const gaps: AssemblyRouteGap[] = robotic ? [] : [{ key: 'robotic', label: 'Robotic welding', reason: 'the assembly has no MIG, TIG or spot weld for a robot to make' }];
  const routes = ASSEMBLY_ROUTES.filter((r) => r.key === 'manual' || robotic).map((r) => buildRoute(input, r, joints));
  return { routes, gaps, missing: [] };

  function buildRoute(inp: AssemblyRouteInput, route: (typeof ASSEMBLY_ROUTES)[number], enabled: readonly AssemblyJoint[]): AssemblyRoute {
    const warnings: string[] = [];
    const runs: Record<string, ReferenceCalcRun> = {};
    const { variable, run, seed, lookupSeed, calcOf, timed, step } = routeKit({
      ref, spec: inp.spec, calculators: inp.calculators, machinesByClass: inp.machinesByClass, batchSize, costContext: inp.costContext,
      domain: ASSEMBLY_DOMAIN, domainLabel: 'Assembly', processGroup: ASSEMBLY_PROCESS_GROUP, processClass: ASSEMBLY_PROCESS_CLASS, partName: 'assembly',
    });
    const lines: ProcessLineCost[] = [];
    const jointResults: AssemblyJointResult[] = [];
    const add = (s: CostedStep, ops: FeatureOp[], wholePart = false) => {
      warnings.push(...s.warnings);
      lines.push({
        ...s.line, featureBreakdown: ops.map((o) => ({ ...o, timeSec: o.timeSec || r2((s.line.cycleTimeMin ?? 0) * 60) })),
        // The part on the page is the one handled: the tree shows it whole and highlights it.
        ...(wholePart ? { actsOnWholePart: true } : {}),
      });
    };
    const isSelf = (componentId: string | null) => componentId != null && componentId === inp.selfId;
    // Where a count came from on the part on the page: exactly those features, so the calculator's eye highlights them.
    const featureRef = (label: string, featureIds: readonly string[]) => ({ kind: 'features' as const, label, features: featureIds.map((featureId) => ({ featureId })) });

    // ── Pick and Place: each component loaded, by the componentLoadTimes row its weight and size fall in ─────────────────────────────────
    const bands = new Map<Row, AssemblyComponent[]>();
    const unloadable: AssemblyComponent[] = [];
    for (const c of components) {
      const row = c.massKg != null && c.maxDimensionMm != null ? loadRow(ref, c.massKg, c.maxDimensionMm) : null;
      if (!row) unloadable.push(c);
      else bands.set(row, [...(bands.get(row) ?? []), c]);
    }
    // Feature names stay short (the tree lists features); the mass and where it came from are on the panel and in the trace.
    const componentOp = (c: AssemblyComponent, sec = 0): FeatureOp => ({ name: `${c.name} ×${c.quantity}`, featureType: 'AssemblyComponent', timeSec: sec, count: c.quantity, featureIds: [c.id] });
    for (const [row, group] of bands) {
      const quantity = group.reduce((s, c) => s + c.quantity, 0);
      const loadSeed = lookupSeed('componentLoadTimes', row, 'Load Time (s)', ['Equipment', 'Weight (kg)', 'Part Max Dimension (mm)']);
      const s = step('Pick and Place', (m) => timed('Pick and Place', m, {
        quantity: {
          value: quantity,
          source: `${quantity} component instance(s) up to ${String(row['Weight (kg)'])} kg and ${String(row['Part Max Dimension (mm)'])} mm (${group.map((c) => `${c.name}: ${c.massKg} kg${c.massSource === 'volume' ? `, its volume at the density of ${c.material ?? 'its material'}` : ''}`).join('; ')})`,
          // The part on the page, loaded: its whole solid is what is handled.
          ...(group.length === 1 && isSelf(group[0]!.id) ? { ref: { kind: 'cad' as const, evidence: 'part_volume' as const } } : {}),
        },
        unload_time_s: seed(0, 'components are loaded; the finished assembly is unloaded on its own line'),
      }, { 'componentLoadTimes.Load Time (s)': loadSeed }), ['Any pick and place station']);
      const each = (n(row, 'Load Time (s)') ?? 0) * (ref.number('handlingMultiplier') ?? 1) * (ref.number('cycleTimeAdjustmentFactor') ?? 1);
      add(s, group.map((c) => componentOp(c, r2(each * c.quantity))), group.length === 1 && isSelf(group[0]!.id));
    }
    if (unloadable.length) {
      const noMass = (c: AssemblyComponent) => (c.volumeMm3 != null
        ? `its weight: set its material (its ${Math.round(c.volumeMm3).toLocaleString('en-US')} mm³ at the material's density gives it) or its weight in the BOM`
        : 'its weight: set it in the BOM, or its material and analyse its model');
      const why = unloadable.map((c) => `${c.name}: ${c.massKg == null ? noMass(c) : c.maxDimensionMm == null ? 'its size (its bounding box)' : `${c.massKg} kg and ${c.maxDimensionMm} mm are beyond componentLoadTimes`}`);
      lines.push({ ...gap('Pick and Place', ASSEMBLY_PROCESS_GROUP, ASSEMBLY_PROCESS_CLASS['Pick and Place'], `the load time of ${why.join('; ')}`), featureBreakdown: unloadable.map((c) => componentOp(c)) });
    }
    // The finished assembly, unloaded once.
    if (components.length) {
      const a = inp.assembly;
      const row = a.massKg != null && a.maxDimensionMm != null ? loadRow(ref, a.massKg, a.maxDimensionMm) : null;
      const unloadOp: FeatureOp = { name: 'Finished assembly ×1', featureType: 'Assembly', timeSec: 0, count: 1 };
      if (!row) {
        lines.push({ ...gap('Pick and Place', ASSEMBLY_PROCESS_GROUP, ASSEMBLY_PROCESS_CLASS['Pick and Place'], a.massKg == null ? 'the unload time of the finished assembly: a component has no weight' : `the unload time of the ${r3(a.massKg)} kg, ${r2(a.maxDimensionMm ?? 0)} mm assembly: componentLoadTimes has no row for it`), featureBreakdown: [unloadOp] });
      } else {
        const s = step('Pick and Place', (m) => timed('Pick and Place', m, {
          quantity: seed(0, 'the finished assembly: nothing loaded'),
          unload_time_s: (() => {
            const u = lookupSeed('componentLoadTimes', row, 'Unload Time (s)', ['Equipment', 'Weight (kg)', 'Part Max Dimension (mm)']);
            return u && { ...u, source: `${u.source}, for the finished assembly: ${r3(a.massKg!)} kg, ${a.sizeSource}` };
          })(),
        }, { 'componentLoadTimes.Load Time (s)': lookupSeed('componentLoadTimes', row, 'Load Time (s)', ['Equipment', 'Weight (kg)', 'Part Max Dimension (mm)']) }), ['Any pick and place station']);
        add(s, [unloadOp], components.length === 1 && isSelf(components[0]!.id));
      }
    }

    // ── Joints ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    const dfa = (op: string) => ref.table(DFA_TABLE).find((r) => r.Operation === op);
    const defaultText = (name: string, fallback: string) => ref.text(name) ?? fallback;
    let adhesiveKg = 0;
    let consumablesUsd = 0;
    for (const j of enabled) {
      const process = ARC_WELDS[j.process]?.[route.key] ?? j.process;
      const jointOp: FeatureOp = { name: j.label, featureType: j.source === 'derived' ? 'AssemblyJointDerived' : 'AssemblyJoint', timeSec: 0, count: j.count, featureIds: j.featureIds };
      const countSource = `${j.count} on the joint (${j.source === 'derived' ? 'from the threaded holes of its part' : 'the joint table'})`;
      const count: CalcSeed = isSelf(j.componentId) && j.featureIds.length > 0
        ? { value: j.count, source: countSource, ref: featureRef(j.label, j.featureIds) }
        : seed(j.count, countSource);
      const problems: string[] = [];
      const need = (what: string, v: number | null): boolean => {
        if (v != null && v > 0) return true;
        problems.push(`${j.label}: its ${what}`);
        return false;
      };
      let evaluate: ((m: SandMachine) => StepOutcome) | null = null;
      const criteria: string[] = [];

      if (j.process === 'Mechanical Assembly') {
        const op = j.operation ?? 'Screw Tighten - Manual';
        const row = dfa(op);
        const time = j.timeS != null ? seed(j.timeS, `${op}: the time set on the joint (s)`) : lookupSeed(DFA_TABLE, row, 'Total Time (s)', ['Operation']);
        if (!time) problems.push(`${j.label}: ${op} has no verified DFA time in ${DFA_TABLE}: enter its time per joint`);
        else evaluate = (m) => timed(process, m, { joint_count: count, operation_time_s: time });
        criteria.push('Any assembly bench');
      } else if (j.process === 'Threaded Insert' || j.process === 'Cap Sealing') {
        evaluate = (m) => timed(process, m, { joint_count: count });
        criteria.push(j.process === 'Threaded Insert' ? 'An insert time' : 'An application time per cap');
      } else if (j.process === 'Lock Bolt') {
        evaluate = (m) => timed(process, m, { joint_count: count }, { [`${DFA_TABLE}.Handling Time (s)`]: lookupSeed(DFA_TABLE, dfa(LOCK_BOLT_HANDLING_ROW), 'Handling Time (s)', ['Operation']) });
        criteria.push('A lock speed');
      } else if (j.process === 'Rivet') {
        if (j.timeS == null) problems.push(`${j.label}: a rivet's time: memory/Assembly's rivet machine and the DFA baseline give none, enter it on the joint`);
        else evaluate = (m) => timed(process, m, { joint_count: count, operation_time_s: seed(j.timeS!, 'the time set on the joint (s)') });
        criteria.push('Any riveting station');
      } else if (j.process === 'MIG Welding' || j.process === 'TIG Welding') {
        const kind: 'MIG' | 'TIG' = j.process === 'MIG Welding' ? 'MIG' : 'TIG';
        const material = j.weldMaterial ?? defaultText(kind === 'MIG' ? 'defaultMIGWeldingMaterialType' : 'defaultTIGWeldingMaterialType', 'Steel');
        const gas = j.gas ?? defaultText(kind === 'MIG' ? 'defaultMigWeldingGasType' : 'defaultTigWeldingGasType', 'Argon');
        const position = j.position ?? defaultText('defaultWeldingAssemblyPosition', 'Flat');
        if (need('weld length', j.lengthMm) && need('throat', j.throatMm)) {
          const passes = passesRow(ref, kind, j.throatMm!);
          const p = n(passes ?? undefined, 'Num Passes');
          const passThroat = p ? j.throatMm! / p : j.throatMm!;
          const speedRow = kind === 'MIG' ? migRow(ref, material, gas, passThroat, j.wireDiameterMm) : tigRow(ref, material, passThroat);
          const positionFactor = kind === 'TIG' ? (position === 'Horizontal' ? ref.number('tigWeldHorizontalSpeedMultiplier') : position === 'Overhead' ? ref.number('tigWeldOverheadSpeedMultiplier') : 1) : 1;
          const densityRow = ref.table('tblTigWeldingV2').find((r) => r.Material === material);
          if (!p) problems.push(`${j.label}: tblNumWeldPasses has no ${kind} row`);
          else if (!speedRow) problems.push(`${j.label}: ${kind === 'MIG' ? TRAVEL_TABLE : 'tblTigWeldingV2'} has no ${material}${kind === 'MIG' ? ` / ${gas}` : ''} row for a ${r2(passThroat)} mm pass`);
          else if (positionFactor == null) problems.push(`${j.label}: the TIG speed multiplier for the ${position} position`);
          else {
            const speed = n(speedRow, 'Travel Speed (mm / s)')! * positionFactor;
            const table = kind === 'MIG' ? TRAVEL_TABLE : 'tblTigWeldingV2';
            const speedSeed: CalcSeed = {
              ...lookupSeed(table, speedRow, 'Travel Speed (mm / s)', kind === 'MIG' ? ['Material Type', 'Gas Type', 'Throat Thickness (mm)', 'Wire Diameter (mm)'] : ['Material', 'Max Throat Thickness (mm)'])!,
              value: speed,
              ...(positionFactor !== 1 ? { source: `${table} travel speed x ${positionFactor} for a ${position.toLowerCase()} weld` } : {}),
            };
            const length = j.lengthMm! * j.count;
            const engine = {
              weld_length_mm: seed(length, `${j.count} x ${j.lengthMm} mm of weld`), weld_count: count, travel_speed_mm_s: speedSeed,
              efficiency: route.key === 'robotic' ? seed(1, 'a robot: efficiency 1') : variable('weldingEfficiencyFactor') ?? undefined,
            };
            const passesSeed = lookupSeed('tblNumWeldPasses', passes, 'Num Passes', ['Weld Process Type', 'Max Design Throat (mm)']);
            const spray = kind === 'MIG' && ref.text('weldAntiSpatterSprayEnabled')?.toLowerCase() === 'true'
              ? [...ref.table('tblWeldAntiSpatterSpray')].sort((a, b) => n(a, 'Spray Cost (USD)')! / (n(a, 'Volume (mL)')! * n(a, 'Relative Density (g / cm^3)')!) - n(b, 'Spray Cost (USD)')! / (n(b, 'Volume (mL)')! * n(b, 'Relative Density (g / cm^3)')!))[0]
              : ref.table('tblWeldAntiSpatterSpray')[0];
            const sprayOn = kind === 'MIG' && ref.text('weldAntiSpatterSprayEnabled')?.toLowerCase() === 'true';
            evaluate = (m) => {
              const t = timed(process, m, engine, { 'tblNumWeldPasses.Num Passes': passesSeed });
              if (!t.ok) return t;
              const machineDensity = material === 'Steel' ? machineValue(m, 'weld_density_kg_per_m3') : null;
              const density: CalcSeed | undefined = machineDensity != null
                ? { value: machineDensity, source: `machine ${m.name}: weld_density_kg_per_m3 (a steel weld)`, ref: { kind: 'machine', machineId: m.id, machineName: m.name, machineClass: m.machineClass, location: m.location, column: 'weld_density_kg_per_m3' } }
                : lookupSeed('tblTigWeldingV2', densityRow, 'Material Density (kg / mm^3)', ['Material']);
              const feed: CalcSeed | undefined = kind === 'MIG'
                ? lookupSeed(TRAVEL_TABLE, speedRow, 'Wire Feed Speed (mm / s)', ['Material Type', 'Gas Type', 'Throat Thickness (mm)', 'Wire Diameter (mm)'])
                : machineValue(m, 'wire_feed_rate_mm_per_s') != null ? { value: machineValue(m, 'wire_feed_rate_mm_per_s')!, source: `machine ${m.name}: wire_feed_rate_mm_per_s`, ref: { kind: 'machine', machineId: m.id, machineName: m.name, machineClass: m.machineClass, location: m.location, column: 'wire_feed_rate_mm_per_s' } } : undefined;
              const gasMultiplier = kind === 'TIG' ? (gas === 'Argon CO2 Mix' ? ref.number('tigWeldArgonMixGasCostMultiplier') : gas === 'Hydrogen' ? ref.number('tigWeldHydrogenGasCostMultiplier') : 1) : 1;
              const gasRow = lookupSeed(table, speedRow, 'Gas Cost (USD / hr)', kind === 'MIG' ? ['Material Type', 'Gas Type', 'Throat Thickness (mm)', 'Wire Diameter (mm)'] : ['Material', 'Max Throat Thickness (mm)']);
              const sprayLookups = Object.fromEntries(['Spray Cost (USD)', 'Volume (mL)', 'Discharge Rate (g / s)', 'Relative Density (g / cm^3)', 'Spray Time Per Weld Length (s)']
                .map((c) => [`tblWeldAntiSpatterSpray.${c}`, lookupSeed('tblWeldAntiSpatterSpray', spray, c, ['Spray Name'])]));
              const c = run(CONSUMABLES_CALC, m, {
                arc_time_s: seed(t.run.outputs['Arc Time'], `the arc time (${calcOf(process)})`), weld_length_mm: engine.weld_length_mm,
                wire_feed_speed_mm_s: feed,
                wire_diameter_mm: lookupSeed(table, speedRow, kind === 'MIG' ? 'Wire Diameter (mm)' : 'Filler Rod Diameter (mm)', kind === 'MIG' ? ['Material Type', 'Gas Type', 'Throat Thickness (mm)', 'Wire Diameter (mm)'] : ['Material', 'Max Throat Thickness (mm)']),
                weld_density_kg_m3: density,
                gas_cost_usd_hr: gasRow && gasMultiplier != null ? { ...gasRow, value: gasRow.value * gasMultiplier, ...(gasMultiplier !== 1 ? { source: `${gasRow.source} x ${gasMultiplier} for ${gas}` } : {}) } : undefined,
                spray_on: seed(sprayOn ? 1 : 0, sprayOn ? `weldAntiSpatterSprayEnabled: ${String(spray?.['Spray Name'])}, the cheapest per gram` : kind === 'TIG' ? 'no anti-spatter spray on a TIG weld' : 'weldAntiSpatterSprayEnabled is off'),
              }, sprayLookups);
              if ('reasons' in c) return fail(...c.reasons);
              runs[`${j.id} consumables`] = c.run;
              return { ...t, materialCostUsd: c.sec };
            };
            criteria.push(`A ${kind} welder (arc time standard, tacks, gun times${route.key === 'robotic' ? ', programming and weld heads' : ''}) and its wire cost`);
          }
        }
      } else if (j.process === 'Spot Welding') {
        evaluate = (m) => timed(process, m, { weld_count: seed(j.count, `${j.count} spot welds`) });
        criteria.push('A spot weld time and gun placement');
      } else if (j.process === 'Electron Beam Welding' || j.process === 'Laser Welding') {
        const ebw = j.process === 'Electron Beam Welding';
        const maxDepth = ref.number(ebw ? 'EBWMaximumWeldDepth' : 'LWMaximumWeldDepth');
        if (need('weld length', j.lengthMm) && need('penetration (weld depth)', j.depthMm)) {
          if (maxDepth != null && j.depthMm! > maxDepth) problems.push(`${j.label}: a ${j.depthMm} mm penetration is deeper than ${ebw ? 'EBWMaximumWeldDepth' : 'LWMaximumWeldDepth'} (${maxDepth} mm)`);
          else {
            evaluate = (m) => timed(process, m, {
              weld_length_mm: seed(j.lengthMm! * j.count, `${j.count} x ${j.lengthMm} mm of weld`), weld_depth_mm: seed(j.depthMm!, 'the penetration set on the joint (mm)'), weld_count: count,
            });
            criteria.push(`A beam power and maximum speed${ebw ? ', pump and vent times' : ''}`);
            warnings.push(`${j.label}: the ${ebw ? 'electron beam' : 'laser'} weld speed rule is unverified (memory/Assembly gives the factors, not how they combine).`);
          }
        }
      } else if (j.process === 'Ultrasonic Welding') {
        const type = j.operation ?? 'weld';
        const variableName = type === 'stake' ? 'defaultUltrasonicStakeTime' : type === 'insertion' ? 'defaultUltrasonicInsertionTime' : 'defaultUltrasonicWeldTime';
        const maxLength = ref.number('maxUltrasonicAllowableLength');
        const time = variable(variableName);
        if (j.lengthMm != null && maxLength != null && j.lengthMm > maxLength) problems.push(`${j.label}: a ${j.lengthMm} mm joint is longer than maxUltrasonicAllowableLength (${maxLength} mm)`);
        else if (!time) problems.push(`${j.label}: Assembly variable ${variableName}`);
        else evaluate = (m) => timed(process, m, { joint_count: count, ultrasonic_time_s: time });
        criteria.push('An ultrasonic welder');
      } else if (j.process === 'Adhesive Bonding' || j.process === 'Fay Sealing') {
        if (need('bonded or sealed area', j.areaMm2)) {
          const area = seed(j.areaMm2! * j.count, `${j.count} x ${j.areaMm2} mm² faying area`);
          if (j.process === 'Adhesive Bonding') {
            const mass = run(BOND_MATERIAL_CALC, null, { bond_area_mm2: area, sealant_volume_mm3: seed(0, 'no sealant on a bonded joint') });
            if ('run' in mass) {
              adhesiveKg += mass.sec;
              runs[`${j.id} adhesive`] = mass.run;
            }
            evaluate = (m) => timed(process, m, { bond_area_mm2: area });
          } else evaluate = (m) => timed(process, m, { seal_area_mm2: area });
          criteria.push('An application rate (m²/min)');
        }
      } else if (j.process === 'Fillet Sealing') {
        if (need('bead length', j.lengthMm)) {
          evaluate = (m) => timed(process, m, { bead_length_mm: seed(j.lengthMm! * j.count, `${j.count} x ${j.lengthMm} mm of bead`) });
          criteria.push('An application rate (s/mm)');
        }
      }

      if (!evaluate) {
        const reason = problems.join('; ') || `${j.label}: not costed`;
        lines.push({ ...gap(process, ASSEMBLY_PROCESS_GROUP, ASSEMBLY_PROCESS_CLASS[process] ?? 'assembly', reason), featureBreakdown: [jointOp] });
        jointResults.push({ jointId: j.id, process, cycleSec: null, consumablesUsd: 0, reason });
        continue;
      }
      const s = step(process, evaluate, criteria);
      add(s, [jointOp]);
      const consumables = s.outcome?.materialCostUsd ?? 0;
      consumablesUsd += consumables;
      jointResults.push({ jointId: j.id, process, cycleSec: s.outcome ? r2(s.outcome.sec) : null, consumablesUsd: r3(consumables), reason: gapReason(s.line) });

      // A seam weld's edges prepared before and ground clean after, along its length.
      if (SEAM_WELDS.has(j.process) && j.lengthMm != null) {
        const length = seed(j.lengthMm * j.count, `${j.count} x ${j.lengthMm} mm of weld`);
        if (j.prep) add(step('Weld Prep', (m) => timed('Weld Prep', m, { weld_length_mm: length }), ['Grinding and wire brushing speeds']), [{ ...jointOp, name: `${j.label}: edges prepared` }]);
        if (j.cleanUp) add(step('Weld Clean Up', (m) => timed('Weld Clean Up', m, { weld_length_mm: length }), ['A grinding speed']), [{ ...jointOp, name: `${j.label}: ground clean` }]);
      }
    }
    if (adhesiveKg > 0) warnings.push(`The bonded joints take ${r3(adhesiveKg)} kg of adhesive: memory/Assembly gives no adhesive price, so it is not charged.`);

    // One setup per machine per batch: a later line on a machine already set up charges none.
    const setUp = new Set<string>();
    const shared = lines.map((l) => {
      const id = l.mhrId ?? null;
      if (!id || isGap(l) || !(l.setupCost > 0)) return l;
      if (!setUp.has(id)) { setUp.add(id); return l; }
      return { ...l, setupCost: 0, totalCost: l.runCost, setupTimeMin: 0 };
    });
    if (shared.some((l, i) => l !== lines[i])) warnings.push('A machine used for several lines is set up once per batch: its setup is on its first line only.');
    const complete = !shared.some(isGap);
    return {
      key: route.key, label: route.label, lines: shared, joints: jointResults, adhesiveKg: r3(adhesiveKg), consumablesUsd: r3(consumablesUsd), runs,
      totalUsd: complete ? r2(shared.reduce((s, l) => s + l.totalCost, 0)) : null, complete, warnings,
    };
  }
}

/** The route to quote: the one set in the Cost Guide when it is a route for the assembly, else the cheapest complete one; and a note saying which and why. */
export function chooseAssemblyRoute(routes: readonly AssemblyRoute[], gaps: readonly AssemblyRouteGap[], chosen: AssemblyRouteKey | null): { route: AssemblyRoute | null; note: string | null } {
  if (routes.length === 0) return { route: null, note: null };
  const money = (v: number) => `${v.toFixed(2)} USD`;
  const said = (r: AssemblyRoute) => (r.complete ? `${r.label} ${money(r.totalUsd!)}` : `${r.label} incomplete (${[...new Set(r.lines.filter(isGap).map((l) => l.process))].join(', ')})`);
  const others = (pick: AssemblyRoute) => [...routes.filter((r) => r !== pick).map(said), ...gaps.map((g) => `${g.label} not a route for this assembly (${g.reason})`)].join('; ');
  const user = chosen ? routes.find((r) => r.key === chosen) : undefined;
  if (user) return { route: user, note: `Assembly: ${user.label} is set in the Cost Guide.${others(user) ? ` ${others(user)}.` : ''}` };
  const complete = routes.filter((r) => r.complete).sort((a, b) => a.totalUsd! - b.totalUsd!);
  const pick = complete[0] ?? [...routes].sort((a, b) => a.lines.filter(isGap).length - b.lines.filter(isGap).length)[0];
  const why = complete[0] ? 'the cheapest complete route (its own work per assembly)' : 'no route is complete: the one with the fewest gaps';
  return { route: pick, note: `Assembly: ${pick.label} is quoted${pick.complete ? ` (${money(pick.totalUsd!)} per assembly)` : ''}, ${why}.${others(pick) ? ` ${others(pick)}.` : ''}` };
}
