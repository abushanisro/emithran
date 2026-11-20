// A weldment's welds, as the Cost Guide's weld table gives them. Pure.
//
// The CAD engine finds no weld seams, so the welds are the engineer's (user decision 2026-11-20; detecting seams from a multi-body model
// is a later step). Each row is one memory/Part Assembly operation (operations_welding_group.csv: Fillet Welding on an Edge, Plug Welding
// in a SimpleHole, Spot Welding on a Blank, ...) with its measures; bevel cutting before it and grinding, finish grinding and wire brushing
// after it are flags along its length. Whether a MIG or spot weld is made by hand or by a robot is the route's (part-assembly-route.ts).

/** The Cost Guide key of the weld table. */
export const PART_ASSEMBLY_WELDS_KEY = 'partAssemblyWelds';

/** The kinds of weld, each made by one Part Assembly welding process (MIG and spot by its manual or robotic variant, as the route says). */
export const WELD_PROCESSES = ['MIG Welding', 'Spot Welding', 'Laser Seam Welding'] as const;
export type WeldProcess = (typeof WELD_PROCESSES)[number];
export type WeldFeature = 'Edge' | 'Blank' | 'SimpleHole';

/**
 * The memory/Part Assembly operations of each kind of weld (operations_welding_group.csv; the manual and robotic variants of MIG and spot
 * welding have the same operations), each on the feature it is made on.
 */
export const WELD_OPERATIONS: Readonly<Record<WeldProcess, readonly { operation: string; feature: WeldFeature }[]>> = {
  'MIG Welding': [
    { operation: 'Bevel Groove Welding', feature: 'Edge' }, { operation: 'Fillet Welding', feature: 'Edge' },
    { operation: 'Flared Bevel Groove Welding', feature: 'Edge' }, { operation: 'Flared V-Groove Welding', feature: 'Edge' },
    { operation: 'Groove Welding', feature: 'Blank' }, { operation: 'J-Groove Welding', feature: 'Edge' },
    { operation: 'Other Welding', feature: 'Blank' }, { operation: 'Plug Welding', feature: 'SimpleHole' },
    { operation: 'Square Groove Welding', feature: 'Edge' }, { operation: 'Tack Welding', feature: 'Edge' },
    { operation: 'U-Groove Welding', feature: 'Edge' }, { operation: 'V-Groove Welding', feature: 'Edge' },
    { operation: 'Wrap Tie Welding', feature: 'Edge' },
  ],
  'Spot Welding': [{ operation: 'Spot Welding', feature: 'Blank' }, { operation: 'Spot Welding', feature: 'Edge' }],
  'Laser Seam Welding': [{ operation: 'Laser Seam Welding', feature: 'Blank' }, { operation: 'Laser Seam Welding', feature: 'Edge' }],
};

/** One row of the weld table, as the routes cost it. Which measures it needs depends on its operation (weld-geometry.ts). */
export interface PartAssemblyWeld {
  id: string;
  process: WeldProcess;
  operation: string;
  feature: WeldFeature;
  /** Welds of this row (seams, plugs, tacks or spots); null when not given (a spot row may give the length its spots run along instead). */
  count: number | null;
  /** One weld's length (mm): a seam's; for spot welds, the length they are spread along. */
  lengthMm: number | null;
  /** A fillet's leg, or a plug's hole diameter (mm). */
  sizeMm: number | null;
  /** The plate thickness at the joint (mm); null: the weldment's. */
  thicknessMm: number | null;
  /** The weld's cross-section (mm²), when given: it replaces the joint geometry's. */
  areaMm2: number | null;
  /** A laser seam's penetration (mm); null: the plate thickness. */
  depthMm: number | null;
  /** Prep and finishing along the weld's length. */
  bevel: boolean;
  grind: boolean;
  finishGrind: boolean;
  wireBrush: boolean;
  label: string;
  enabled: boolean;
}

type Row = Readonly<Record<string, unknown>>;
const positive = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) || Number(v) <= 0 ? null : Number(v));
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const oneOf = <T extends string>(options: readonly T[], v: unknown): T | null => (typeof v === 'string' && (options as readonly string[]).includes(v) ? v as T : null);

/** One row of the weld table, read defensively (it is engineer input): null when it names no weld process and operation the routes know. */
export function parseWeldRow(raw: unknown, index: number): PartAssemblyWeld | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Row;
  const process = oneOf(WELD_PROCESSES, r.process);
  if (!process) return null;
  const operations = WELD_OPERATIONS[process];
  const operation = text(r.operation) ?? (operations.length === 2 && operations[0].operation === operations[1].operation ? operations[0].operation : null);
  const feature = oneOf<WeldFeature>(['Edge', 'Blank', 'SimpleHole'], r.feature);
  const match = operations.find((o) => o.operation === operation && (feature == null || o.feature === feature));
  if (!match) return null;
  const count = positive(r.count);
  return {
    id: text(r.id) ?? `weld-${index + 1}`,
    process, operation: match.operation, feature: match.feature,
    count: count == null ? null : Math.max(1, Math.round(count)),
    lengthMm: positive(r.lengthMm), sizeMm: positive(r.sizeMm), thicknessMm: positive(r.thicknessMm), areaMm2: positive(r.areaMm2), depthMm: positive(r.depthMm),
    bevel: r.bevel === true, grind: r.grind === true, finishGrind: r.finishGrind === true, wireBrush: r.wireBrush === true,
    // Unnamed, a weld is called by its operation and its place in the table ("Fillet Welding 2").
    label: text(r.label) ?? `${match.operation} ${index + 1}`,
    enabled: r.enabled !== false,
  };
}

/** The weldment's welds from the weld table; a row that names no known process and operation is reported, not dropped silently. */
export function weldTable(table: unknown): { welds: PartAssemblyWeld[]; ignored: string[] } {
  const rows = Array.isArray(table) ? table : [];
  const welds: PartAssemblyWeld[] = [];
  const ignored: string[] = [];
  rows.forEach((raw, i) => {
    const w = parseWeldRow(raw, i);
    if (w) welds.push(w);
    else {
      const r = (raw ?? {}) as Row;
      ignored.push(`weld table row ${i + 1}: no known weld ("${typeof r.process === 'string' ? r.process : ''}${typeof r.operation === 'string' ? ` / ${r.operation}` : ''}")`);
    }
  });
  return { welds, ignored };
}
