import type { BOMItem, CostSummaryDto } from '@/lib/api/hooks/useBOMItems';
import type { RowVocabulary, TableRow } from '@/lib/costing/joint-table';

export type PartAssemblySummary = NonNullable<CostSummaryDto['partAssembly']>;
export type WeldView = PartAssemblySummary['welds'][number];

/** The scenario keys of a weldment (backend part-assembly-cost.service.ts PART_ASSEMBLY_ROUTE_KEY, part-assembly-welds.ts PART_ASSEMBLY_WELDS_KEY). */
export const PART_ASSEMBLY_SCENARIO_KEYS = {
  route: 'partAssemblyRoute',
  welds: 'partAssemblyWelds',
} as const;

/** A measure a weld can carry, as the weld table stores it (backend part-assembly-welds.ts parseWeldRow). */
export type WeldField = 'operation' | 'feature' | 'count' | 'lengthMm' | 'sizeMm' | 'thicknessMm' | 'areaMm2' | 'depthMm' | 'bevel' | 'grind' | 'finishGrind' | 'wireBrush';
export type WeldRow = TableRow<WeldField>;

/** The joint shape the engine gives a MIG operation (backend weld-geometry.ts JOINT_TYPE), as far as what the weld needs goes. */
type Shape = 'fillet' | 'groove' | 'by_area' | 'plug' | 'tack';

/** memory/Part Assembly's MIG operations (backend part-assembly-welds.ts WELD_OPERATIONS) and the shape of each. */
const MIG_OPERATIONS: Readonly<Record<string, Shape>> = {
  'Bevel Groove Welding': 'groove', 'Fillet Welding': 'fillet', 'Flared Bevel Groove Welding': 'by_area', 'Flared V-Groove Welding': 'by_area',
  'Groove Welding': 'by_area', 'J-Groove Welding': 'by_area', 'Other Welding': 'by_area', 'Plug Welding': 'plug', 'Square Groove Welding': 'groove',
  'Tack Welding': 'tack', 'U-Groove Welding': 'by_area', 'V-Groove Welding': 'groove', 'Wrap Tie Welding': 'fillet',
};
/** The feature a spot weld or a laser seam is made on (memory has each on a Blank and on an Edge; the cost is the same). */
const FEATURES = ['Blank', 'Edge'] as const;
const FINISH: readonly WeldField[] = ['bevel', 'grind', 'finishGrind', 'wireBrush'];
const FIELDS: readonly WeldField[] = ['operation', 'feature', 'count', 'lengthMm', 'sizeMm', 'thicknessMm', 'areaMm2', 'depthMm', ...FINISH];

const KINDS = [
  { process: 'MIG Welding', label: 'MIG weld (by hand or robot, as the route)' },
  { process: 'Spot Welding', label: 'Spot welds (by hand or robot, as the route)' },
  { process: 'Laser Seam Welding', label: 'Laser seam weld' },
] as const;

const isSet = (v: unknown) => v != null && v !== '' && (typeof v !== 'number' || v > 0);
const shapeOf = (row: WeldRow): Shape | null => (typeof row.operation === 'string' ? MIG_OPERATIONS[row.operation] ?? null : null);

/**
 * What a weld needs and takes (backend weld-geometry.ts): a seam its length, and its area when the engine has no default shape for its joint
 * (J, U and flared grooves, Groove and Other); a plug or a tack its count; spots their count, or the length they run along; a laser seam its
 * length. The plate thickness is needed where the joint is measured from it and the weldment gives none.
 */
function measures(row: WeldRow, plateMm: number | null): { required: WeldField[]; optional: WeldField[] } {
  const has = (f: WeldField) => isSet(row[f]);
  const plate = (needed: boolean): { required: WeldField[]; optional: WeldField[] } =>
    (needed && plateMm == null ? { required: ['thicknessMm'], optional: [] } : { required: [], optional: ['thicknessMm'] });
  const join = (required: WeldField[], optional: WeldField[], p: ReturnType<typeof plate>) => ({ required: [...required, ...p.required], optional: [...optional, ...p.optional] });
  switch (row.process) {
    case 'Spot Welding': {
      const byLength = !has('count') && has('lengthMm');
      return join(byLength ? [] : ['count'], [...(byLength ? ['count' as const] : []), 'lengthMm', 'feature'], plate(byLength));
    }
    case 'Laser Seam Welding':
      return join(['count', 'lengthMm'], ['depthMm', 'feature', ...FINISH], plate(!has('depthMm') || row.bevel === true));
    default: {
      const shape = shapeOf(row);
      if (!shape) return { required: ['operation'], optional: [] };
      const finish = row.bevel === true;
      switch (shape) {
        case 'fillet': return join(['operation', 'count', 'lengthMm'], ['sizeMm', 'areaMm2', ...FINISH], plate((!has('sizeMm') && !has('areaMm2')) || finish));
        case 'groove': return join(['operation', 'count', 'lengthMm'], ['areaMm2', ...FINISH], plate(!has('areaMm2') || finish));
        case 'by_area': return join(['operation', 'count', 'lengthMm', 'areaMm2'], [...FINISH], plate(finish));
        // A plug is filled to the plate's depth; a tack is a fillet of the machine's tack length. Neither runs along a seam to finish.
        case 'plug': return join(['operation', 'count'], ['sizeMm', 'areaMm2'], plate(true));
        case 'tack': return join(['operation', 'count'], ['sizeMm', 'areaMm2'], plate(!has('sizeMm') && !has('areaMm2')));
      }
    }
  }
}

