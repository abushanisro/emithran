// Design-for-casting checks of a sand casting analysis (design step S8): the worker's measurements against the published rule data
// (lookupTables_Component_manufacturabilitySeverity: a threshold per severity, per material; adviceRules: which rules are on).
// Pure. A rule the analysis cannot measure is listed as not evaluated with the reason, never reported as passed; every number in a finding is
// either a measurement of the part or a threshold of the rule data, and its explanation is the rule data's own note.

type Row = Readonly<Record<string, unknown>>;

export type DfmSeverity = 'Critical' | 'Major' | 'Minor';
const SEVERITIES: readonly DfmSeverity[] = ['Critical', 'Major', 'Minor'];

export interface DfmFinding {
  rule: string;
  title: string;
  severity: DfmSeverity;
  /** What was measured, and the limit it crossed. */
  measured: number;
  threshold: number;
  comparison: '<' | '>';
  unit: string | null;
  /** The rule data's own note: why the rule exists. */
  note: string | null;
  /** The worker's features the finding is about, and their faces for the viewer. Empty when it concerns the whole part. */
  featureIds: string[];
  faces: number[];
}

export interface DfmResult {
  rulesetVersion: string;
  materialType: string | null;
  findings: DfmFinding[];
  /** Rules the data enables that were measured and not violated. */
  passed: string[];
  /** Rules that could not be judged, with why: a missing measurement or a missing rule row. */
  notEvaluated: Array<{ rule: string; reason: string }>;
}

interface Limits {
  comparison: '<' | '>';
  /** The limit per severity that has one. */
  limits: Partial<Record<DfmSeverity, number>>;
  unit: string | null;
  title: string;
  note: string | null;
}

interface Measured {
  value: number | null;
  featureIds: string[];
  faces: number[];
}

interface WorkerFeature {
  id: string;
  type: string;
  faces: number[];
  parameters: Record<string, number>;
}

/** Rules whose measurement the casting analysis does not hold, and why (named, so a gap is visible and not a silent pass). */
const NOT_MEASURED: Readonly<Record<string, string>> = {
  ClosedVoid: 'the analysis does not report whether a void is open to the outside',
  InaccessibleFeature: 'the analysis does not report features the pattern cannot be drawn from',
  ThinWallAroundHole: 'the wall between neighbouring holes is not measured by the casting analysis',
  ThreadedFeature: 'threads are not recognised by the casting analysis',
};
const TOLERANCE_RULE = /^TightTolerance/;
const TOLERANCE_REASON = 'needs the drawing tolerances compared with the process capability (the tolerance module), not the casting analysis';

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const text = (v: unknown): string => (v == null ? '' : String(v).replace(/^﻿/, '').trim());

/** The rule's limits for the part's material from its rows: the rows with no material apply to every material; otherwise the material's row. */
function limitsFor(rows: readonly Row[], materialType: string | null): Limits | { missing: string } | null {
  const mine = rows.filter((r) => {
    const m = text(r['Material Type']);
    const p = text(r['Process Name']);
    return (m === '' || m === materialType) && (p === '' || p === 'Sand Casting');
  });
  if (mine.length === 0) return rows.length === 0 ? null : { missing: `the rule has no row for ${materialType ?? 'a part with no material type'}` };
  const r = mine[0]!;
  const type = text(r['Rule Type']);
  const limits: Partial<Record<DfmSeverity, number>> = {};
  for (const s of SEVERITIES) {
    const v = num(r[s]);
    if (v != null) limits[s] = v;
  }
  // A yes/no rule (Boolean) has no number to compare: it is not one this evaluator can grade.
  if (type !== '<' && type !== '>') return { missing: `the rule is a ${type || 'yes/no'} rule, which has no measured value to compare` };
  return {
    comparison: type,
    limits,
    unit: text(r['Units']) || null,
    title: text(r['Threshold Name']),
    note: text(r['Notes']) || null,
  };
}

/** The most severe level whose limit the value crosses, or null when it crosses none. */
function severityOf(value: number, l: Limits): { severity: DfmSeverity; threshold: number } | null {
  for (const s of SEVERITIES) {
    const limit = l.limits[s];
    if (limit == null) continue;
    if (l.comparison === '<' ? value < limit : value > limit) return { severity: s, threshold: limit };
  }
  return null;
}

/** What each measurable rule reads from the analysed part: one entry per feature (or one for the whole part). */
type Measure = (part: AnalysedPart) => Measured[] | { reason: string };

export interface AnalysedPart {
  wall: { min: number; nominal: number; max: number } | null;
  features: WorkerFeature[];
  /** The draft of each face along the draw axis (worker 0.14.0, casting.draft): its smallest angle in degrees. Null when the analysis has none. */
  draft: Array<{ face: number; minDeg: number }> | null;
}

const byType = (part: AnalysedPart, ...types: string[]) => part.features.filter((f) => types.includes(f.type));
const perFeature = (features: WorkerFeature[], value: (f: WorkerFeature) => number | null): Measured[] =>
  features.flatMap((f) => {
    const v = value(f);
    return v == null ? [] : [{ value: v, featureIds: [f.id], faces: f.faces }];
  });

