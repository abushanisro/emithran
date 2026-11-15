// Required tolerances per detected feature instance. Pure; every domain.
//
//   instances    every occurrence of every feature_graph_v2 entry (casting,
//                sheet metal, machining extractors all emit
//                source_face_stable_ids), keyed so the key survives
//                re-analysis: feature type + hash of its sorted stable face ids.
//   manual       feature_tolerances rows (migration 881): the engineer value
//                for one category of one instance ("Manual").
//   policy       scenario_overrides.tolerancePolicy, for every category with no
//                manual value ("Auto"):
//                  assume_achieved  no requirement: whatever the feature
//                                   operation achieves is sufficient (default)
//                  uniform          the same values for every feature
//                  cad              tolerances carried in the STEP model (PMI),
//                                   applied to the instance whose faces they
//                                   name; values finer than replaceBelow.threshold
//                                   are replaced by replaceBelow.with
//                  auto_detect      the model's tolerances that auto-detect.ts reads
//                                   as a requirement on one feature (native or
//                                   engineer-approved PMI, a validated
//                                   interpretation, no conflict); the rest is
//                                   listed for review and applies nothing
//
// Every requirement carries its source; nothing is inferred from geometry.

import { createHash } from 'crypto';
import type { GdtCallout } from '../physics/gdt-callouts';
import { GTOL_CATEGORIES, type GtolCategory, type Requirement } from './process-capability';
import { EMPTY_DETECTION, type ToleranceDetection } from './auto-detect';

export interface FeatureInstance {
  /** Stable across re-analysis; null when a face has no stable id (not editable). */
  key: string | null;
  /** This analysis's feature_graph_v2 entry id and occurrence index (viewer highlighting). */
  featureId: string | null;
  occurrenceIndex: number;
  featureType: string;
  variant: string | null;
  /** "SimpleHole:3" -- numbered per type in feature-graph order. */
  label: string;
  /** Face ordinals (viewer highlighting) and their content-based stable ids. */
  faceIds: number[];
  stableFaceIds: string[];
  /** Nominal size ISO 286 grades the tolerance by (mm), when the feature has one. */
  sizeMm: number | null;
  sizeSource: string | null;
  /** Hole depth (mm) as measured by the hole detector; null for other features. */
  depthMm: number | null;
  /** Oriented-box sides of the occurrence's faces, longest first (cad-engine feature_extent.py). */
  extentsMm: number[] | null;
  /** Occurrence centroid (mm, model frame) and, for a hole, its unit axis direction. */
  centroidMm: [number, number, number] | null;
  axis: [number, number, number] | null;
  /** Tool approach direction (cad-engine tool_axis) and whether either end reaches it; null when the feature has no single tool axis. */
  toolAxis: [number, number, number] | null;
  toolAxisBidirectional: boolean;
  /** A stepped hole's steps, largest first (diameter and depth, mm). */
  steps: Array<{ diameterMm: number; depthMm: number }> | null;
  /** An edge's measured length (mm); null for other features. */
  lengthMm: number | null;
}

/** Feature types that are not features of the part (faces no detector claimed). */
const NOT_A_FEATURE = new Set(['NotSupported']);

/**
 * The nominal size ISO 286 grades a tolerance by, in priority: the hole
 * diameter on the occurrence (casting, sheet metal) or on the feature entry
 * (machining), a stepped hole's largest diameter, else extent_mm -- the
 * longest side of the oriented box of the occurrence's own faces, measured by
 * cad-engine shared/feature_extent.py. null when none was measured.
 */
function nominalSize(entry: Record<string, any>, occ: Record<string, any>): { sizeMm: number; source: string } | null {
  const candidates: Array<[unknown, string]> = [
    [occ.diameter_mm, 'diameter_mm'],
    [entry.diameter_mm, 'diameter_mm'],
    [occ.max_diameter_mm, 'max_diameter_mm'],
    [occ.extent_mm, 'extent_mm'],
  ];
  for (const [v, source] of candidates) if (Number(v) > 0) return { sizeMm: Number(v), source };
  return null;
}

