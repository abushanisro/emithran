// An assembly's features: its components (the BOM children, each loaded into it) and its joints (how they are held together). Pure.
//
// There is no assembly model to read contacts or weld seams from (the CAD worker has no instance transforms), so the joints come from two
// places (user decision 2026-11-18):
//   derived    every threaded hole a child's own analysis found takes a screw (feature_graph_v2 SimpleHole, variant threaded: one screw per
//              occurrence, per instance of the child). Each derived joint names the child and the feature it came from.
//   engineer   the Cost Guide's joint table (scenario key assemblyJoints): the welds, rivets, sealant, adhesive and the rest, and any change to
//              a derived joint (a row with the derived joint's id overrides it; enabled: false switches it off).
// Nothing else is inferred: a press-fit bore or a weld seam is not guessed from a part.

/** The Cost Guide key of the joint table. */
export const ASSEMBLY_JOINTS_KEY = 'assemblyJoints';

/** The kinds of joint, each costed by one Assembly process (the welds by its manual or robotic variant, as the route says). */
export const JOINT_PROCESSES = [
  'Mechanical Assembly', 'Threaded Insert', 'Lock Bolt', 'Rivet', 'MIG Welding', 'TIG Welding', 'Spot Welding',
  'Electron Beam Welding', 'Laser Welding', 'Ultrasonic Welding', 'Adhesive Bonding', 'Fay Sealing', 'Fillet Sealing', 'Cap Sealing',
] as const;
export type JointProcess = (typeof JOINT_PROCESSES)[number];

/** The Mechanical Assembly operations of memory/Assembly. */
export const MECHANICAL_OPERATIONS = ['Screw Tighten - Manual', 'Screw Tighten - Power', 'Snap Fit', 'Press Fit', 'Rivet', 'Nut Insert', 'Tab Bend'] as const;
/** What an ultrasonic joint is: a weld, a stake or an insertion, each with its own horn time. */
export const ULTRASONIC_TYPES = ['weld', 'stake', 'insertion'] as const;
export const WELD_MATERIALS = ['Steel', 'Aluminum', 'Stainless Steel'] as const;
export const WELD_GASES = ['Argon', 'Argon CO2 Mix', 'Hydrogen'] as const;
export const WELD_POSITIONS = ['Flat', 'Horizontal', 'Overhead'] as const;

/** One joint as the routes cost it. Which measures it needs depends on its process (jointMeasures). */
export interface AssemblyJoint {
  id: string;
  process: JointProcess;
  /** Mechanical Assembly: the operation; Ultrasonic Welding: weld, stake or insertion. */
  operation: string | null;
  /** Joints, welds, spots, rivets or caps. */
  count: number;
  lengthMm: number | null;
  throatMm: number | null;
  depthMm: number | null;
  areaMm2: number | null;
  weldMaterial: string | null;
  gas: string | null;
  position: string | null;
  wireDiameterMm: number | null;
  /** The engineer's own time per joint (s): a rivet, or a fastening the DFA baseline has no verified time for. */
  timeS: number | null;
  /** A weld's edges prepared (ground and brushed) before, and ground clean after. */
  prep: boolean;
  cleanUp: boolean;
  /** The component it is on (a derived joint's child), and the features it came from, for the highlight. */
  componentId: string | null;
  featureIds: string[];
  label: string;
  source: 'derived' | 'engineer';
  enabled: boolean;
}

/** One child of the assembly as the routes take it. */
export interface AssemblyComponent {
  id: string;
  name: string;
  /** Instances in one assembly (the BOM quantity). */
  quantity: number;
  /** One instance's mass (kg): the BOM weight, else its volume at its material's density; null when neither is known. */
  massKg: number | null;
  /** Where the mass came from; with none, what would give it. */
  massSource: 'weight' | 'volume' | null;
  /** Its volume (mm³) and material, for the trace and for what to set when there is no mass. */
  volumeMm3: number | null;
  material: string | null;
  /** Its largest dimension (mm), from its bounding box; null when unknown. */
  maxDimensionMm: number | null;
  /** Its threaded holes (feature_graph_v2), each with its occurrences: the screws it takes. */
  threadedHoles: { featureId: string; spec: string | null; occurrences: number }[];
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const positive = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n > 0 ? n : null;
};
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
type Row = Readonly<Record<string, unknown>>;

/** The threaded holes of a child's feature graph (feature_graph_v2, at the root or under machining_features). */
export function threadedHolesOf(featureGraph: unknown): AssemblyComponent['threadedHoles'] {
  const fg = (featureGraph ?? {}) as Row;
  const v2 = (fg.feature_graph_v2 ?? (fg.machining_features as Row | undefined)?.feature_graph_v2) as Row | undefined;
  const features = Array.isArray(v2?.features) ? (v2.features as Row[]) : [];
  return features
    .filter((f) => (f.feature_type ?? f.type) === 'SimpleHole' && f.variant === 'threaded')
    .map((f) => {
      const occ = Array.isArray(f.occurrences) ? (f.occurrences as Row[]) : [];
      return { featureId: String(f.id), spec: text(occ[0]?.spec), occurrences: Math.max(occ.length, 1) };
    });
}

/** A BOM child as a component: its quantity, mass (BOM weight) and largest dimension (bounding box). */
/**
 * A BOM child as a component: its quantity, its mass (the BOM weight; else its volume at its material's density, `densityKgM3`, which the
 * caller resolves from the material) and its largest dimension (bounding box).
 */
