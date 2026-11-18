import type { BOMItem, CostSummaryDto } from '@/lib/api/hooks/useBOMItems';

export type AssemblySummary = NonNullable<CostSummaryDto['assembly']>;
export type AssemblyJointView = AssemblySummary['joints'][number];

/** The scenario keys of the assembly settings (backend assembly-cost.service.ts ASSEMBLY_ROUTE_KEY, assembly-joints.ts ASSEMBLY_JOINTS_KEY). */
export const ASSEMBLY_SCENARIO_KEYS = {
  route: 'assemblyRoute',
  joints: 'assemblyJoints',
} as const;

/** The routes (backend assembly-route.ts ASSEMBLY_ROUTES). */
export const ASSEMBLY_ROUTE_OPTIONS = [
  { key: 'manual', label: 'Manual assembly' },
  { key: 'robotic', label: 'Robotic welding' },
] as const;

/** A measure a joint can carry, as the joint table stores it (backend assembly-joints.ts parseJointRow). */
export type JointField = 'operation' | 'count' | 'lengthMm' | 'throatMm' | 'depthMm' | 'areaMm2' | 'weldMaterial' | 'gas' | 'position' | 'wireDiameterMm' | 'timeS' | 'prep' | 'cleanUp';

/** Each joint process and the measures its calculator needs (required) or can take (optional). */
export const JOINT_PROCESSES: readonly { process: string; label: string; required: JointField[]; optional: JointField[] }[] = [
  { process: 'Mechanical Assembly', label: 'Mechanical fastening (screw, nut, snap fit, ...)', required: ['operation', 'count'], optional: ['timeS'] },
  { process: 'Threaded Insert', label: 'Threaded insert', required: ['count'], optional: [] },
  { process: 'Lock Bolt', label: 'Lock bolt', required: ['count'], optional: [] },
  { process: 'Rivet', label: 'Rivet', required: ['count', 'timeS'], optional: [] },
  { process: 'MIG Welding', label: 'MIG weld', required: ['count', 'lengthMm', 'throatMm'], optional: ['weldMaterial', 'gas', 'wireDiameterMm', 'prep', 'cleanUp'] },
  { process: 'TIG Welding', label: 'TIG weld', required: ['count', 'lengthMm', 'throatMm'], optional: ['weldMaterial', 'gas', 'position', 'prep', 'cleanUp'] },
  { process: 'Spot Welding', label: 'Spot welds', required: ['count'], optional: [] },
  { process: 'Electron Beam Welding', label: 'Electron beam weld', required: ['count', 'lengthMm', 'depthMm'], optional: ['prep', 'cleanUp'] },
  { process: 'Laser Welding', label: 'Laser weld', required: ['count', 'lengthMm', 'depthMm'], optional: ['prep', 'cleanUp'] },
  { process: 'Ultrasonic Welding', label: 'Ultrasonic weld, stake or insert', required: ['operation', 'count'], optional: ['lengthMm'] },
  { process: 'Adhesive Bonding', label: 'Adhesive bond', required: ['count', 'areaMm2'], optional: [] },
  { process: 'Fay Sealing', label: 'Fay sealing', required: ['count', 'areaMm2'], optional: [] },
  { process: 'Fillet Sealing', label: 'Fillet sealing', required: ['count', 'lengthMm'], optional: [] },
  { process: 'Cap Sealing', label: 'Cap sealing', required: ['count'], optional: [] },
];

/** The choices of a text measure (backend assembly-joints.ts). */
export const JOINT_CHOICES: Readonly<Partial<Record<JointField, Readonly<Record<string, readonly string[]>> | readonly string[]>>> = {
  operation: {
    'Mechanical Assembly': ['Screw Tighten - Manual', 'Screw Tighten - Power', 'Snap Fit', 'Press Fit', 'Rivet', 'Nut Insert', 'Tab Bend'],
    'Ultrasonic Welding': ['weld', 'stake', 'insertion'],
  },
  weldMaterial: ['Steel', 'Aluminum', 'Stainless Steel'],
  gas: ['Argon', 'Argon CO2 Mix', 'Hydrogen'],
  position: ['Flat', 'Horizontal', 'Overhead'],
};

export const JOINT_FIELD_LABELS: Readonly<Record<JointField, string>> = {
  operation: 'Operation', count: 'Count', lengthMm: 'Length (mm, each)', throatMm: 'Throat (mm)', depthMm: 'Penetration (mm)', areaMm2: 'Area (mm², each)',
  weldMaterial: 'Material', gas: 'Gas', position: 'Position', wireDiameterMm: 'Wire (mm)', timeS: 'Time (s, each)', prep: 'Edge prep', cleanUp: 'Clean up',
};