const vec3 = (v: unknown): [number, number, number] | null =>
  Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(Number(x))) ? [Number(v[0]), Number(v[1]), Number(v[2])] : null;

export function featureKey(featureType: string, stableFaceIds: readonly string[]): string {
  const digest = createHash('sha1').update([...stableFaceIds].sort().join('|')).digest('hex').slice(0, 16);
  return `${featureType}:${digest}`;
}

export function featureInstances(featureGraphV2: unknown): FeatureInstance[] {
  const features = (featureGraphV2 as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const counter = new Map<string, number>();
  const out: FeatureInstance[] = [];
  for (const f of features as Array<Record<string, any>>) {
    const featureType = String(f?.feature_type ?? '');
    if (!featureType || NOT_A_FEATURE.has(featureType)) continue;
    const occurrences = (Array.isArray(f.occurrences) ? f.occurrences : []) as Array<Record<string, any>>;
    for (const [occurrenceIndex, occ] of occurrences.entries()) {
      const n = (counter.get(featureType) ?? 0) + 1;
      counter.set(featureType, n);
      const faceIds = (Array.isArray(occ.face_ids) ? occ.face_ids : []).filter((x: unknown): x is number => typeof x === 'number');
      const stable = Array.isArray(occ.source_face_stable_ids) ? occ.source_face_stable_ids : [];
      const complete = stable.length > 0 && stable.length === faceIds.length && stable.every((s: unknown) => typeof s === 'string' && s);
      const size = nominalSize(f, occ);
      const extents = Array.isArray(occ.extents_mm) && occ.extents_mm.every((x: unknown) => Number(x) >= 0)
        ? (occ.extents_mm as unknown[]).map(Number) : null;
      out.push({
        key: complete ? featureKey(featureType, stable) : null,
        featureId: typeof f.id === 'string' ? f.id : null,
        occurrenceIndex,
        featureType,
        variant: typeof f.variant === 'string' ? f.variant : null,
        label: `${featureType}:${n}`,
        faceIds,
        stableFaceIds: complete ? [...stable] : [],
        sizeMm: size?.sizeMm ?? null,
        sizeSource: size?.source ?? null,
        depthMm: Number(occ.depth_mm) > 0 ? Number(occ.depth_mm) : null,
        extentsMm: extents,
        centroidMm: vec3(occ.centroid),
        axis: vec3(occ.axis),
        toolAxis: vec3(occ.tool_axis),
        toolAxisBidirectional: occ.tool_axis_bidirectional === true,
        lengthMm: Number(occ.length_mm) > 0 ? Number(occ.length_mm) : null,
        steps: Array.isArray(occ.steps)
          ? (occ.steps as Array<Record<string, unknown>>).map((st) => ({ diameterMm: Number(st.diameter_mm), depthMm: Number(st.depth_mm) }))
              .filter((st) => st.diameterMm > 0)
          : null,
      });
    }
  }
  return out;
}

// ── Policy ──────────────────────────────────────────────────────────────────

export type TolerancePolicy =
  | { mode: 'assume_achieved' }
  | { mode: 'uniform'; values: Partial<Record<GtolCategory, number>> }
  | { mode: 'cad'; replaceBelow: { thresholdMm: number; withMm: number } | null }
  | { mode: 'auto_detect' };

/** No policy stored = the first option of the policy dialog. */
const DEFAULT_TOLERANCE_POLICY: TolerancePolicy = { mode: 'assume_achieved' };

const isCategory = (c: string): c is GtolCategory => (GTOL_CATEGORIES as readonly string[]).includes(c);
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

export function parseTolerancePolicy(raw: unknown): { policy: TolerancePolicy | null; errors: string[] } {
  if (raw == null) return { policy: DEFAULT_TOLERANCE_POLICY, errors: [] };
  const r = raw as Record<string, unknown>;
  const errors: string[] = [];
  if (r.mode === 'assume_achieved') return { policy: { mode: 'assume_achieved' }, errors };
  if (r.mode === 'auto_detect') return { policy: { mode: 'auto_detect' }, errors };
  if (r.mode === 'uniform') {
    const values: Partial<Record<GtolCategory, number>> = {};
    for (const [k, v] of Object.entries((r.values ?? {}) as Record<string, unknown>)) {
      if (!isCategory(k)) errors.push(`unknown tolerance category "${k}"`);
      else if (!positive(v)) errors.push(`${k} must be a positive number`);
      else values[k] = v;
    }
    if (Object.keys(values).length === 0 && errors.length === 0) errors.push('uniform policy needs at least one value');
    return { policy: errors.length ? null : { mode: 'uniform', values }, errors };
  }
  if (r.mode === 'cad') {
    const rb = r.replaceBelow as Record<string, unknown> | null | undefined;
    if (rb == null) return { policy: { mode: 'cad', replaceBelow: null }, errors };
    if (!positive(rb.thresholdMm) || !positive(rb.withMm)) {
      errors.push('replaceBelow needs positive thresholdMm and withMm');
      return { policy: null, errors };
    }
    return { policy: { mode: 'cad', replaceBelow: { thresholdMm: rb.thresholdMm, withMm: rb.withMm } }, errors };
  }
  return { policy: null, errors: [`unknown policy mode "${String(r.mode)}"`] };
}

// ── STEP PMI symbol -> capability category ─────────────────────────────────

/**
 * cad-engine shared/step_pmi.py symbols to tblGtolProcessCapabilities
 * categories. coaxiality -> concentricity: ISO 1101 coaxiality is concentricity
 * of an axis, and the capability table carries only concentricity.
 * profile_of_line has no capability row and stays unmapped (reported).
 */
export const PMI_CATEGORY: Readonly<Record<string, GtolCategory>> = {
  angularity: 'angularity',
  circular_runout: 'runout',
  coaxiality: 'concentricity',
  concentricity: 'concentricity',
  cylindricity: 'cylindricity',
  flatness: 'flatness',
  parallelism: 'parallelism',
  perpendicularity: 'perpendicularity',
  position: 'positionTolerance',
  circularity: 'circularity',
  straightness: 'straightness',
  profile_of_surface: 'profileOfSurface',
  symmetry: 'symmetry',
  total_runout: 'totalRunout',
};

// ── Resolution ──────────────────────────────────────────────────────────────

type RequirementSource = 'manual' | 'policy_uniform' | 'cad_model' | 'cad_model_replaced' | 'auto_detected';

export interface ResolvedRequirement extends Requirement {
  source: RequirementSource;
  note?: string;
  /** The annotation an auto-detected requirement was read from, and why it may drive a decision. */
  origin?: { recordId: string; annotationRef: string; basis: 'native_pmi' | 'engineer_approved'; stated: string };
}

export interface ManualTolerance { featureKey: string; category: GtolCategory; value: number }

export interface InstanceRequirements {
  instance: FeatureInstance;
  requirements: ResolvedRequirement[];
}

export interface ToleranceResolution {
  instances: InstanceRequirements[];
  /** Manual rows whose feature no longer exists after re-analysis. */
  orphanedManual: ManualTolerance[];
  /** CAD tolerances not applied, with why (cad policy only). */
  unappliedCad: Array<{ type: string; toleranceMm: number; reason: string }>;
  /** What the part's files state about tolerances and how each reads (auto-detect.ts), whatever the policy; applied only by the auto_detect policy. */
  detection: ToleranceDetection;
}

export function resolveFeatureRequirements(input: {
  instances: readonly FeatureInstance[];
  manual: readonly ManualTolerance[];
  policy: TolerancePolicy;
  callouts: readonly GdtCallout[];
  detection?: ToleranceDetection;
}): ToleranceResolution {
  const byKey = new Map<string, ManualTolerance[]>();
  for (const m of input.manual) byKey.set(m.featureKey, [...(byKey.get(m.featureKey) ?? []), m]);
  const known = new Set(input.instances.map((i) => i.key).filter(Boolean));
  const orphanedManual = input.manual.filter((m) => !known.has(m.featureKey));

  // CAD values per instance (cad policy only): a callout applies to the
  // instance owning any of its faces.
  const cadByKey = new Map<string, ResolvedRequirement[]>();
  const unappliedCad: ToleranceResolution['unappliedCad'] = [];
  if (input.policy.mode === 'cad') {
    const ownerOf = new Map<string, FeatureInstance>();
    for (const inst of input.instances) if (inst.key) for (const s of inst.stableFaceIds) ownerOf.set(s, inst);
    const rb = input.policy.replaceBelow;
    for (const c of input.callouts) {
      const category = PMI_CATEGORY[c.type];
      if (!category) { unappliedCad.push({ type: c.type, toleranceMm: c.toleranceMm, reason: 'no capability category for this tolerance type' }); continue; }
      if (c.source !== 'step_pmi' || c.faceIds.length === 0) { unappliedCad.push({ type: c.type, toleranceMm: c.toleranceMm, reason: 'not linked to a face in the model' }); continue; }
      const owners = new Set(c.faceIds.map((f) => ownerOf.get(f)).filter((x): x is FeatureInstance => !!x));
      if (owners.size === 0) { unappliedCad.push({ type: c.type, toleranceMm: c.toleranceMm, reason: 'its faces belong to no detected feature' }); continue; }
      const replaced = rb != null && c.toleranceMm < rb.thresholdMm;
      const req: ResolvedRequirement = replaced
        ? { category, value: rb!.withMm, source: 'cad_model_replaced', note: `model ${c.toleranceMm} mm < ${rb!.thresholdMm} mm, replaced` }
        : { category, value: c.toleranceMm, source: 'cad_model' };
      for (const o of owners) {
        const list = cadByKey.get(o.key!) ?? [];
        // Two callouts of one category on one feature: the finer governs.
        const existing = list.find((x) => x.category === category);
        if (!existing) list.push(req);
        else if (req.value < existing.value) list.splice(list.indexOf(existing), 1, req);
        cadByKey.set(o.key!, list);
      }
    }
  }

  // Auto-detected values per instance (auto_detect policy only): the interpretable detections, each on the features it names.
  const detection = input.detection ?? EMPTY_DETECTION;
  const detectedByKey = new Map<string, ResolvedRequirement[]>();
  if (input.policy.mode === 'auto_detect') {
    for (const d of detection.detected) {
      if (d.status !== 'interpretable' || !d.category || d.value == null || !d.basis) continue;
      for (const key of d.featureKeys) {
        const list = detectedByKey.get(key) ?? [];
        if (!list.some((x) => x.category === d.category)) {
          list.push({ category: d.category, value: d.value, source: 'auto_detected', origin: { recordId: d.recordId, annotationRef: d.annotationRef, basis: d.basis, stated: d.stated } });
        }
        detectedByKey.set(key, list);
      }
    }
  }

  const instances = input.instances.map((instance) => {
    const manual = instance.key ? byKey.get(instance.key) ?? [] : [];
    const requirements: ResolvedRequirement[] = manual.map((m) => ({ category: m.category, value: m.value, source: 'manual' as const }));
    const set = new Set(requirements.map((r) => r.category));
    const auto: ResolvedRequirement[] =
      input.policy.mode === 'uniform'
        ? Object.entries(input.policy.values).map(([category, value]) => ({ category: category as GtolCategory, value: value!, source: 'policy_uniform' as const }))
        : input.policy.mode === 'cad' && instance.key
          ? cadByKey.get(instance.key) ?? []
          : input.policy.mode === 'auto_detect' && instance.key
            ? detectedByKey.get(instance.key) ?? []
            : [];
    for (const a of auto) if (!set.has(a.category)) requirements.push(a);
    return { instance, requirements };
  });
  return { instances, orphanedManual, unappliedCad, detection };
}
