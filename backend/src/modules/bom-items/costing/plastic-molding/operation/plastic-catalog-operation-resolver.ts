/**
 * Which catalog operation each recognised plastic feature needs, per molding process (Injection, Reaction Injection, Structural Foam, Compression):
 * the part's features (the CAD engine's plastic feature graph) matched to that process's rows of the operation catalog (process_taxonomy_operations,
 * "Injection Molding:HoleSideCore//SimpleHole"). Pure: every fact comes in as data, and the answer has the shape of sheet metal's
 * (catalog-operation-resolver.ts: resolved / undecided / infeasible, never guessed) so the cost view shows both the same way.
 *
 * Reading of the catalog, from the staged variable notes (memory/Plastic Modeling variables):
 *  - "As Molded" is a feature the mold forms by itself: every face, rib, and any hole whose axis lies along the pull direction.
 *  - A hole whose axis is NOT along the pull is obscured: the mold halves cannot form it. maxNoCoreInsertDiameter is "the maximum diameter for which an
 *    obscured hole may be inserted and not also require a core": at or below it the hole is NoCore (an insert in the mold); above it the hole needs a
 *    SideCore or a Lifter. Which of the two depends on stroke, clearance and lifter geometry that are not assessed yet, so it is reported undecided
 *    with both candidates, never picked.
 *  - UnscrewMandrel is for threaded holes; CAD does not detect threads, so it is never chosen here.
 *  - The tolerance between "along the pull" and "not" is drawDirectionOrthogonalEpsilon (the staged angular tolerance between a feature's axis and
 *    the setup axis). Without it, or without the hole's angle, a hole's operation is undecided and says so.
 * A feature type the process's catalog does not list is left out (the step does not make it).
 */
import { catalogPairs, type CatalogOperation } from '../../sheet-metal/operation/catalog-operation-resolver';
import type { FeatureRules } from '../plastic-reference';

export interface PlasticFeature {
  id: string;
  feature_type: string;
  variant: string | null;
  diameter_mm?: number | null;
  attributes?: { angle_to_pull_deg?: number | null; steps?: ReadonlyArray<{ diameter_mm: number }>; faces?: number; count?: number } | null;
  occurrences: ReadonlyArray<{ face_ids?: ReadonlyArray<number> | null }>;
}

const HOLE_TYPES: ReadonlySet<string> = new Set(['SimpleHole', 'MultiStepHole']);
const AS_MOLDED = 'As Molded';
const NO_COST = 'No Cost Feature';

const endsWith = (candidates: readonly string[], suffix: string): string | undefined => candidates.find((op) => op.endsWith(suffix));

export function resolvePlasticCatalogOperations(input: {
  catalogRaw: readonly string[];
  features: readonly PlasticFeature[];
  rules: FeatureRules | null;
}): CatalogOperation[] {
  const { catalogRaw, features } = input;
  const rules = input.rules ?? { maxNoCoreInsertDiameterMm: null, axisToleranceDeg: null };

  const byType = new Map<string, Set<string>>();
  for (const raw of catalogRaw) {
    const [top] = catalogPairs(raw);
    if (!top) continue;
    (byType.get(top.featureType) ?? byType.set(top.featureType, new Set()).get(top.featureType)!).add(top.operation);
  }

  const results: CatalogOperation[] = [];
  for (const f of features) {
    const all = byType.get(f.feature_type);
    if (!all) continue;
    const candidates = [...all].filter((op) => op !== NO_COST).sort();
    if (candidates.length === 0) continue;

    const decided = HOLE_TYPES.has(f.feature_type) ? decideHole(f, candidates, rules) : decideMolded(candidates);
    const diameter = f.diameter_mm ?? null;
    results.push({
      operations: decided.operations,
      featureType: f.feature_type,
      variant: f.variant ?? '',
      diameterMm: diameter,
      count: f.attributes?.faces ?? f.attributes?.count ?? Math.max(1, f.occurrences.length),
      featureIds: [f.id],
      status: decided.status,
      children: [],
      ...(decided.reason ? { reason: decided.reason } : {}),
    });
  }
  return results.sort((a, b) => a.featureType.localeCompare(b.featureType) || (a.diameterMm ?? 0) - (b.diameterMm ?? 0));
}

