/**
 * Machining allowance of a casting: the stock left on a face that is machined after casting, so the finished size can be cut from it. It is
 * NOT pattern shrinkage (the pattern scaled for cooling); nothing here scales the part. Pure; display only, no cost uses it.
 *
 * Which features: those machining-need.ts says the casting leaves short (needs_machining), and those an engineer marked machined; an
 * undecided one is listed for review; one the engineer marked not machined is left out. Never "every face".
 *
 * Where each value comes from, the first source that has one (migration 1002):
 *   1 specified                 an engineer's recorded decision from the drawing, the CAD model's PMI or the customer's specification
 *   2 standard_derived          a LICENSED standard dataset (ISO 8062-3): the part's RMAG grade and the casting's largest dimension pick
 *                               one size band's value, exactly; no interpolation, no grade inferred
 *   3 foundry_profile_derived   an APPROVED foundry or customer profile: its most specific value for the material family and moulding
 *                               method at the casting's size
 *   4 estimated                 an engineer's recorded estimate, with its reason
 *   5 requires_review           otherwise, with what is missing
 * Two datasets or two profiles that disagree are not chosen between: requires_review. A decision made on an earlier file (another geometry
 * hash) counts for nothing.
 *
 * As cast: an internal feature (hole) is cast smaller, diameter - 2a; a planar face is offset a along its normal; an external dimension
 * machined on both sides grows 2a. The finished geometry is unchanged; validating the offset solid is the casting worker's (later).
 */

export type AllowanceStatus = 'specified' | 'standard_derived' | 'foundry_profile_derived' | 'estimated' | 'requires_review';
export type MouldingMethod = 'hand' | 'machine' | 'no_bake';
type DecisionBasis = 'engineering_drawing' | 'cad_model_pmi' | 'customer_specification' | 'engineering_estimate' | 'not_machined';

export interface AllowanceFeature {
  featureKey: string;
  featureType: string;
  label: string;
  faceIds: number[];
  featureId: string | null;
  occurrenceIndex: number;
  /** The finished size (a hole's diameter), mm; null when not measured. */
  sizeMm: number | null;
  verdict: 'as_primary' | 'needs_machining' | 'undecided';
}

/** The current decision on a feature (bom_item_machining_allowances, superseded_at null). */
export interface AllowanceDecision {
  id: string;
  featureKey: string;
  machined: boolean;
  allowanceMm: number | null;
  sides: 1 | 2 | null;
  basis: DecisionBasis;
  reason: string;
  geometryHash: string;
  setByEmail: string | null;
  setAt: string;
}

export interface AllowanceDataset {
  id: string;
  standard: string;
  edition: string;
  licenceReference: string;
  importedAt: string;
  values: Array<{ rmag: string; sizeOverMm: number; sizeUptoMm: number; allowanceMm: number }>;
}

/** An approved profile (its latest approved version). */
export interface AllowanceProfile {
  id: string;
  name: string;
  kind: 'foundry' | 'customer';
  version: number;
  basis: string;
  reviewedAt: string | null;
  values: Array<{ materialFamily: string | null; mouldingMethod: MouldingMethod | null; sizeOverMm: number; sizeUptoMm: number; allowanceMm: number }>;
}

export interface AllowanceSource {
  level: 1 | 2 | 3 | 4 | 5;
  kind: 'decision' | 'dataset' | 'profile' | 'none';
  id: string | null;
  /** Human-readable provenance: the standard and licence, the profile and version, or the decision's basis. */
  ref: string | null;
  basis?: DecisionBasis;
  reason?: string;
  setBy?: string | null;
  setAt?: string;
}

export interface FeatureAllowance {
  featureKey: string;
  featureType: string;
  label: string;
  faceIds: number[];
  featureId: string | null;
  occurrenceIndex: number;
  status: AllowanceStatus;
  /** Per machined face, mm; null when requires_review. */
  allowanceMm: number | null;
  /** Faces of the dimension that carry it: 2 = both sides of a diameter or a width. */
  sides: 1 | 2 | null;
  unit: 'mm';
  source: AllowanceSource;
  asCast: { rule: 'internal' | 'planar' | 'external'; finishedMm: number | null; asCastMm: number | null; detail: string } | null;
  notes: string[];
}

export interface MachiningAllowanceResult {
  features: FeatureAllowance[];
  notMachined: Array<{ featureKey: string; label: string; reason: string; setBy: string | null }>;
  /** Display only: no cost uses these values yet. */
  costed: false;
}

const SPECIFIED: ReadonlySet<DecisionBasis> = new Set(['engineering_drawing', 'cad_model_pmi', 'customer_specification']);
const INTERNAL = new Set(['SimpleHole', 'MultiStepHole', 'Void']);
const PLANAR = new Set(['PlanarFace']);

