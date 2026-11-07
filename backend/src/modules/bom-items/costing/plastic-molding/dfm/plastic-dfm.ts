// Design-for-molding checks of a plastic part: the CAD analysis's measurements against the published rule data (manufacturabilitySeverity: a threshold per severity,
// per process and material; adviceRules: which rules are on; variables smallHoleDiamBorder: what a small hole is). Pure, and the pattern of sand-dfm.ts.
//
// Nothing here is typed in from a guideline: every threshold is a row of the staged data, every number in a finding is a measurement of the part or a threshold of the
// data, and the explanation is the data's own note. A rule the analysis cannot measure yet is listed as not evaluated with the reason, never reported as passed.

type Row = Readonly<Record<string, unknown>>;

export type DfmSeverity = 'Critical' | 'Major' | 'Minor';
const SEVERITIES: readonly DfmSeverity[] = ['Critical', 'Major', 'Minor'];

export type MoldingProcessName = 'Injection Molding' | 'Compression Molding' | 'Reaction Injection Molding' | 'Structural Foam Molding';

export interface PlasticDfmFinding {
  rule: string;
  title: string;
  severity: DfmSeverity;
  /** What was measured (the worst of the faces or features of the finding), and the limit it crossed. */
  measured: number;
  threshold: number;
  comparison: '<' | '>';
  unit: string | null;
  /** The rule data's own note: why the rule exists. */
  note: string | null;
  /** How many faces or features the finding covers, and which: the faces are what the viewer highlights. */
  count: number;
  featureIds: string[];
  faces: number[];
  /** The text to write on the model next to the faces. */
  label: string;
}

export interface PlasticDfmResult {
  rulesetVersion: string;
  process: MoldingProcessName;
  materialType: string | null;
  findings: PlasticDfmFinding[];
  /** Rules the data enables that were measured and not violated. */
  passed: string[];
  /** Rules that could not be judged, with why. */
  notEvaluated: Array<{ rule: string; reason: string }>;
}

export interface PlasticDfmReference {
  severity: readonly Row[];
  adviceRules: readonly Row[];
  /** variables smallHoleDiamBorder (mm): a hole this small or smaller is a small hole. Null when the variable is not staged. */
  smallHoleDiamBorderMm: number | null;
  version: string;
}

export interface DraftFace { face: number; deg: number; basis: string; cls: string }
/** The wall at a face: the diameter of the largest ball inside the material that touches it (mm). */
export interface WallFace { face: number; mm: number }
export interface MeasuredHole { id: string; through: boolean; diameterMm: number; depthMm: number; faces: number[] }

/** What the analysis of the part holds. A null is a measurement the analysis did not make (an older CAD engine), which makes its rules not evaluated. */
export interface PlasticDfmPart {
  draftFaces: DraftFace[] | null;
  holes: MeasuredHole[] | null;
  wallFaces: WallFace[] | null;
}

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const text = (v: unknown): string => (v == null ? '' : String(v).replace(/^﻿/, '').trim());

interface Limits { comparison: '<' | '>'; limits: Partial<Record<DfmSeverity, number>>; unit: string | null; title: string; note: string | null }

/**
 * The limits of a rule for this process and material. A row applies when every one of its qualifiers (process, material, custom field) matches or is blank; of the rows
 * that apply the most specific wins (a material row over a process row over a general one), so a material that has its own limits is never judged by the general ones.
 */
function limitsFor(rows: readonly Row[], process: string, materialType: string | null, custom?: { field: string; value: string }): Limits | { missing: string } | null {
  if (rows.length === 0) return null;
  const applies = rows.filter((r) => {
    const p = text(r['Process Name']);
    const m = text(r['Material Type']);
    const cf = text(r['Custom Field']);
    const cv = text(r['Custom Value']);
    if (p !== '' && p !== process) return false;
    if (m !== '' && m !== materialType) return false;
    if (cf !== '' && (!custom || custom.field !== cf || custom.value !== cv)) return false;
    return true;
  });
  if (applies.length === 0) return { missing: `the rule has no row for ${process}${materialType ? ` and ${materialType}` : ''}` };
  const score = (r: Row) => (text(r['Material Type']) !== '' ? 4 : 0) + (text(r['Process Name']) !== '' ? 2 : 0) + (text(r['Custom Field']) !== '' ? 1 : 0);
  const r = [...applies].sort((a, b) => score(b) - score(a))[0]!;
  const type = text(r['Rule Type']);
  if (type !== '<' && type !== '>') return { missing: `the rule is a ${type || 'yes/no'} rule, which has no measured value to compare` };
  const limits: Partial<Record<DfmSeverity, number>> = {};
  for (const s of SEVERITIES) {
    const v = num(r[s]);
    if (v != null) limits[s] = v;
  }
  return { comparison: type, limits, unit: text(r['Units']) || null, title: text(r['Threshold Name']), note: text(r['Notes']) || null };
}