/** The weld table's vocabulary for a weldment whose plate (the components' sheet thickness) is `plateMm`, null when it has none. */
export function weldVocabulary(plateMm: number | null): RowVocabulary<WeldField> {
  return {
    fields: FIELDS,
    kinds: KINDS,
    required: (row) => measures(row, plateMm).required,
    optional: (row) => measures(row, plateMm).optional,
    choices: (field, row) => (field === 'operation' ? Object.keys(MIG_OPERATIONS) : field === 'feature' && row.process !== 'MIG Welding' ? FEATURES : null),
    label: (field, row) => {
      const shape = shapeOf(row);
      switch (field) {
        case 'operation': return 'Operation';
        case 'feature': return 'Made on';
        case 'count': return row.process === 'Spot Welding' ? 'Spots' : row.process === 'Laser Seam Welding' ? 'Seams' : shape === 'plug' ? 'Plugs' : shape === 'tack' ? 'Tacks' : 'Welds';
        case 'lengthMm': return row.process === 'Spot Welding' ? 'Length they run along (mm)' : 'Length (mm, each)';
        case 'sizeMm': return shape === 'plug' ? 'Hole Ø (mm)' : 'Leg (mm)';
        case 'thicknessMm': return 'Plate (mm)';
        case 'areaMm2': return 'Weld area (mm²)';
        case 'depthMm': return 'Penetration (mm)';
        case 'bevel': return 'Bevel';
        case 'grind': return 'Grind';
        case 'finishGrind': return 'Finish grind';
        case 'wireBrush': return 'Wire brush';
      }
    },
    placeholder: (field, row) => {
      const shape = shapeOf(row);
      switch (field) {
        case 'thicknessMm': return plateMm != null ? `${plateMm}, the weldment's` : undefined;
        case 'sizeMm': return shape === 'plug' ? 'plate + 8 (AWS D1.1)' : 'AWS D1.1 minimum';
        case 'areaMm2': return 'from the joint';
        case 'depthMm': return 'the plate';
        case 'lengthMm': return row.process === 'Spot Welding' ? 'or give the spots' : undefined;
        default: return undefined;
      }
    },
    flags: new Set(FINISH),
    // A weld of another kind keeps its name and count; a MIG weld starts as a fillet, the commonest.
    rekind: (row, process) => ({
      id: row.id, process, ...(row.label ? { label: row.label } : {}), count: typeof row.count === 'number' ? row.count : 1,
      ...(process === 'MIG Welding' ? { operation: 'Fillet Welding' } : {}),
    }),
  };
}

/**
 * A weld's measures as one line ("2 x 300 mm, 5 mm leg, 3 mm plate, grind"). Spots are counted, not run: their count when given (the engine
 * then ignores a length), else the length they are spread along (backend weld-geometry.ts spotsOf).
 */
export function weldMeasures(w: Pick<WeldView, 'operation' | 'count' | 'lengthMm' | 'sizeMm' | 'thicknessMm' | 'areaMm2' | 'depthMm' | 'bevel' | 'grind' | 'finishGrind' | 'wireBrush'>): string {
  const n = w.count ?? 1;
  const finish = [w.bevel ? 'bevel' : null, w.grind ? 'grind' : null, w.finishGrind ? 'finish grind' : null, w.wireBrush ? 'wire brush' : null].filter(Boolean);
  const spots = w.operation === 'Spot Welding';
  return [
    spots ? (w.count != null ? `${w.count} spots` : `spots along ${w.lengthMm ?? 0} mm, one every 10 x the sheet`)
      : w.lengthMm != null ? `${n} x ${w.lengthMm} mm` : `${n}`,
    w.sizeMm != null ? (w.operation === 'Plug Welding' ? `Ø${w.sizeMm} mm hole` : `${w.sizeMm} mm leg`) : null,
    w.areaMm2 != null ? `${w.areaMm2} mm²` : null,
    w.depthMm != null ? `${w.depthMm} mm deep` : null,
    w.thicknessMm != null ? `${w.thicknessMm} mm plate` : null,
    ...finish,
  ].filter(Boolean).join(', ');
}

/** Whether an item is costed as a weldment (backend material-resolution.service.ts resolveEffectiveFamily): its Process is Part Assembly. */
export function isPartAssemblyItem(item: Pick<BOMItem, 'scenarioOverrides'> | null | undefined): boolean {
  return item?.scenarioOverrides?.processGroup === 'Part Assembly';
}
