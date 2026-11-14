// What the part's files say about tolerances, and which of it can be read as a requirement on one feature. Pure, and the same for every manufacturing process:
// nothing here knows what a process holds or what an operation costs (that is process-profile.ts and the engines behind it).
//
// Sources, never merged:
//   model PMI records   feature graph pmi.records (pmi-records.ts): dimensions with limits and geometric tolerances, each with its validation and review state and
//                       the faces the engine tied it to
//   model callouts      feature graph pmi.gdt_callouts with a STEP face link (gdt-callouts.ts), on an analysis that predates the records
//   drawing callouts    drawing_intelligence.gdt_callouts: a type and a value with no tie to the 3D model
//   general tolerance   drawing_intelligence.general_tolerances (ISO 2768-m, ISO 8062-3 DCTG ...): a note about every untoleranced dimension
//
// A record becomes a requirement ('interpretable') only when all of this holds:
//   - it may drive a decision: native verified PMI, or a decoded value an engineer approved for this content and this file;
//   - it states one of the interpretations below, in millimetres, with no modifier on its zone;
//   - the engine tied it to at least one detected feature of the type the interpretation is about;
//   - no second record states a different value of the same category on the same feature, and the drawing does not state another value of it.
//
//   diameter with limits (not basic)          hole            diamTolerance = half the band
//   position zone                             hole            positionTolerance
//   circularity, cylindricity zone            hole            the same category
//   flatness, parallelism, perpendicularity   planar face     the same category
//
// Everything else is 'review' with its code and a sentence, or 'not_a_requirement' (a basic dimension, a nominal with no tolerance, a datum). Nothing is inferred
// from geometry, and a general tolerance is reported, never spread onto features: no table of it is staged.

import type { GdtCallout } from '../physics/gdt-callouts';
import { PMI_CATEGORY, type FeatureInstance } from './feature-tolerances';
import type { PmiRecord } from './pmi-records';
import type { GtolCategory } from './process-capability';

export type ToleranceReviewCode =
  | 'drawing_only' | 'not_associated' | 'unsupported_feature' | 'unsupported_characteristic' | 'modifier_not_modelled'
  | 'decoded_unapproved' | 'stale_or_rejected' | 'record_conflict' | 'unresolved' | 'duplicate_differs' | 'drawing_cad_conflict' | 'non_mm_unit';

export interface DetectedTolerance {
  /** The PMI record id, or `callout:<n>` / `drawing:<n>` for a callout. */
  recordId: string;
  /** The annotation as the file names it (the callout's type for a drawing). */
  annotationRef: string;
  origin: 'model_pmi' | 'drawing';
  /** diameter | position | flatness | ... as the file states it. */
  characteristic: string;
  /** The capability category and value it amounts to (+/- mm for a size, zone width in mm otherwise); null when it has no interpretation. */
  category: GtolCategory | null;
  value: number | null;
  /** What the file states, for display: "Ø5.5 5.35 to 5.65", "position 0.15". */
  stated: string;
  /** Why it may drive a decision; null when it may not. */
  basis: 'native_pmi' | 'engineer_approved' | null;
  /** The detected features it applies to (stable keys and labels, same order). */
  featureKeys: string[];
  labels: string[];
  /** How the engine tied it to those features, in its own words. */
  association: string;
  status: 'interpretable' | 'review' | 'not_a_requirement';
  reviewCode: ToleranceReviewCode | null;
  reason: string;
}

export interface GeneralTolerance {
  text: string;
  standard: 'ISO 2768' | 'ISO 8062-3' | 'unsupported';
  /** Always false: a general tolerance is reported, not applied to features. */
  applied: false;
  reason: string;
}

export interface ToleranceConflict { characteristic: string; drawingMm: number; modelMm: number[]; detail: string }

export interface ToleranceDetection {
  detected: DetectedTolerance[];
  general: GeneralTolerance | null;
  conflicts: ToleranceConflict[];
}

export const EMPTY_DETECTION: ToleranceDetection = { detected: [], general: null, conflicts: [] };

const HOLE_TYPES: ReadonlySet<string> = new Set(['SimpleHole', 'MultiStepHole']);
const FACE_TYPES: ReadonlySet<string> = new Set(['PlanarFace']);

/** The feature types each interpretable category is about. */
const FEATURE_TYPES_OF: Partial<Record<GtolCategory, { types: ReadonlySet<string>; noun: string }>> = {
  diamTolerance: { types: HOLE_TYPES, noun: 'hole' },
  positionTolerance: { types: HOLE_TYPES, noun: 'hole' },
  circularity: { types: HOLE_TYPES, noun: 'hole' },
  cylindricity: { types: HOLE_TYPES, noun: 'hole' },
  flatness: { types: FACE_TYPES, noun: 'planar face' },
  parallelism: { types: FACE_TYPES, noun: 'planar face' },
  perpendicularity: { types: FACE_TYPES, noun: 'planar face' },
};