const MEASURES: Readonly<Record<string, Measure>> = {
  ThinSection: (p) => (p.wall ? [{ value: p.wall.min, featureIds: [], faces: [] }] : { reason: 'the wall thickness was not measured' }),
  ThickSection: (p) => (p.wall ? [{ value: p.wall.max, featureIds: [], faces: [] }] : { reason: 'the wall thickness was not measured' }),
  InsufficientHoleDiameter: (p) => perFeature(byType(p, 'SimpleHole', 'MultiStepHole'), (f) => f.parameters['diameter_mm'] ?? null),
  HighThroughHoleLengthToDiameterRatio: (p) =>
    perFeature(byType(p, 'SimpleHole').filter((f) => f.parameters['through'] === 1), (f) => f.parameters['l_over_d'] ?? null),
  HighBlindHoleLengthToDiameterRatio: (p) =>
    perFeature(byType(p, 'SimpleHole').filter((f) => f.parameters['through'] === 0), (f) => f.parameters['l_over_d'] ?? null),
  // The smallest draft over each face (0 = parallel to the draw axis, negative = undercut): a rule per face, the face itself highlighted.
  InsufficientDraftAngle: (p) =>
    p.draft
      ? p.draft.map((d) => ({ value: d.minDeg, featureIds: [], faces: [d.face] }))
      : { reason: 'the analysis has no draft angles (the part has no parting line, or the worker is older than 0.14.0)' },
  // A sharp edge is an edge of the solid where two faces meet with no radius: its radius is 0.
  InsufficientExternalRadius: (p) => perFeature(byType(p, 'SharpEdge').filter((f) => f.parameters['convex'] === 1), () => 0),
  InsufficientInternalRadius: (p) => perFeature(byType(p, 'SharpEdge').filter((f) => f.parameters['convex'] === 0), () => 0),
};

/** The worker's part: its wall measurement and features, as the result holds them. */
export function analysedPartOf(result: unknown): AnalysedPart | { reason: string } {
  const parts = (result as { parts?: unknown[] } | null)?.parts;
  if (!Array.isArray(parts) || parts.length !== 1) return { reason: parts?.length ? `the analysis has ${parts.length} distinct parts: the checks are for one part` : 'the analysis has no part' };
  const part = parts[0] as {
    casting?: { wall_mm?: { min?: unknown; nominal?: unknown; max?: unknown } | null; draft?: { faces?: unknown[] } | null } | null;
    features?: unknown[];
  };
  const w = part.casting?.wall_mm;
  const wall = w && num(w.min) != null && num(w.nominal) != null && num(w.max) != null ? { min: w.min as number, nominal: w.nominal as number, max: w.max as number } : null;
  const features = (Array.isArray(part.features) ? part.features : []).flatMap((f): WorkerFeature[] => {
    const x = f as Partial<WorkerFeature>;
    return typeof x.id === 'string' && typeof x.type === 'string' ? [{ id: x.id, type: x.type, faces: Array.isArray(x.faces) ? x.faces : [], parameters: x.parameters ?? {} }] : [];
  });
  const draftFaces = part.casting?.draft?.faces;
  const draft = Array.isArray(draftFaces)
    ? draftFaces.flatMap((d): Array<{ face: number; minDeg: number }> => {
        const x = (d ?? {}) as { face?: unknown; min_deg?: unknown };
        return Number.isInteger(x.face) && num(x.min_deg) != null ? [{ face: x.face as number, minDeg: x.min_deg as number }] : [];
      })
    : null;
  return { wall, features, draft };
}

export interface DfmReference {
  /** lookupTables_Component_manufacturabilitySeverity rows. */
  severity: readonly Row[];
  /** lookupTables_Component_adviceRules rows (Advice Rule Name, Enabled). */
  adviceRules: readonly Row[];
  /** The source version of the rule data (SAND_CASTING_SOURCE_VERSION), stored with each result. */
  version: string;
}

export function evaluateSandDfm(result: unknown, materialType: string | null, ref: DfmReference): DfmResult | { reason: string } {
  const part = analysedPartOf(result);
  if ('reason' in part) return part;
  const enabled = new Set(ref.adviceRules.filter((r) => text(r['Enabled']).toLowerCase() === 'true').map((r) => text(r['Advice Rule Name'])));
  const rules = [...new Set(ref.severity.map((r) => text(r['Rule Name'])).filter(Boolean))].sort();

  const out: DfmResult = { rulesetVersion: ref.version, materialType, findings: [], passed: [], notEvaluated: [] };
  for (const rule of rules) {
    if (!enabled.has(rule)) { out.notEvaluated.push({ rule, reason: 'not enabled in the advice rules' }); continue; }
    const fixed = NOT_MEASURED[rule] ?? (TOLERANCE_RULE.test(rule) ? TOLERANCE_REASON : undefined);
    if (fixed) { out.notEvaluated.push({ rule, reason: fixed }); continue; }
    const measure = MEASURES[rule];
    if (!measure) { out.notEvaluated.push({ rule, reason: 'no check for this rule yet' }); continue; }
    const limits = limitsFor(ref.severity.filter((r) => text(r['Rule Name']) === rule), materialType);
    if (limits == null || 'missing' in limits) { out.notEvaluated.push({ rule, reason: limits == null ? 'the rule has no data' : limits.missing }); continue; }
    const measured = measure(part);
    if ('reason' in measured) { out.notEvaluated.push({ rule, reason: measured.reason }); continue; }
    let violated = false;
    for (const m of measured) {
      const hit = m.value == null ? null : severityOf(m.value, limits);
      if (!hit) continue;
      violated = true;
      out.findings.push({
        rule, title: limits.title, severity: hit.severity, measured: m.value as number, threshold: hit.threshold, comparison: limits.comparison,
        unit: limits.unit, note: limits.note, featureIds: m.featureIds, faces: m.faces,
      });
    }
    if (!violated) out.passed.push(rule);
  }
  out.findings.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.rule.localeCompare(b.rule) || a.featureIds.join().localeCompare(b.featureIds.join()));
  return out;
}
