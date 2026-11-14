// Can a machining process make this part's features at all, read from the reference operation catalog
// (memory/Machining/operations_full__operations.csv, staged as machining_reference_data category 'operation'):
// every row is "<Process>:<Operation>//<Feature>", e.g. "3 Axis Mill:Rough Milling//PocketV2". The CAD engine
// states the operation each feature needs (feature_graph_v2 canonical_operation, "Rough Milling // PocketV2").
// A process is incompatible with a feature when its catalog has no such operation for that feature type.
// Pure: no database, no engine.
import type { RouteCompatibility } from '../../plastic-molding/operation/route-compatibility';

interface CatalogFeature {
  id?: string;
  feature_type?: string;
  variant?: string;
  canonical_operation?: string;
  occurrences?: unknown[];
}

/**
 * True when `process` performs `operation` on `featureType`. Three forms of the same catalog fact:
 *   "P:Op//F"            the operation itself;
 *   "P:Mill Op//F"       the live-tool name a turning machine's catalog gives the milled version (Mill Contouring);
 *   "P:...:Op//F"        the operation as a step of a compound feature (Rounding//SimpleHole:Rounding//Edge).
 */
function performs(catalog: ReadonlySet<string>, compound: readonly string[], process: string, operation: string, featureType: string): boolean {
  const op = `${operation}//${featureType}`;
  return catalog.has(`${process}:${op}`) || catalog.has(`${process}:Mill ${op}`)
    || compound.some((k) => k.startsWith(`${process}:`) && k.endsWith(`:${op}`));
}

/**
 * The verdict for one process, or null when nothing is known (no catalog, or no feature that states its operation):
 * nothing is then held against the route.
 */
export function machiningCatalogCompatibility(
  features: readonly unknown[] | null | undefined,
  catalogKeys: readonly string[] | null | undefined,
  process: string,
): RouteCompatibility | null {
  const stated = ((features ?? []) as CatalogFeature[]).filter((f) => f.feature_type && f.canonical_operation?.includes('//'));
  if (!catalogKeys?.length || stated.length === 0) return null;
  const catalog = new Set(catalogKeys);
  const compound = catalogKeys.filter((k) => k.indexOf('//') !== k.lastIndexOf('//'));
  // One entry per (feature type, operation): the part's feature groups that need the same missing operation are counted together.
  const missing = new Map<string, RouteCompatibility['incompatibilities'][number]>();
  for (const f of stated) {
    const operation = f.canonical_operation!.split('//')[0]!.trim();
    if (performs(catalog, compound, process, operation, f.feature_type!)) continue;
    const reason = `${process} has no "${operation} // ${f.feature_type}" operation in the machining catalog`;
    const entry = missing.get(reason) ?? { featureType: f.feature_type!, variant: f.variant ?? 'default', count: 0, featureIds: [], kind: 'not_in_process_vocabulary' as const, reason };
    entry.count += f.occurrences?.length || 1;
    if (f.id) entry.featureIds.push(f.id);
    missing.set(reason, entry);
  }
  const incompatibilities = [...missing.values()];
  return { status: incompatibilities.length > 0 ? 'incompatible' : 'compatible', incompatibilities, notAssessed: [], warnings: [] };
}