/** The most severe level whose limit the value crosses. */
function severityOf(value: number, l: Limits): { severity: DfmSeverity; threshold: number } | null {
  for (const s of SEVERITIES) {
    const limit = l.limits[s];
    if (limit == null) continue;
    if (l.comparison === '<' ? value < limit : value > limit) return { severity: s, threshold: limit };
  }
  return null;
}

/** Rules whose measurement the analysis does not make yet, and why. They stay in the list so a gap is visible and is never a silent pass. */
const NOT_MEASURED: Readonly<Record<string, string>> = {
  ThinWallAroundHole: 'needs the wall between a hole and its neighbours, which is not measured',
  SharpInternalEdge: 'the radius of the edges is not measured (the analysis lists SharpEdge as not assessed)',
  SharpExternalEdge: 'the radius of the edges is not measured (the analysis lists SharpEdge as not assessed)',
  HighFlowRatio: 'needs the flow path from the gate, and no gate is modelled',
  ExternalUndercut: 'needs the analysis of whether a void can be trimmed from the draw direction, which is not made',
  InternalUndercut: 'needs the analysis of whether a void can be reached from the draw direction, which is not made',
  FlexibleUndercut: 'needs the analysis of whether the part can flex out of the tool, which is not made',
  NonRegrindableMaterial: 'the scenario does not specify a regrind share',
  InsufficientRegrindAvailable: 'the scenario does not specify a regrind share',
};

interface Measured { value: number; featureId: string | null; faces: number[]; what: string }
type Measure = (p: PlasticDfmPart, ref: PlasticDfmReference, process: string) => Measured[] | { reason: string };

const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(Math.abs(n) < 1 ? 2 : 1));

/** The hole rules each look at holes of one size class and one kind (through or blind). */
const holeMeasure = (through: boolean, size: 'Small' | 'Large'): Measure => (p, ref) => {
  if (!p.holes) return { reason: 'the analysis has no recognised holes' };
  if (ref.smallHoleDiamBorderMm == null) return { reason: 'the variable smallHoleDiamBorder (what a small hole is) is not staged' };
  return p.holes
    .filter((h) => h.through === through && h.diameterMm > 0 && (h.diameterMm <= ref.smallHoleDiamBorderMm! ? 'Small' : 'Large') === size)
    .map((h) => ({ value: h.depthMm / h.diameterMm, featureId: h.id, faces: h.faces, what: `Ø${fmt(h.diameterMm)} × ${fmt(h.depthMm)} mm` }));
};

/** A rule can have a row for each hole size class: the measure is per class, and the rule is judged once for each. */
const SIZE_CLASSES: ReadonlyArray<'Small' | 'Large'> = ['Small', 'Large'];

/** The wall at each face, as the thin and thick section rules read it: the same measurement, graded against a minimum and a maximum. */
const wallMeasure: Measure = (p) =>
  p.wallFaces
    ? p.wallFaces.map((w) => ({ value: w.mm, featureId: null, faces: [w.face], what: `face ${w.face}` }))
    : { reason: 'the analysis has no wall thickness per face (a CAD engine older than the per-face wall measurement)' };

const MEASURES: Readonly<Record<string, Measure>> = {
  ThinSection: wallMeasure,
  ThickSection: wallMeasure,
  // A wall face is judged by the draft it has (the least for a planar face, the average for a curved one: draft.py states why). A face covered from the side it faces
  // is an undercut, which is not a draft shortfall and has its own rules.
  InsufficientDraftAngle: (p) =>
    p.draftFaces
      ? p.draftFaces.filter((f) => f.cls !== 'undercut').map((f) => ({ value: f.deg, featureId: null, faces: [f.face], what: `face ${f.face}` }))
      : { reason: 'the analysis has no draft per face (a CAD engine older than the per-face draft record)' },
};

