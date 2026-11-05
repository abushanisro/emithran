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
 *  - A core is served by a slide (side core) when the axis is within drawDirectionOrthogonalEpsilonForSlides of square to the pull, by a lifter when within
 *    drawDirectionOrthogonalEpsilonForLifters. Both fitting: undecided (it depends on clearance beside the part). Neither: oblique, undecided, never guessed.
 *    These two are a READING of the variables' notes ("default value supporting Slide and Lifter bundling"), as is ALONG_PULL_MAX_DEG below.
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
  const rules = input.rules ?? { maxNoCoreInsertDiameterMm: null, slideEpsilonDeg: null, lifterEpsilonDeg: null };

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

/**
 * A hole whose axis is within this angle of the pull is formed by the mold halves (it is drafted like any wall). The staged variables give no value for it: this is the
 * engine's own limit between a drafted and an over-drafted face (cad-engine MAX_DRAFT_DEG), so the two agree on what "along the pull" means.
 */
export const ALONG_PULL_MAX_DEG = 5;

function decideHole(f: PlasticFeature, candidates: readonly string[], rules: FeatureRules): Decision {
  const angle = f.attributes?.angle_to_pull_deg ?? null;
  const undecided = (reason: string): Decision => ({ operations: [...candidates], status: 'undecided', reason });
  if (angle == null) return undecided('The hole\'s direction against the pull is not known.');

  if (angle <= ALONG_PULL_MAX_DEG) {
    return candidates.includes(AS_MOLDED)
      ? { operations: [AS_MOLDED], status: 'resolved', reason: `Axis ${angle.toFixed(1)}° from the pull: formed by the mold halves.` }
      : undecided('The catalog has no As Molded operation for holes on this process.');
  }

  // Obscured: the mold halves cannot form it.
  const noCore = endsWith(candidates, 'NoCore');
  const sideCore = endsWith(candidates, 'SideCore');
  const lifter = endsWith(candidates, 'Lifter');
  const widest = Math.max(f.diameter_mm ?? 0, ...(f.attributes?.steps ?? []).map((s) => s.diameter_mm));
  const limit = rules.maxNoCoreInsertDiameterMm;
  const why = `The hole's axis is ${angle.toFixed(1)}° from the pull, so the mold halves cannot form it`;
  if (!noCore && !sideCore && !lifter) {
    const others = candidates.filter((op) => op !== AS_MOLDED);
    if (others.length === 0) return { operations: [], status: 'infeasible', reason: `${why}, and this process's catalog has no core, lifter or insert operation for it.` };
    return { operations: others, status: 'undecided', reason: `${why}; this process's catalog offers only ${others.join(', ')} for it, and whether that applies is not decided from the CAD.` };
  }
  if (limit != null && noCore && widest > 0 && widest <= limit) {
    return { operations: [noCore], status: 'resolved', reason: `${why}; Ø${widest} mm is within maxNoCoreInsertDiameter (${limit} mm): made with an insert, no core.` };
  }
  if (limit == null && noCore) return undecided(`${why}; maxNoCoreInsertDiameter is not staged, so an insert cannot be told from a core.`);

  // A core is needed. A slide (side core) serves an axis within drawDirectionOrthogonalEpsilonForSlides of square to the pull, a lifter one within ...ForLifters.
  const fromSquare = 90 - angle;
  const slideEps = rules.slideEpsilonDeg;
  const lifterEps = rules.lifterEpsilonDeg;
  if (sideCore && slideEps == null) return undecided(`${why}; drawDirectionOrthogonalEpsilonForSlides is not staged, so a side core cannot be ruled in or out.`);
  if (lifter && lifterEps == null) return undecided(`${why}; drawDirectionOrthogonalEpsilonForLifters is not staged, so a lifter cannot be ruled in or out.`);
  const fits: string[] = [];
  if (sideCore && slideEps != null && fromSquare <= slideEps) fits.push(sideCore);
  if (lifter && lifterEps != null && fromSquare <= lifterEps) fits.push(lifter);
  if (fits.length === 0) {
    const reach = [sideCore && `a side core (within ${slideEps}° of square)`, lifter && `a lifter (within ${lifterEps}°)`].filter(Boolean).join(' or ');
    return undecided(`${why}, and it is ${fromSquare.toFixed(1)}° from square to the pull, outside what ${reach} serves: it is oblique and would need an angled core, which is not decided here.`);
  }
  return {
    operations: fits.sort(),
    status: fits.length === 1 ? 'resolved' : 'undecided',
    reason: fits.length === 1
      ? `${why}; Ø${widest} mm is above maxNoCoreInsertDiameter (${limit} mm) and ${fromSquare.toFixed(1)}° from square to the pull: ${fits[0]}.`
      : `${why}; Ø${widest} mm needs a core and the axis is ${fromSquare.toFixed(1)}° from square to the pull, so a side core or a lifter serves it. Which one depends on the clearance beside the part in the tool, which is not assessed yet.`,
  };
}
