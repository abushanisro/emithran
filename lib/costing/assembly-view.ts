import { withRow, withoutRow, type RowVocabulary, type TableRow } from '@/lib/costing/joint-table';
import type { BOMItem, CostSummaryDto } from '@/lib/api/hooks/useBOMItems';

export type AssemblySummary = NonNullable<CostSummaryDto['assembly']>;
export type AssemblyJointView = AssemblySummary['joints'][number];

/** The scenario keys of the assembly settings (backend assembly-cost.service.ts ASSEMBLY_ROUTE_KEY, assembly-joints.ts ASSEMBLY_JOINTS_KEY). */
export const ASSEMBLY_SCENARIO_KEYS = {
  route: 'assemblyRoute',
  joints: 'assemblyJoints',
} as const;

/** A measure a joint can carry, as the joint table stores it (backend assembly-joints.ts parseJointRow). */
export type JointField = 'operation' | 'count' | 'lengthMm' | 'throatMm' | 'depthMm' | 'areaMm2' | 'weldMaterial' | 'gas' | 'position' | 'wireDiameterMm' | 'timeS' | 'prep' | 'cleanUp';

/** One row of the Cost Guide's joint table, as stored under assemblyJoints. */
export type JointRow = TableRow<JointField>;

/** Each joint process and the measures its calculator needs (required) or can take (optional). */
const JOINT_PROCESSES: readonly { process: string; label: string; required: JointField[]; optional: JointField[] }[] = [
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

/** The choices of a text measure (backend assembly-joints.ts): one list, or one per process. */
const JOINT_CHOICES: Readonly<Partial<Record<JointField, Readonly<Record<string, readonly string[]>> | readonly string[]>>> = {
  operation: {
    'Mechanical Assembly': ['Screw Tighten - Manual', 'Screw Tighten - Power', 'Snap Fit', 'Press Fit', 'Rivet', 'Nut Insert', 'Tab Bend'],
    'Ultrasonic Welding': ['weld', 'stake', 'insertion'],
  },
  weldMaterial: ['Steel', 'Aluminum', 'Stainless Steel'],
  gas: ['Argon', 'Argon CO2 Mix', 'Hydrogen'],
  position: ['Flat', 'Horizontal', 'Overhead'],
};

const JOINT_FIELD_LABELS: Readonly<Record<JointField, string>> = {
  operation: 'Operation', count: 'Count', lengthMm: 'Length (mm, each)', throatMm: 'Throat (mm)', depthMm: 'Penetration (mm)', areaMm2: 'Area (mm², each)',
  weldMaterial: 'Material', gas: 'Gas', position: 'Position', wireDiameterMm: 'Wire (mm)', timeS: 'Time (s, each)', prep: 'Edge prep', cleanUp: 'Clean up',
};

const specOf = (row: JointRow) => JOINT_PROCESSES.find((p) => p.process === row.process) ?? { required: ['count'] as JointField[], optional: [] as JointField[] };

/** What a joint of each process takes: the Cost Guide's joint dialog. */
export const ASSEMBLY_JOINTS: RowVocabulary<JointField> = {
  fields: Object.keys(JOINT_FIELD_LABELS) as JointField[],
  kinds: JOINT_PROCESSES.map(({ process, label }) => ({ process, label })),
  required: (row) => specOf(row).required,
  optional: (row) => specOf(row).optional,
  choices: (field, row) => {
    const c = JOINT_CHOICES[field];
    if (!c) return null;
    return Array.isArray(c) ? c : (c as Readonly<Record<string, readonly string[]>>)[row.process] ?? null;
  },
  label: (field) => JOINT_FIELD_LABELS[field],
  flags: new Set<JointField>(['prep', 'cleanUp']),
  // A joint of another kind keeps its name and count; the rest belongs to the old kind.
  rekind: (row, process) => ({ id: row.id, process, ...(row.label ? { label: row.label } : {}), count: typeof row.count === 'number' ? row.count : 1 }),
};

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
    return edited ? withRow(table, rest) : withoutRow(table, joint.id);
  }
  return withRow(table, { ...(existing ?? { id: joint.id, process: joint.process, ...(joint.operation ? { operation: joint.operation } : {}), count: joint.count }), enabled: false });
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