const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

function generalTolerance(text: string | null | undefined): GeneralTolerance | null {
  const t = text?.trim();
  if (!t) return null;
  const standard = /2768/.test(t) ? 'ISO 2768' : /8062/.test(t) ? 'ISO 8062-3' : 'unsupported';
  return {
    text: t, standard, applied: false,
    reason: standard === 'unsupported'
      ? 'This general-tolerance note is not one of the standards read (ISO 2768, ISO 8062-3): not applied.'
      : `${standard} applies to every dimension with no tolerance of its own. Its table is not staged, so it is reported and not applied to features.`,
  };
}

type Draft = Omit<DetectedTolerance, 'featureKeys' | 'labels' | 'status' | 'reviewCode' | 'reason'> & { owners: FeatureInstance[] };

const review = (d: Draft, reviewCode: ToleranceReviewCode, reason: string): DetectedTolerance => finish(d, 'review', reviewCode, reason);
function finish(d: Draft, status: DetectedTolerance['status'], reviewCode: ToleranceReviewCode | null, reason: string): DetectedTolerance {
  const { owners, ...rest } = d;
  return { ...rest, featureKeys: owners.map((o) => o.key!), labels: owners.map((o) => o.label), status, reviewCode, reason };
}

/** A category's owners among the features a record is tied to, or why it has none. */
function settle(d: Draft, tied: readonly FeatureInstance[]): DetectedTolerance {
  const rule = d.category ? FEATURE_TYPES_OF[d.category] : undefined;
  if (!d.category || !rule || d.value == null) {
    return review(d, 'unsupported_characteristic', `No validated interpretation of a ${d.characteristic} tolerance yet: enter it on the feature if it matters.`);
  }
  if (tied.length === 0) return review(d, 'not_associated', `Tied to no detected feature (${d.association || 'the file links it to no face'}).`);
  const owners = tied.filter((i) => rule.types.has(i.featureType) && i.key);
  if (owners.length === 0) {
    const kinds = [...new Set(tied.map((i) => i.featureType))].join(', ');
    return review(d, 'unsupported_feature', `A ${d.characteristic} tolerance is read on a ${rule.noun}; this one is tied to ${kinds}${tied.some((i) => !i.key) ? ' (no stable id: re-run analysis)' : ''}.`);
  }
  return finish({ ...d, owners }, 'interpretable', null, `${d.stated} on ${owners.map((o) => o.label).join(', ')}.`);
}

function fromRecord(r: PmiRecord, instances: readonly FeatureInstance[]): DetectedTolerance | null {
  if (r.recordType === 'datum') return null;
  const dimension = r.recordType === 'dimension';
  const characteristic = (dimension ? r.dimensionType : r.characteristic) ?? 'unknown';
  const category: GtolCategory | null = dimension ? (characteristic === 'diameter' ? 'diamTolerance' : null) : PMI_CATEGORY[characteristic] ?? null;
  const value = dimension ? (r.limits ? r4((r.limits.maxMm - r.limits.minMm) / 2) : null) : r.zoneMm;
  const stated = dimension
    ? `${characteristic === 'diameter' ? 'Ø' : `${characteristic} `}${r.nominalMm ?? '?'}${r.limits ? ` ${r.limits.minMm} to ${r.limits.maxMm}` : ''}`
    : `${characteristic} ${r.zoneMm ?? '?'}`;
  const faces = new Set(r.faceIds);
  const tied = instances.filter((i) => i.faceIds.some((f) => faces.has(f)));
  const d: Draft = {
    recordId: r.id, annotationRef: r.annotationRef, origin: 'model_pmi', characteristic, category, value, stated,
    basis: r.automationBasis, association: r.association, owners: [],
  };
  if (dimension && r.basic) return finish(d, 'not_a_requirement', null, 'A basic (theoretically exact) dimension: it carries no tolerance of its own.');
  if (dimension && !r.limits) return finish(d, 'not_a_requirement', null, 'The dimension states no tolerance.');
  if (r.reviewState === 'conflict') return review(d, 'record_conflict', 'The model\'s value and its drawn annotation disagree: resolve it in the PMI panel.');
  if (r.reviewState === 'unresolved' || (!dimension && r.zoneMm == null)) return review(d, 'unresolved', 'The annotation could not be read.');
  if (r.reviewState === 'rejected' || r.reviewState === 'stale') {
    return review(d, 'stale_or_rejected', r.reviewState === 'stale' ? 'Approved for an earlier version of the record or the file: review it again.' : 'An engineer rejected this value.');
  }
  if (!r.automationReady) return review(d, 'decoded_unapproved', 'Read from drawn text, not from a model value: an engineer must approve it in the PMI panel first.');
  if (r.unit !== 'mm') return review(d, 'non_mm_unit', `Stated in ${r.unit}, not millimetres.`);
  if (r.modifiers.length > 0) return review(d, 'modifier_not_modelled', `The zone carries a modifier (${r.modifiers.join(', ')}): its effect on the tolerance is not modelled.`);
  return settle(d, tied);
}

