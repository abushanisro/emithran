/**
 * What a molding route's own process can and cannot do with the features recognised on this part.
 *
 * The CAD engine recognises one feature graph per part. Each of the four molding processes (Injection, Reaction Injection, Structural Foam, Compression)
 * lists, in the reference catalog (digital_factory_operations.csv, staged as process_taxonomy_operations), the feature types it works with: compression has
 * no slides, lifters or combo voids, injection has no parting-line operation. This projects the one graph onto one process's vocabulary and says, per route:
 *  - the vocabulary the reference defines for the process (read from that process's own catalog rows, never from a copy kept here);
 *  - which recognised features the process lists;
 *  - the process incompatibilities: features the process cannot make as the reference defines it;
 *  - which of the process's feature types the CAD cannot assess yet (so "none found" is never assumed).
 * Pure and informational: it changes no cost, no cycle time, and neither feasibility nor the recommendation of a route.
 */
import { catalogPairs, type CatalogOperation } from '../../sheet-metal/operation/catalog-operation-resolver';
import type { PlasticFeature } from './plastic-catalog-operation-resolver';

/** The four molding processes of the reference (the first segment of their catalog rows). */
export const MOLDING_PROCESSES: ReadonlySet<string> = new Set([
  'Injection Molding', 'Reaction Injection Molding', 'Structural Foam Molding', 'Compression Molding',
]);

/**
 * Feature types that exist only because part of the mold moves (a slide, a lifter) or one core makes several features. A process whose catalog does not list one
 * has no such tooling, so a part that has the feature cannot be made by it. Any other type a process does not list (the parting line under injection, for example)
 * only means the process has no operation for it: every molded part has one, and nothing is flagged.
 */
const TOOLING_FEATURE_TYPES: ReadonlySet<string> = new Set(['SlideBundle', 'LifterBundle', 'ComboVoid']);

export interface ProcessIncompatibility {
  featureType: string;
  variant: string;
  count: number;
  featureIds: string[];
  /**
   * not_in_process_vocabulary: the reference lists no operation of this feature type for the process.
   * no_operation_can_make: the type is listed, but none of its operations can make this feature (a hole across the pull needs a core, and the process has none).
   */
  kind: 'not_in_process_vocabulary' | 'no_operation_can_make';
  reason: string;
}

export interface RouteFeatureRecognition {
  /** The process whose catalog this was read from, e.g. "Compression Molding". */
  process: string;
  /** The feature types the reference lists for this process (sorted). */
  vocabulary: string[];
  /** The recognised features the process lists, by type (a face group counts its faces, a bundle its members). */
  recognised: { featureType: string; count: number }[];
  incompatibilities: ProcessIncompatibility[];
  /** Feature types in this process's vocabulary that the CAD engine does not recognise yet: absence from `recognised` does not mean the part has none. */
  notAssessed: string[];
}

const countOf = (f: PlasticFeature): number => f.attributes?.faces ?? f.attributes?.count ?? Math.max(1, f.occurrences.length);

/** The process a catalog compound string belongs to ("Compression Molding:As Molded//CurvedSurface"): its first segment, when that is a name and not an operation. */
export function catalogProcessName(raw: string): string | null {
  const [head] = raw.split(':');
  return head && !head.includes('//') ? head.trim() : null;
}

export function resolveRouteFeatureRecognition(input: {
  catalogRaw: readonly string[];
  features: readonly PlasticFeature[];
  notYetRecognized: readonly string[];
  /** The catalog operations already resolved for these features on this process (plastic-catalog-operation-resolver.ts). */
  operations: readonly CatalogOperation[];
}): RouteFeatureRecognition | null {
  const process = input.catalogRaw.map(catalogProcessName).find((p): p is string => p != null && MOLDING_PROCESSES.has(p));
  if (!process) return null;

  const vocabulary = new Set<string>();
  for (const raw of input.catalogRaw) {
    if (catalogProcessName(raw) !== process) continue;
    const [top] = catalogPairs(raw);
    if (top) vocabulary.add(top.featureType);
  }

  const recognised = new Map<string, number>();
  const incompatibilities: ProcessIncompatibility[] = [];
  for (const f of input.features) {
    if (vocabulary.has(f.feature_type)) {
      recognised.set(f.feature_type, (recognised.get(f.feature_type) ?? 0) + countOf(f));
    } else if (TOOLING_FEATURE_TYPES.has(f.feature_type)) {
      incompatibilities.push({
        featureType: f.feature_type, variant: f.variant ?? '', count: countOf(f), featureIds: [f.id], kind: 'not_in_process_vocabulary',
        reason: `The reference lists no ${f.feature_type} for ${process}: this process has no tooling for it, so a part with this feature cannot be made by it as the reference defines the process.`,
      });
    }
  }
  for (const op of input.operations) {
    if (op.status !== 'infeasible') continue;
    incompatibilities.push({
      featureType: op.featureType, variant: op.variant, count: op.count, featureIds: [...op.featureIds], kind: 'no_operation_can_make',
      reason: op.reason ?? `No operation of ${process} can make this feature.`,
    });
  }

  return {
    process,
    vocabulary: [...vocabulary].sort(),
    recognised: [...recognised].map(([featureType, count]) => ({ featureType, count })).sort((a, b) => a.featureType.localeCompare(b.featureType)),
    incompatibilities: incompatibilities.sort((a, b) => a.featureType.localeCompare(b.featureType) || a.variant.localeCompare(b.variant)),
    notAssessed: input.notYetRecognized.filter((t) => vocabulary.has(t)).sort(),
  };
}
