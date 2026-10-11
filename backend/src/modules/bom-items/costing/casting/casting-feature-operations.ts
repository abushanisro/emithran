// The casting operation each detected feature receives, chosen only among the
// casting process's own catalog rows (process_taxonomy_operations of the
// process, memory/Die Casting/Processes/operations.csv, migration 844). Pure.
//
//   not formed by the casting (machining-need.ts forms it) -> the process's
//                                     not-formed operation (HPDC No Coring, GDC
//                                     No Side Pull): the die leaves solid metal;
//                                     machining makes it
//   hole along the pull axis          -> As Cast (cored by a die pin)
//   hole across the pull axis         -> undetermined: it needs a side core and
//                                     the catalog side-core operations are named;
//                                     the geometry here does not decide which
//   SlideBundle                       -> Slides
//   Void (an undercut a slide forms)  -> As Cast
//   a feature type with one catalog operation -> that operation
// An operation the catalog does not list for the feature type is never chosen.

import type { FeatureInstance } from '../shared/tolerance/feature-tolerances';
import type { MachiningNeedResult } from '../shared/tolerance/machining-need';

export interface CatalogRow { operation: string; featureType: string }

/** Top-level catalog rows of a process: "Process:Operation//Feature" (no child step). */
export function topLevelCatalogRows(rawCompoundStrings: readonly string[]): CatalogRow[] {
  const out = new Map<string, CatalogRow>();
  for (const raw of rawCompoundStrings) {
    const segs = raw.split(':');
    const first = segs.findIndex((s) => s.includes('//'));
    if (first < 0 || first !== segs.length - 1) continue;
    const [operation, featureType] = segs[first]!.split('//').map((x) => x.trim());
    if (operation && featureType) out.set(`${operation}//${featureType}`, { operation, featureType });
  }
  return [...out.values()];
}

interface FeatureOperationGroup {
  /** "As Cast", "No Coring", ...; null when the operation is undetermined. */
  operation: string | null;
  featureType: string;
  instances: Array<{ label: string; featureId: string | null; occurrenceIndex: number }>;
  reason: string;
}

const HOLES = new Set(['SimpleHole', 'MultiStepHole']);

/** The catalog operation, per die-casting process, that leaves a feature uncast
 *  (memory/Die Casting/Processes/operations.csv: High Pressure Die Casting
 *  "No Coring//...", Gravity Die Casting "No Side Pull//..."). */
export const CASTING_NOT_FORMED_OPERATION: Readonly<Record<string, string>> = {
  'High Pressure Die Casting': 'No Coring',
  'Gravity Die Casting': 'No Side Pull',
};
const PARALLEL_DOT = 0.9999;

export function selectCastingOperations(input: {
  instances: readonly FeatureInstance[];
  catalog: readonly CatalogRow[];
  need: MachiningNeedResult | null;
  /** The die's pull direction (cad-engine primary_setup_axis). */
  pullAxis: readonly number[] | null;
  /** The catalog operation that leaves a feature uncast (CASTING_NOT_FORMED_OPERATION). */
  notFormedOperation: string;
}): FeatureOperationGroup[] {
  const opsFor = (t: string) => new Set(input.catalog.filter((r) => r.featureType === t).map((r) => r.operation));
  const needByLabel = new Map((input.need?.features ?? []).map((f) => [f.label, f]));
  const groups = new Map<string, FeatureOperationGroup>();
  const add = (inst: FeatureInstance, operation: string | null, reason: string) => {
    const k = `${operation ?? ''}//${inst.featureType}//${reason}`;
    const g = groups.get(k) ?? { operation, featureType: inst.featureType, instances: [], reason };
    g.instances.push({ label: inst.label, featureId: inst.featureId, occurrenceIndex: inst.occurrenceIndex });
    groups.set(k, g);
  };
  const pick = (inst: FeatureInstance, wanted: string, reason: string) => {
    if (opsFor(inst.featureType).has(wanted)) add(inst, wanted, reason);
    else add(inst, null, `${wanted} // ${inst.featureType} is not in the catalog`);
  };

  for (const inst of input.instances) {
    const ops = opsFor(inst.featureType);
    if (ops.size === 0) { add(inst, null, `the catalog has no operation for ${inst.featureType}`); continue; }
    const n = needByLabel.get(inst.label);
    if (n?.forming) { pick(inst, input.notFormedOperation, `not cast: ${n.forming.operation} forms it after casting`); continue; }
    if (inst.featureType === 'SlideBundle') { pick(inst, 'Slides', 'undercuts formed by die slides'); continue; }
    if (inst.featureType === 'Void') { pick(inst, 'As Cast', 'the undercut is cast, formed by a slide'); continue; }
    if (HOLES.has(inst.featureType)) {
      const a = inst.axis;
      const p = input.pullAxis;
      if (!a || !p || p.length !== 3) { add(inst, null, 'hole or pull axis not measured: coring direction unknown'); continue; }
      const dot = Math.abs(a[0] * p[0]! + a[1] * p[1]! + a[2] * p[2]!);
      if (dot >= PARALLEL_DOT) pick(inst, 'As Cast', 'cored by a die pin along the pull direction');
      else {
        const sideCores = [...ops].filter((o) => o !== 'As Cast' && o !== input.notFormedOperation);
        add(inst, null, `hole across the pull direction needs a side core${sideCores.length ? ` (${sideCores.join(' or ')})` : ''}, not decided from geometry`);
      }
      continue;
    }
    if (ops.size === 1) { add(inst, [...ops][0]!, 'the only catalog operation for this feature'); continue; }
    if (ops.has('As Cast')) { add(inst, 'As Cast', 'formed in the die cavity'); continue; }
    add(inst, null, `catalog offers ${[...ops].join(' / ')}; not decided`);
  }
  return [...groups.values()];
}