type Decision = { operations: string[]; status: CatalogOperation['status']; reason?: string };

/** A face or a rib: the only operation the catalog gives it is As Molded. */
function decideMolded(candidates: readonly string[]): Decision {
  return candidates.includes(AS_MOLDED)
    ? { operations: [AS_MOLDED], status: 'resolved' }
    : { operations: [...candidates], status: candidates.length === 1 ? 'resolved' : 'undecided', reason: 'The catalog has no As Molded operation for this feature on this process.' };
}

function decideHole(f: PlasticFeature, candidates: readonly string[], rules: FeatureRules): Decision {
  const angle = f.attributes?.angle_to_pull_deg ?? null;
  const tolerance = rules.axisToleranceDeg;
  const undecided = (reason: string): Decision => ({ operations: [...candidates], status: 'undecided', reason });
  if (angle == null) return undecided('The hole\'s direction against the pull is not known.');
  if (tolerance == null) return undecided('drawDirectionOrthogonalEpsilon is not staged: whether this hole lies along the pull is not decided.');

  if (angle <= tolerance) {
    return candidates.includes(AS_MOLDED)
      ? { operations: [AS_MOLDED], status: 'resolved', reason: `Axis ${angle.toFixed(1)}° from the pull (within ${tolerance}°): formed by the mold halves.` }
      : undecided('The catalog has no As Molded operation for holes on this process.');
  }

  // Obscured: the mold halves cannot form it.
  const noCore = endsWith(candidates, 'NoCore');
  const sideCore = endsWith(candidates, 'SideCore');
  const lifter = endsWith(candidates, 'Lifter');
  const widest = Math.max(f.diameter_mm ?? 0, ...(f.attributes?.steps ?? []).map((s) => s.diameter_mm));
  const limit = rules.maxNoCoreInsertDiameterMm;
  if (!noCore && !sideCore && !lifter) {
    const others = candidates.filter((op) => op !== AS_MOLDED);
    const why = `The hole's axis is ${angle.toFixed(1)}° from the pull, so the mold halves cannot form it`;
    if (others.length === 0) return { operations: [], status: 'infeasible', reason: `${why}, and this process's catalog has no core, lifter or insert operation for it.` };
    return { operations: others, status: 'undecided', reason: `${why}; this process's catalog offers only ${others.join(', ')} for it, and whether that applies is not decided from the CAD.` };
  }
  if (limit != null && noCore && widest > 0 && widest <= limit) {
    return { operations: [noCore], status: 'resolved', reason: `Obscured (axis ${angle.toFixed(1)}° from the pull); Ø${widest} mm is within maxNoCoreInsertDiameter (${limit} mm): made with an insert, no core.` };
  }
  const needsMechanism = [sideCore, lifter].filter((op): op is string => !!op);
  if (needsMechanism.length === 0) {
    return { operations: [], status: 'infeasible', reason: `Obscured hole larger than maxNoCoreInsertDiameter (${limit ?? 'not staged'} mm), and this process's catalog has no side core or lifter for it.` };
  }
  return {
    operations: needsMechanism.sort(),
    status: needsMechanism.length === 1 ? 'resolved' : 'undecided',
    reason: limit == null
      ? 'maxNoCoreInsertDiameter is not staged: an obscured hole cannot be told from one that needs a core.'
      : `Obscured (axis ${angle.toFixed(1)}° from the pull) and Ø${widest} mm is above maxNoCoreInsertDiameter (${limit} mm): it needs a side core or a lifter. Which one depends on stroke, clearance and lifter geometry, which are not assessed yet.`,
  };
}