export function detectTolerances(input: {
  instances: readonly FeatureInstance[];
  /** resolvePmiRecords(featureGraph, current reviews). */
  records: readonly PmiRecord[];
  /** resolveGdtCallouts(featureGraph, drawing): read only when the analysis carries no records. */
  callouts: readonly GdtCallout[];
  /** drawingGdtCallouts(drawing). */
  drawingCallouts: readonly GdtCallout[];
  generalTolerances?: string | null;
}): ToleranceDetection {
  const detected: DetectedTolerance[] = [];
  for (const r of input.records) {
    const d = fromRecord(r, input.instances);
    if (d) detected.push(d);
  }
  if (input.records.length === 0) {
    // An analysis from before the records: the model's callouts, tied by their STEP face link.
    const ownersOf = new Map<string, FeatureInstance[]>();
    for (const inst of input.instances) for (const s of inst.stableFaceIds) ownersOf.set(s, [...(ownersOf.get(s) ?? []), inst]);
    input.callouts.filter((c) => c.source === 'step_pmi').forEach((c, n) => {
      const tied = [...new Set(c.faceIds.flatMap((f) => ownersOf.get(f) ?? []))];
      detected.push(settle({
        recordId: `callout:${n}`, annotationRef: c.type, origin: 'model_pmi', characteristic: c.type, category: PMI_CATEGORY[c.type] ?? null,
        value: c.toleranceMm, stated: `${c.type} ${c.toleranceMm}`, basis: 'native_pmi',
        association: c.faceIds.length ? 'the STEP face link of the tolerance' : 'the STEP links this tolerance to no face', owners: [],
      }, tied));
    });
  }

  // Two different values of one category on one feature: neither is chosen.
  const byFeatureCategory = new Map<string, DetectedTolerance[]>();
  for (const d of detected) if (d.status === 'interpretable') for (const k of d.featureKeys) {
    const key = `${k}|${d.category}`;
    byFeatureCategory.set(key, [...(byFeatureCategory.get(key) ?? []), d]);
  }
  const differing = new Set<DetectedTolerance>();
  for (const group of byFeatureCategory.values()) if (group.some((d) => !same(d.value!, group[0]!.value!))) for (const d of group) differing.add(d);
  for (const d of differing) {
    Object.assign(d, { status: 'review', reviewCode: 'duplicate_differs', reason: `Two annotations state different ${d.characteristic} values on one feature: enter the governing one on the feature.` });
  }

  // The drawing against the model, characteristic by characteristic (a drawing callout names no feature).
  const conflicts: ToleranceConflict[] = [];
  const model = detected.filter((d) => d.origin === 'model_pmi' && d.category && d.value != null && d.status !== 'not_a_requirement');
  input.drawingCallouts.forEach((c, n) => {
    const category = PMI_CATEGORY[c.type] ?? null;
    const sameKind = model.filter((d) => d.category === category);
    if (category && sameKind.some((d) => same(d.value!, c.toleranceMm))) return; // the two sources agree
    if (category && sameKind.length > 0) {
      const modelMm = [...new Set(sameKind.map((d) => d.value!))];
      conflicts.push({ characteristic: c.type, drawingMm: c.toleranceMm, modelMm, detail: `The drawing states ${c.type} ${c.toleranceMm} mm; the model states ${modelMm.join(', ')} mm.` });
      for (const d of sameKind) if (d.status === 'interpretable') {
        Object.assign(d, { status: 'review', reviewCode: 'drawing_cad_conflict', reason: `The drawing states ${c.type} ${c.toleranceMm} mm, the model ${d.value} mm: enter the governing value on the feature.` });
      }
      return;
    }
    detected.push({
      recordId: `drawing:${n}`, annotationRef: c.type, origin: 'drawing', characteristic: c.type, category, value: c.toleranceMm, stated: `${c.type} ${c.toleranceMm}`,
      basis: null, featureKeys: [], labels: [], association: 'a drawing callout names no model face', status: 'review', reviewCode: 'drawing_only',
      reason: 'Read from the drawing, which ties it to no feature of the model: enter it on the feature it applies to.',
    });
  });

  return { detected, general: generalTolerance(input.generalTolerances), conflicts };
}
