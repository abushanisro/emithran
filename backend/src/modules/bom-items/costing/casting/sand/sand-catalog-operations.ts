/**
 * Which catalog operation makes each recognised feature of a sand casting (memory/Sand casting/Processes/operations.csv, staged as
 * process_taxonomy_operations): the moulding process's rows ("Horizontal Automatic:As Cast//PlanarFace", "...:Sand Casting//SimpleHole:As
 * Cast//Edge") and the coring process's ("No Bake:No Bake Coring:No Bake//SimpleHole:As Cored//CurvedWall"). Pure: every fact comes in as
 * data, and the answer has the shape of sheet metal's and plastic molding's (CatalogOperation: resolved / undecided, never guessed), so the
 * process tree shows all three the same way. Display and trace only: no cost is changed.
 *
 * Reading of the catalog:
 *  - A feature a core forms is made by the coring process (its first pair, "No Bake//SimpleHole"), with the "As Cored" steps below it.
 *    Which features a core forms is known only from the casting analysis (the worker links each feature to its core, cores.cpp).
 *  - Every other feature is made by the mould: faces "As Cast", holes, voids, rings and sharp edges "Sand Casting", with their child steps.
 *  - Without the casting analysis (coresLinked false) a feature type both processes list is undecided between them: the cad-engine's cores
 *    are not linked to features, and guessing from their boxes would be invention.
 *  - A feature type neither process lists is left out (the step does not make it).
 */
import { catalogPairs, type CatalogOperation } from '../../sheet-metal/operation/catalog-operation-resolver';

export interface SandFeature {
  id: string;
  type: string;
  /** The core that forms it (the casting analysis's parameter `core`, 1-based), or null. */
  core: number | null;
  diameterMm: number | null;
}

interface Vocabulary { operation: string; children: Array<{ operation: string; featureType: string }> }

/** featureType -> its operation (the first pair of the row) and the child steps listed under it, in catalog order. */
function vocabulary(catalog: readonly string[]): Map<string, Vocabulary> {
  const out = new Map<string, Vocabulary>();
  for (const raw of catalog) {
    const [top, ...rest] = catalogPairs(raw);
    if (!top) continue;
    const entry = out.get(top.featureType) ?? { operation: top.operation, children: [] };
    for (const c of rest.slice(0, 1)) {
      if (!entry.children.some((x) => x.operation === c.operation && x.featureType === c.featureType)) entry.children.push(c);
    }
    out.set(top.featureType, entry);
  }
  return out;
}

const UNDECIDED_REASON = 'Mould or core: which features a core forms is known only from the casting analysis (request one).';

export function resolveSandCatalogOperations(input: {
  mouldingCatalog: readonly string[];
  coringCatalog: readonly string[];
  features: readonly SandFeature[];
  /** The features carry their core links (the casting analysis measured them). */
  coresLinked: boolean;
}): { moulding: CatalogOperation[]; coring: CatalogOperation[] } {
  const mould = vocabulary(input.mouldingCatalog);
  const core = vocabulary(input.coringCatalog);
  const groups = new Map<string, { side: 'moulding' | 'coring'; op: CatalogOperation }>();
  const add = (side: 'moulding' | 'coring', operations: string[], status: CatalogOperation['status'], f: SandFeature, children: Vocabulary['children'], reason?: string) => {
    const key = `${side}|${operations.join('/')}|${f.type}|${status}`;
    const g = groups.get(key) ?? {
      side,
      op: { operations, featureType: f.type, variant: '', diameterMm: null, count: 0, featureIds: [], status, children, ...(reason ? { reason } : {}) },
    };
    g.op.count += 1;
    g.op.featureIds.push(f.id);
    groups.set(key, g);
  };
  for (const f of input.features) {
    const m = mould.get(f.type);
    const c = core.get(f.type);
    if (input.coresLinked && f.core != null && c) add('coring', [c.operation], 'resolved', f, c.children);
    else if (!input.coresLinked && m && c) add('moulding', [m.operation, c.operation], 'undecided', f, [], UNDECIDED_REASON);
    else if (m) add('moulding', [m.operation], 'resolved', f, m.children);
    else if (!input.coresLinked && c) add('moulding', [c.operation], 'undecided', f, [], UNDECIDED_REASON);
  }
  const sorted = (side: 'moulding' | 'coring') => [...groups.values()].filter((g) => g.side === side).map((g) => g.op)
    .sort((a, b) => a.operations[0]!.localeCompare(b.operations[0]!) || a.featureType.localeCompare(b.featureType));
  return { moulding: sorted('moulding'), coring: sorted('coring') };
}

/**
 * The casting analysis's features (casting-worker result.json, parts[0].features): the top-level ones (a child, such as a step of a multi-step
 * hole, is part of its parent), each with the core that forms it. Null when the result has no feature list.
 */
export function sandFeaturesFromCastingResult(result: unknown): SandFeature[] | null {
  const features = (result as { parts?: Array<{ features?: unknown }> } | null)?.parts?.[0]?.features;
  if (!Array.isArray(features)) return null;
  return (features as Array<{ id?: unknown; type?: unknown; parent?: unknown; parameters?: Record<string, unknown> | null }>)
    .filter((f) => typeof f.id === 'string' && typeof f.type === 'string' && f.parent == null)
    .map((f) => {
      const core = f.parameters?.core;
      const dia = f.parameters?.diameter_mm;
      return {
        id: f.id as string,
        type: f.type as string,
        core: typeof core === 'number' && core > 0 ? core : null,
        diameterMm: typeof dia === 'number' ? dia : null,
      };
    });
}