/** The moulding method of a sand moulding process (sand-route.ts MOULDING_PROCESSES); null when not one of them. */
export function mouldingMethodOf(process: string | null | undefined): MouldingMethod | null {
  if (!process) return null;
  if (/automatic/i.test(process)) return 'machine';
  if (/^manual\b/i.test(process)) return 'hand';
  return null;
}

const inBand = (size: number, v: { sizeOverMm: number; sizeUptoMm: number }) => size > v.sizeOverMm && size <= v.sizeUptoMm;
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/** The licensed value: exactly one band of the part's grade, agreeing across datasets. */
function fromDatasets(datasets: readonly AllowanceDataset[], rmag: string | null, size: number | null, notes: string[]) {
  if (datasets.length === 0) return null;
  if (!rmag) { notes.push('a licensed dataset is on file but no RMAG grade is set for the part'); return null; }
  if (size == null) { notes.push('the casting\'s largest dimension is not measured: the dataset size band cannot be chosen'); return null; }
  const hits = datasets.flatMap((d) => d.values.filter((v) => v.rmag === rmag && inBand(size, v)).map((v) => ({ d, v })));
  if (hits.length === 0) { notes.push(`no value for RMAG ${rmag} at ${fmt(size)} mm in the licensed dataset${datasets.length > 1 ? 's' : ''}`); return null; }
  if (new Set(hits.map((h) => h.v.allowanceMm)).size > 1) {
    notes.push(`the licensed datasets disagree (${hits.map((h) => `${h.d.standard} ${h.d.edition}: ${h.v.allowanceMm} mm`).join('; ')}): choose one`);
    return 'conflict' as const;
  }
  const { d, v } = hits[0]!;
  return { value: v.allowanceMm, source: { level: 2, kind: 'dataset', id: d.id, ref: `${d.standard} ${d.edition}, RMAG ${rmag}, licence ${d.licenceReference}` } as AllowanceSource };
}

/** Each approved profile's most specific value at the size; profiles that disagree are not chosen between. */
function fromProfiles(profiles: readonly AllowanceProfile[], family: string | null, method: MouldingMethod | null, size: number | null, notes: string[]) {
  if (profiles.length === 0) return null;
  if (size == null) { notes.push('the casting\'s largest dimension is not measured: a profile size band cannot be chosen'); return null; }
  const hits = profiles.flatMap((p) => {
    const fits = p.values
      .filter((v) => inBand(size, v) && (v.materialFamily == null || v.materialFamily === family) && (v.mouldingMethod == null || v.mouldingMethod === method))
      .sort((a, b) => (Number(b.materialFamily != null) * 2 + Number(b.mouldingMethod != null)) - (Number(a.materialFamily != null) * 2 + Number(a.mouldingMethod != null)));
    return fits[0] ? [{ p, v: fits[0] }] : [];
  });
  if (hits.length === 0) { notes.push(`no approved profile has a value at ${fmt(size)} mm for ${family ?? 'this material'}`); return null; }
  if (new Set(hits.map((h) => h.v.allowanceMm)).size > 1) {
    notes.push(`the approved profiles disagree (${hits.map((h) => `${h.p.name} v${h.p.version}: ${h.v.allowanceMm} mm`).join('; ')}): choose one`);
    return 'conflict' as const;
  }
  const { p, v } = hits[0]!;
  const scope = [v.materialFamily, v.mouldingMethod && `${v.mouldingMethod} moulding`].filter(Boolean).join(', ');
  return { value: v.allowanceMm, source: { level: 3, kind: 'profile', id: p.id, ref: `${p.name} v${p.version} (${p.kind}; ${p.basis})${scope ? `, ${scope}` : ''}` } as AllowanceSource };
}

function asCastOf(f: AllowanceFeature, a: number, sides: 1 | 2): FeatureAllowance['asCast'] {
  if (INTERNAL.has(f.featureType)) {
    const asCastMm = f.sizeMm != null ? f.sizeMm - 2 * a : null;
    return { rule: 'internal', finishedMm: f.sizeMm, asCastMm,
      detail: f.sizeMm != null ? `cast at Ø${fmt(asCastMm!)} mm, machined to Ø${fmt(f.sizeMm)} mm (- 2 × ${fmt(a)} mm)` : `cast ${fmt(2 * a)} mm smaller across (size not measured)` };
  }
  if (PLANAR.has(f.featureType)) return { rule: 'planar', finishedMm: null, asCastMm: null, detail: `face offset ${fmt(a)} mm along its normal` };
  return { rule: 'external', finishedMm: f.sizeMm, asCastMm: f.sizeMm != null ? f.sizeMm + sides * a : null, detail: `+${fmt(sides * a)} mm (${sides} side${sides === 2 ? 's' : ''})` };
}