export function componentOf(child: {
  id: string; name: string; quantity?: number | null; weight?: number | null; volume?: number | null; materialGrade?: string | null;
  maxLength?: number | null; maxWidth?: number | null; maxHeight?: number | null; featureGraph?: unknown;
}, densityKgM3: number | null = null): AssemblyComponent {
  const dims = [child.maxLength, child.maxWidth, child.maxHeight].map(positive).filter((d): d is number => d != null);
  const weight = positive(child.weight);
  const volume = positive(child.volume);
  const fromVolume = weight == null && volume != null && densityKgM3 != null && densityKgM3 > 0 ? (volume * densityKgM3) / 1e9 : null;
  return {
    id: child.id, name: child.name, quantity: positive(child.quantity) ?? 1,
    massKg: weight ?? (fromVolume != null ? Math.round(fromVolume * 1e6) / 1e6 : null),
    massSource: weight != null ? 'weight' : fromVolume != null ? 'volume' : null,
    volumeMm3: volume, material: text(child.materialGrade),
    maxDimensionMm: dims.length ? Math.max(...dims) : null, threadedHoles: threadedHolesOf(child.featureGraph),
  };
}

const blank = (id: string, process: JointProcess, label: string, source: AssemblyJoint['source']): AssemblyJoint => ({
  id, process, operation: null, count: 1, lengthMm: null, throatMm: null, depthMm: null, areaMm2: null, weldMaterial: null, gas: null,
  position: null, wireDiameterMm: null, timeS: null, prep: false, cleanUp: false, componentId: null, featureIds: [], label, source, enabled: true,
});

/** The joints the children's own analyses give: a screw in every threaded hole, per instance of the child. */
export function deriveJoints(components: readonly AssemblyComponent[]): AssemblyJoint[] {
  return components.flatMap((c) => c.threadedHoles.map((h) => ({
    // Named as the feature it is: "M4×0.7 screws ×5"; the part it is on is its componentId.
    ...blank(`screw:${c.id}:${h.featureId}`, 'Mechanical Assembly', `${h.spec ?? 'Threaded hole'} screws ×${h.occurrences * c.quantity}`, 'derived'),
    operation: 'Screw Tighten - Manual', count: h.occurrences * c.quantity, componentId: c.id, featureIds: [h.featureId],
  })));
}

const oneOf = <T extends string>(values: readonly T[], v: unknown): T | null => {
  const want = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return values.find((x) => x.toLowerCase() === want) ?? null;
};

/** One row of the Cost Guide's joint table, read defensively (it is engineer input): null when it names no process the routes know. */
export function parseJointRow(raw: unknown, index: number): AssemblyJoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Row;
  const process = oneOf(JOINT_PROCESSES, r.process);
  if (!process) return null;
  const id = text(r.id) ?? `joint-${index + 1}`;
  const operation = process === 'Mechanical Assembly' ? oneOf(MECHANICAL_OPERATIONS, r.operation) : process === 'Ultrasonic Welding' ? oneOf(ULTRASONIC_TYPES, r.operation) : null;
  return {
    // Unnamed, a joint is called by what it is: its operation ("Snap Fit 2"), else its process ("MIG Welding 1").
    ...blank(id, process, text(r.label) ?? `${process === 'Mechanical Assembly' && operation ? operation : process} ${index + 1}`, 'engineer'),
    operation,
    count: Math.max(1, Math.round(positive(r.count) ?? 1)),
    lengthMm: positive(r.lengthMm), throatMm: positive(r.throatMm), depthMm: positive(r.depthMm), areaMm2: positive(r.areaMm2),
    weldMaterial: oneOf(WELD_MATERIALS, r.weldMaterial), gas: oneOf(WELD_GASES, r.gas), position: oneOf(WELD_POSITIONS, r.position),
    wireDiameterMm: positive(r.wireDiameterMm), timeS: positive(r.timeS),
    prep: r.prep === true, cleanUp: r.cleanUp === true,
    componentId: text(r.componentId), enabled: r.enabled !== false,
  };
}

/**
 * The assembly's joints: the derived ones, each replaced by the table's row of the same id (its edit, or enabled: false to switch it off),
 * then the table's own rows. A row that names no known process is reported, not dropped silently.
 */
export function mergeJoints(derived: readonly AssemblyJoint[], table: unknown): { joints: AssemblyJoint[]; ignored: string[] } {
  const rows = Array.isArray(table) ? table : [];
  const ignored: string[] = [];
  const parsed = rows.map((raw, i) => {
    const j = parseJointRow(raw, i);
    const named = (raw as Row | null)?.process;
    if (!j) ignored.push(`joint table row ${i + 1}: no known process ("${typeof named === 'string' ? named : ''}")`);
    return j;
  }).filter((j): j is AssemblyJoint => j != null);
  const byId = new Map(parsed.map((j) => [j.id, j]));
  const joints = derived.map((d) => {
    const edit = byId.get(d.id);
    // An edit keeps what the analysis found (the component and its features) and takes the engineer's measures.
    return edit ? { ...edit, componentId: d.componentId, featureIds: d.featureIds, label: edit.label.startsWith(`${edit.process} `) ? d.label : edit.label, source: 'derived' as const } : d;
  });
  const derivedIds = new Set(derived.map((d) => d.id));
  return { joints: [...joints, ...parsed.filter((j) => !derivedIds.has(j.id))], ignored };
}