export function evaluatePlasticDfm(part: PlasticDfmPart, process: MoldingProcessName, materialType: string | null, ref: PlasticDfmReference): PlasticDfmResult {
  // The staged adviceRules rows (machining_reference_data, migration 651) carry advice_rule_name and enabled. A rule is off when that table lists it as disabled. The table
  // does not list every rule the severity table grades (InsufficientDraftAngle and ThinSection are not in it, and all 24 it does list are enabled), so a rule it does not
  // mention is on: reading "not listed" as "off" would switch off the draft rule on a table that never mentions it.
  const disabled = new Set(ref.adviceRules.filter((r) => text(r['enabled']).toLowerCase() === 'false').map((r) => text(r['advice_rule_name'])));
  const rules = [...new Set(ref.severity.map((r) => text(r['Rule Name'])).filter(Boolean))].sort();
  const out: PlasticDfmResult = { rulesetVersion: ref.version, process, materialType, findings: [], passed: [], notEvaluated: [] };

  const judge = (rule: string, rows: readonly Row[], measured: Measured[], custom?: { field: string; value: string }): { violated: boolean } | { reason: string } => {
    const limits = limitsFor(rows, process, materialType, custom);
    if (limits == null) return { reason: 'the rule has no data' };
    if ('missing' in limits) return { reason: limits.missing };
    // One finding per severity for a rule that grades many faces (a face-by-face draft would be hundreds of cards); one per feature for a rule that grades features.
    const byFeature = measured.some((m) => m.featureId != null);
    const groups = new Map<string, { severity: DfmSeverity; threshold: number; items: Measured[] }>();
    for (const m of measured) {
      const hit = severityOf(m.value, limits);
      if (!hit) continue;
      const key = byFeature ? `${m.featureId}` : hit.severity;
      const g = groups.get(key) ?? { severity: hit.severity, threshold: hit.threshold, items: [] };
      g.items.push(m);
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      const worst = g.items.reduce((a, b) => ((limits.comparison === '<' ? b.value < a.value : b.value > a.value) ? b : a));
      const unit = limits.unit ? ` ${limits.unit}` : '';
      out.findings.push({
        rule, title: limits.title, severity: g.severity, measured: worst.value, threshold: g.threshold, comparison: limits.comparison, unit: limits.unit, note: limits.note,
        count: g.items.length, featureIds: g.items.flatMap((i) => (i.featureId ? [i.featureId] : [])), faces: [...new Set(g.items.flatMap((i) => i.faces))],
        label: g.items.length === 1
          ? `${limits.title}: ${fmt(worst.value)}${unit} (${limits.comparison === '<' ? 'below' : 'above'} ${g.severity.toLowerCase()} limit ${fmt(g.threshold)})`
          : `${limits.title}: ${g.items.length} faces, worst ${fmt(worst.value)}${unit} (${limits.comparison === '<' ? 'below' : 'above'} ${g.severity.toLowerCase()} limit ${fmt(g.threshold)})`,
      });
    }
    return { violated: groups.size > 0 };
  };

  for (const rule of rules) {
    const rows = ref.severity.filter((r) => text(r['Rule Name']) === rule);
    if (disabled.has(rule)) { out.notEvaluated.push({ rule, reason: 'not enabled in the advice rules' }); continue; }
    if (NOT_MEASURED[rule]) { out.notEvaluated.push({ rule, reason: NOT_MEASURED[rule]! }); continue; }

    if (rule === 'HighHoleLengthToDiameterRatio' || rule === 'HighBlindHoleLengthToDiameterRatio') {
      // The data names the hole size class in its Custom Field (Hole Size: Small | Large); through-hole and blind-hole ratios are separate rules.
      const through = rule === 'HighHoleLengthToDiameterRatio';
      let violated = false;
      let reason: string | null = null;
      for (const size of SIZE_CLASSES) {
        const measured = holeMeasure(through, size)(part, ref, process);
        if ('reason' in measured) { reason = measured.reason; break; }
        const r = judge(rule, rows, measured, { field: 'Hole Size', value: size });
        if ('reason' in r) { reason = r.reason; break; }
        violated ||= r.violated;
      }
      if (reason) out.notEvaluated.push({ rule, reason });
      else if (!violated) out.passed.push(rule);
      continue;
    }

    const measure = MEASURES[rule];
    if (!measure) { out.notEvaluated.push({ rule, reason: 'no check for this rule yet' }); continue; }
    const measured = measure(part, ref, process);
    if ('reason' in measured) { out.notEvaluated.push({ rule, reason: measured.reason }); continue; }
    const r = judge(rule, rows, measured);
    if ('reason' in r) { out.notEvaluated.push({ rule, reason: r.reason }); continue; }
    if (!r.violated) out.passed.push(rule);
  }
  out.findings.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.rule.localeCompare(b.rule) || a.featureIds.join().localeCompare(b.featureIds.join()));
  return out;
}

/** The holes of a recognised plastic feature graph, as the hole rules read them (depth over diameter is the rule's measure, so a hole without a depth is left out). */
export function holesOfPlasticGraph(graph: { items?: Array<{ id: string; feature_type: string; variant?: string; depth_mm?: number; diameter_mm?: number; occurrences?: Array<{ face_ids?: number[] }> }> } | null | undefined): MeasuredHole[] | null {
  if (!graph || !Array.isArray(graph.items)) return null;
  return graph.items.flatMap((f): MeasuredHole[] => {
    if (f.feature_type !== 'SimpleHole' && f.feature_type !== 'MultiStepHole') return [];
    const d = num(f.diameter_mm);
    const depth = num(f.depth_mm);
    if (d == null || depth == null || d <= 0) return [];
    return [{ id: f.id, through: f.variant === 'through', diameterMm: d, depthMm: depth, faces: (f.occurrences ?? []).flatMap((o) => o.face_ids ?? []) }];
  });
}