export function resolveMachiningAllowance(input: {
  features: readonly AllowanceFeature[];
  decisions: readonly AllowanceDecision[];
  /** The part's current geometry hash (bom_items.geometry_hash); null = not analysed: no decision can be trusted. */
  geometryHash: string | null;
  largestDimensionMm: number | null;
  rmag: string | null;
  materialFamily: string | null;
  mouldingMethod: MouldingMethod | null;
  datasets: readonly AllowanceDataset[];
  profiles: readonly AllowanceProfile[];
}): MachiningAllowanceResult {
  const decisionOf = new Map(input.decisions.map((d) => [d.featureKey, d]));
  const features: FeatureAllowance[] = [];
  const notMachined: MachiningAllowanceResult['notMachined'] = [];

  for (const f of input.features) {
    const notes: string[] = [];
    const raw = decisionOf.get(f.featureKey);
    const fresh = raw && input.geometryHash != null && raw.geometryHash === input.geometryHash ? raw : undefined;
    if (raw && !fresh) notes.push(`a decision by ${raw.setByEmail ?? 'an engineer'} was made on an earlier file: decide again`);

    if (fresh && !fresh.machined) {
      notMachined.push({ featureKey: f.featureKey, label: f.label, reason: fresh.reason, setBy: fresh.setByEmail });
      continue;
    }
    if (!fresh && f.verdict === 'as_primary') continue;

    const out = (status: AllowanceStatus, allowanceMm: number | null, sides: 1 | 2 | null, source: AllowanceSource): void => {
      let s = status;
      const asCast = allowanceMm != null && sides != null ? asCastOf(f, allowanceMm, sides) : null;
      if (asCast?.rule === 'internal' && asCast.asCastMm != null && asCast.asCastMm <= 0) {
        notes.push(`the allowance closes the hole (Ø${fmt(f.sizeMm!)} mm - 2 × ${fmt(allowanceMm!)} mm): cast it solid and drill, or reduce the allowance`);
        s = 'requires_review';
      }
      features.push({ featureKey: f.featureKey, featureType: f.featureType, label: f.label, faceIds: f.faceIds, featureId: f.featureId,
        occurrenceIndex: f.occurrenceIndex, status: s, allowanceMm, sides, unit: 'mm', source, asCast, notes });
    };
    const fromDecision = (level: 1 | 4, d: AllowanceDecision): AllowanceSource =>
      ({ level, kind: 'decision', id: d.id, ref: d.basis.replace(/_/g, ' '), basis: d.basis, reason: d.reason, setBy: d.setByEmail, setAt: d.setAt });
    const none: AllowanceSource = { level: 5, kind: 'none', id: null, ref: null };

    if (!fresh && f.verdict === 'undecided') {
      notes.push('whether it is machined is undecided (machining need): mark it machined or not');
      out('requires_review', null, null, none);
      continue;
    }
    // 1. specified
    if (fresh && SPECIFIED.has(fresh.basis)) { out('specified', fresh.allowanceMm, fresh.sides, fromDecision(1, fresh)); continue; }
    // 2 and 3: a licensed dataset, else an approved profile; on a hole the value is per side of the diameter
    const sides: 1 | 2 = INTERNAL.has(f.featureType) ? 2 : 1;
    const ds = fromDatasets(input.datasets, input.rmag, input.largestDimensionMm, notes);
    const pr = ds ? null : fromProfiles(input.profiles, input.materialFamily, input.mouldingMethod, input.largestDimensionMm, notes);
    const found = ds && ds !== 'conflict' ? ds : pr && pr !== 'conflict' ? pr : null;
    if (found) {
      if (fresh?.basis === 'engineering_estimate') notes.push(`an engineer's estimate of ${fmt(fresh.allowanceMm!)} mm is on file; the ${found.source.kind} value comes first`);
      out(found.source.level === 2 ? 'standard_derived' : 'foundry_profile_derived', found.value, sides, found.source);
      continue;
    }
    if (ds === 'conflict' || pr === 'conflict') { out('requires_review', null, null, none); continue; }
    // 4. estimated
    if (fresh?.basis === 'engineering_estimate') { out('estimated', fresh.allowanceMm, fresh.sides, fromDecision(4, fresh)); continue; }
    // 5.
    if (input.datasets.length === 0 && input.profiles.length === 0) notes.push('no drawing value, licensed dataset, approved profile or estimate');
    out('requires_review', null, null, none);
  }
  return { features, notMachined, costed: false };
}