/** One row of the Cost Guide's joint table, as stored under assemblyJoints. */
export type JointRow = { id: string; process: string; label?: string; enabled?: boolean } & Partial<Record<JointField, string | number | boolean>>;

/** The joint table set in the Cost Guide (rows the engine can read; anything else is dropped here as the engine names it). */
export function jointTableOf(overrides: Record<string, unknown> | null | undefined): JointRow[] {
  const raw = overrides?.[ASSEMBLY_SCENARIO_KEYS.joints];
  return Array.isArray(raw) ? raw.filter((r): r is JointRow => !!r && typeof r === 'object' && typeof (r as JointRow).id === 'string' && typeof (r as JointRow).process === 'string') : [];
}

/** The table with `row` in it: replacing the row of its id, else added. */
export function withJoint(table: readonly JointRow[], row: JointRow): JointRow[] {
  return table.some((r) => r.id === row.id) ? table.map((r) => (r.id === row.id ? row : r)) : [...table, row];
}

/** The table without the row of `id` (an added joint removed, or a derived joint's edit undone). */
export function withoutJoint(table: readonly JointRow[], id: string): JointRow[] {
  return table.filter((r) => r.id !== id);
}

/**
 * A derived joint switched on or off. Off is a row of its id with enabled: false; back on, that row keeps any edit made to it (and is
 * dropped when it held nothing else).
 */
export function withDerivedEnabled(table: readonly JointRow[], joint: Pick<AssemblyJointView, 'id' | 'process' | 'operation' | 'count'>, enabled: boolean): JointRow[] {
  const existing = table.find((r) => r.id === joint.id);
  if (enabled) {
    if (!existing) return [...table];
    const { enabled: _off, ...rest } = existing;
    const edited = Object.keys(rest).some((k) => !['id', 'process', 'operation', 'count'].includes(k)) || rest.operation !== joint.operation || rest.count !== joint.count;
    return edited ? withJoint(table, rest) : withoutJoint(table, joint.id);
  }
  return withJoint(table, { ...(existing ?? { id: joint.id, process: joint.process, ...(joint.operation ? { operation: joint.operation } : {}), count: joint.count }), enabled: false });
}

/** A new joint's id: unique in the table. */
export function newJointId(table: readonly JointRow[]): string {
  let n = table.length + 1;
  while (table.some((r) => r.id === `joint-${n}`)) n += 1;
  return `joint-${n}`;
}

/** The scenario patch that stores the table (an empty table clears the key: the engine derives the joints alone). */
export function jointTablePatch(table: readonly JointRow[]): Record<string, unknown> {
  return { [ASSEMBLY_SCENARIO_KEYS.joints]: table.length ? table : null };
}

/** What is missing from a joint for its process: the required measures not set. */
export function missingMeasures(row: JointRow): JointField[] {
  const spec = JOINT_PROCESSES.find((p) => p.process === row.process);
  if (!spec) return [];
  return spec.required.filter((f) => row[f] == null || row[f] === '' || (typeof row[f] === 'number' && !(row[f] > 0)));
}

/** A joint's measures as one line ("2 x 300 mm, 4 mm throat, Steel"). */
export function jointMeasures(j: Pick<AssemblyJointView, 'count' | 'lengthMm' | 'throatMm' | 'depthMm' | 'areaMm2' | 'weldMaterial' | 'gas' | 'position' | 'timeS'>): string {
  return [
    j.lengthMm != null ? `${j.count} x ${j.lengthMm} mm` : j.areaMm2 != null ? `${j.count} x ${j.areaMm2.toLocaleString('en-US')} mm²` : `${j.count}`,
    j.throatMm != null ? `${j.throatMm} mm throat` : null,
    j.depthMm != null ? `${j.depthMm} mm deep` : null,
    j.weldMaterial, j.gas, j.position,
    j.timeS != null ? `${j.timeS} s each` : null,
  ].filter(Boolean).join(', ');
}

/**
 * Whether an item is costed as an assembly (backend material-resolution.service.ts resolveEffectiveFamily): its Process is Assembly, or it is
 * an assembly or sub-assembly with no Process of its own.
 */
export function isAssemblyItem(item: Pick<BOMItem, 'itemType' | 'scenarioOverrides'> | null | undefined): boolean {
  if (!item) return false;
  const group = item.scenarioOverrides?.processGroup;
  if (typeof group === 'string' && group.trim() !== '') return group === 'Assembly';
  return item.itemType === 'assembly' || item.itemType === 'sub_assembly';
}
