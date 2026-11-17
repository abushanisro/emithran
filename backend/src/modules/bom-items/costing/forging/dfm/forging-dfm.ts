// Design-for-forging checks of a part's forging analysis (cad-engine forging/feature_extractor.py) against the forging reference data:
// every rule of memory/Forging forging_manufacturabilitySeverity that forging_adviceRules enables, its limits read by the part's material
// type (the material's own rows, else the rows for every material). Each check names its limit and the table row it is from. A check whose
// limit the data does not give, or whose measurement the analysis does not have, is listed as not evaluated with the reason: never passed.
// Pure: no database, no engine.
import type { DfmSeverity, MachiningDfmCheck, MachiningDfmFinding, MachiningDfmResult } from '../../machining/dfm/machining-dfm';

const TABLE = 'forging_manufacturabilitySeverity';
const SOURCE = `memory/Forging ${TABLE}`;
const SEVERITIES: DfmSeverity[] = ['critical', 'major', 'minor'];
const COLUMN: Record<DfmSeverity, string> = { critical: 'Critical', major: 'Major', minor: 'Minor' };

export interface ForgingDfmReference {
  /** forging_manufacturabilitySeverity rows; empty = not staged. */
  severity: ReadonlyArray<Record<string, unknown>>;
  /** The advice rules forging_adviceRules enables; null = the table is not staged (every rule is then evaluated). */
  enabledRules: ReadonlySet<string> | null;
  /** Forging variables the checks read (minForgeableHoleDiameter). */
  variables: Readonly<Record<string, number | null | undefined>>;
}

export interface ForgingDfmHole {
  featureId: string;
  occurrenceIndex: number;
  diameterMm: number;
  depthMm: number | null;
  variant: string;
  angleToDieDeg: number | null;
  faces: number[];
}

export interface ForgingDfmPart {
  /** The forging material's type (Steel, Aluminum, ...); null when the grade is not a forging material. */
  materialType: string | null;
  projectedAreaMm2: number | null;
  /** Per wall face: its draft to the die direction and the share of it covered from its own die half. Null = not measured (an older analysis). */
  draftFaces: ReadonlyArray<{ faceId: number; draftDeg: number | null; undercutFraction: number }> | null;
  /** Per face: the section behind it (largest ball). Null = not measured. */
  thicknessFaces: ReadonlyArray<{ faceId: number; thicknessMm: number }> | null;
  /** The rounded edges: a fillet is an inside corner, a corner an outside one. Null = not measured. */
  radii: ReadonlyArray<{ kind: 'fillet' | 'corner'; radiusMm: number; faceIds: number[] }> | null;
  /** Inside edges with no radius, each by its two faces; outside edges with no radius, counted. Null = not measured. */
  sharpEdges: { internal: ReadonlyArray<{ faceIds: number[]; lengthMm: number }>; externalCount: number } | null;
  undercutAreaMm2: number | null;
  trappedVolumes: number | null;
  holes: readonly ForgingDfmHole[];
  /** Threads the drawing calls for (count). */
  threads: number;
  /** Features whose required tolerance forging does not hold (tblGtolProcessCapabilities "Forging"), with the categories it falls short on; null = not assessed. */
  tolerances: { assessed: true; short: ReadonlyArray<{ featureId: string | null; occurrenceIndex: number; label: string; faces: number[]; categories: string[] }> } | { assessed: false; reason: string };
}

type Row = Readonly<Record<string, unknown>>;
const text = (v: unknown) => (v == null ? '' : String(v).trim());
const num = (v: unknown): number | null => {
  const t = text(v);
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const fmt = (v: number, digits = 2) => String(Number(v.toFixed(digits)));
const rowLabel = (r: Row) => [text(r['Material Type']) || 'every material', text(r['Custom Value']) ? `${text(r['Custom Field'])} ${text(r['Custom Value'])}` : ''].filter(Boolean).join(', ');

/** The rows of a rule for the material: the material's own rows when it has any, else the rows for every material (Material Type empty). */
function rowsFor(ref: ForgingDfmReference, rule: string, materialType: string | null, where: (r: Row) => boolean = () => true): Row[] {
  const all = ref.severity.filter((r) => text(r['Rule Name']) === rule && where(r));
  const own = materialType ? all.filter((r) => text(r['Material Type']).toLowerCase() === materialType.toLowerCase()) : [];
  return own.length ? own : all.filter((r) => !text(r['Material Type']));
}

/** The worst severity a value reaches against a row ('<': below the limit is short; '>': above it), with the limit it crossed. */
function severityOf(row: Row, value: number): { severity: DfmSeverity; limit: number } | null {
  const below = text(row['Rule Type']).startsWith('<');
  for (const s of SEVERITIES) {
    const limit = num(row[COLUMN[s]]);
    if (limit != null && (below ? value < limit : value > limit)) return { severity: s, limit };
  }
  return null;
}

/** The limits of a row as the check line shows them ("below 5 (major), below 0.01 (critical) degrees"). */
function limitsOf(row: Row): string {
  const op = text(row['Rule Type']).startsWith('<') ? 'below' : 'above';
  const parts = SEVERITIES.filter((s) => num(row[COLUMN[s]]) != null).map((s) => `${op} ${num(row[COLUMN[s]])} (${s})`);
  return `${parts.join(', ')}${text(row['Units']) ? ` ${text(row['Units'])}` : ''}`;
}

interface Hit { severity: DfmSeverity; limit: number; value: number; faces: number[]; occurrences: Array<{ featureId: string; occurrenceIndex: number }> }

export function evaluateForgingDfm(part: ForgingDfmPart, ref: ForgingDfmReference): MachiningDfmResult {
  const findings: MachiningDfmFinding[] = [];
  const checks: MachiningDfmCheck[] = [];
  const enabled = (rule: string) => ref.enabledRules == null || ref.enabledRules.has(rule);
  const notEvaluated = (rule: string, name: string, detail: string, limit = '') => checks.push({ rule, name, limit, source: SOURCE, status: 'not_evaluated', detail });
  const staged = ref.severity.length > 0;
  const minForgeable = ref.variables['minForgeableHoleDiameter'] ?? null;
  const along = (h: ForgingDfmHole) => h.angleToDieDeg != null && h.angleToDieDeg <= 1;
  const forgedHole = (h: ForgingDfmHole) => along(h) && minForgeable != null && h.diameterMm >= minForgeable;
  const holeFaces = new Set(part.holes.flatMap((h) => h.faces));

  /** One check over measured values: passed, or a finding per severity reached, worst value first. */
  const judge = (rule: string, name: string, limit: string, source: string, hits: Hit[], measured: number, unit: string, worst: 'lowest' | 'highest', label: (n: number, s: DfmSeverity, h: Hit) => string, recommendation: string) => {
    for (const s of SEVERITIES) {
      const of = hits.filter((h) => h.severity === s);
      if (!of.length) continue;
      const w = of.reduce((a, b) => ((worst === 'lowest' ? b.value < a.value : b.value > a.value) ? b : a));
      findings.push({
        rule, check: name, severity: s, label: label(of.length, s, w), limit, source, recommendation,
        featureIds: [...new Set(of.flatMap((h) => h.occurrences.map((o) => o.featureId)))],
        occurrences: of.flatMap((h) => h.occurrences), faces: [...new Set(of.flatMap((h) => h.faces))],
      });
    }
    const worstHit = hits.length ? hits.reduce((a, b) => ((worst === 'lowest' ? b.value < a.value : b.value > a.value) ? b : a)) : null;
    checks.push({
      rule, name, limit, source, status: hits.length ? 'failed' : 'passed',
      detail: hits.length ? `${hits.length} of ${measured} short, ${worst} ${fmt(worstHit!.value)}${unit}` : `${measured} measured, none short`,
    });
  };

  // ── Section thickness: the least section the material forges, by the part's outline on the parting plane ──────────────────────────
  {
    const rule = 'ThinSection'; const name = 'Section thickness';
    if (!enabled(rule)) { /* disabled by forging_adviceRules */ }
    else if (!staged) notEvaluated(rule, name, `${TABLE} is not staged.`);
    else if (!part.materialType) notEvaluated(rule, name, 'The material grade is not a forging material: its minimum section is kept by material type.');
    else if (part.thicknessFaces == null || part.projectedAreaMm2 == null) notEvaluated(rule, name, 'The section behind each face is not measured on this analysis: use Refresh analysis.');
    else {
      const bands = rowsFor(ref, rule, part.materialType).filter((r) => num(r['Custom Value']) != null).sort((a, b) => num(a['Custom Value'])! - num(b['Custom Value'])!);
      const row = bands.find((r) => part.projectedAreaMm2! <= num(r['Custom Value'])!) ?? bands[bands.length - 1];
      if (!row) notEvaluated(rule, name, `${TABLE} has no ${rule} row for ${part.materialType}.`);
      else {
        const limit = `${limitsOf(row)} for ${part.materialType}, outline up to ${num(row['Custom Value'])} mm² (this part ${fmt(part.projectedAreaMm2, 0)} mm²)`;
        const hits = part.thicknessFaces.flatMap((f) => {
          const s = severityOf(row, f.thicknessMm);
          return s ? [{ ...s, value: f.thicknessMm, faces: [f.faceId], occurrences: [] }] : [];
        });
        judge(rule, name, limit, `${SOURCE} (${rowLabel(row)})`, hits, part.thicknessFaces.length, ' mm', 'lowest',
          (n, s, w) => `${n} face${n === 1 ? '' : 's'} with a section under ${fmt(w.limit)} mm, thinnest ${fmt(w.value)} mm`,
          'Thicken the section, or accept that it is machined from a thicker forging: a thin section chills before it fills the die.');
      }
    }
  }

  // ── Draft: the walls along the die direction, and the walls of the holes the die forms ─────────────────────────────────────────
  const draftCheck = (gcd: 'Surface' | 'Simple Hole', name: string, faceFilter: (faceId: number) => boolean, scope: string) => {
    const rule = 'InsufficientDraftAngle';
    if (!enabled(rule)) return;
    if (!staged) return notEvaluated(rule, name, `${TABLE} is not staged.`);
    if (part.draftFaces == null) return notEvaluated(rule, name, 'The draft of each face is not measured on this analysis: use Refresh analysis.');
    const row = rowsFor(ref, rule, part.materialType, (r) => text(r['Custom Value']) === gcd)[0];
    if (!row) return notEvaluated(rule, name, `${TABLE} has no ${rule} row for ${gcd}.`);
    // A face covered from its own die half is a die lock (Inaccessible feature), not a draft question.
    const walls = part.draftFaces.filter((f) => f.draftDeg != null && f.undercutFraction < 0.5 && faceFilter(f.faceId));
    if (!walls.length) return checks.push({ rule, name, limit: limitsOf(row), source: SOURCE, status: 'passed', detail: `no ${scope} to judge` });
    const hits = walls.flatMap((f) => {
      const s = severityOf(row, f.draftDeg!);
      return s ? [{ ...s, value: f.draftDeg!, faces: [f.faceId], occurrences: [] }] : [];
    });
    judge(rule, name, `${limitsOf(row)}${part.materialType && text(row['Material Type']) ? ` for ${part.materialType}` : ''}`, `${SOURCE} (${rowLabel(row)}, ${gcd})`, hits, walls.length, '°', 'lowest',
      (n, s, w) => `${n} ${scope}${n === 1 ? '' : 's'} with ${s === 'critical' ? 'no draft' : `under ${fmt(w.limit)}° draft`}, least ${fmt(w.value)}°`,
      'Add draft to the walls along the die direction so the forging releases from the die; a wall that must stay straight is machined after forging.');
  };
  draftCheck('Surface', 'Draft on walls', (id) => !holeFaces.has(id), 'wall');
  const forgedHoleFaces = new Set(part.holes.filter(forgedHole).flatMap((h) => h.faces));
  draftCheck('Simple Hole', 'Draft in forged holes', (id) => forgedHoleFaces.has(id), 'forged hole wall');

  // ── Fillet and corner radii ───────────────────────────────────────────────────────────────────────────────────────────────────
  const radiusCheck = (rule: 'InsufficientFilletRadius' | 'InsufficientCornerRadius', kind: 'fillet' | 'corner', name: string) => {
    if (!enabled(rule)) return;
    if (!staged) return notEvaluated(rule, name, `${TABLE} is not staged.`);
    if (part.radii == null || part.sharpEdges == null) return notEvaluated(rule, name, 'The radii and sharp edges are not measured on this analysis: use Refresh analysis.');
    const row = rowsFor(ref, rule, part.materialType)[0];
    if (!row) return notEvaluated(rule, name, `${TABLE} has no ${rule} row.`);
    const rounds: Hit[] = part.radii.filter((r) => r.kind === kind).flatMap((r) => {
      const s = severityOf(row, r.radiusMm);
      return s ? [{ ...s, value: r.radiusMm, faces: r.faceIds, occurrences: [] }] : [];
    });
    // An edge with no radius at all: an inside one is a sharp fillet (its two faces shown), an outside one a sharp corner (counted).
    const sharpInside: Hit[] = kind === 'fillet'
      ? part.sharpEdges.internal.flatMap((e) => { const s = severityOf(row, 0); return s ? [{ ...s, value: 0, faces: e.faceIds, occurrences: [] }] : []; })
      : [];
    const sharpOutside = kind === 'corner' ? part.sharpEdges.externalCount : 0;
    const measured = part.radii.filter((r) => r.kind === kind).length + (kind === 'fillet' ? part.sharpEdges.internal.length : sharpOutside);
    const hits = [...rounds, ...sharpInside];
    const limit = `${limitsOf(row)}${part.materialType && text(row['Material Type']) ? ` for ${part.materialType}` : ''}`;
    const word = kind === 'fillet' ? 'inside' : 'outside';
    judge(rule, name, limit, `${SOURCE} (${rowLabel(row)})`, hits, measured, ' mm', 'lowest',
      (n, s, w) => `${n} ${word} edge${n === 1 ? '' : 's'} ${w.value === 0 ? 'with no radius' : `under ${fmt(w.limit)} mm`}${w.value === 0 ? '' : `, least ${fmt(w.value)} mm`}`,
      kind === 'fillet'
        ? 'Round the inside edges: metal flowing round a small fillet folds over (a lap) and the die cracks at it.'
        : 'Round the outside edges: a small corner radius is hard to fill and wears the die.');
    if (sharpOutside > 0) {
      const s = severityOf(row, 0);
      if (s) {
        findings.push({
          rule, severity: s.severity, label: `${sharpOutside} outside edge${sharpOutside === 1 ? '' : 's'} with no radius`, limit, source: `${SOURCE} (${rowLabel(row)})`,
          recommendation: 'Round the outside edges, or machine them after forging.', featureIds: [], occurrences: [], faces: [],
        });
        const c = checks[checks.length - 1]!;
        checks[checks.length - 1] = { ...c, status: 'failed', detail: `${hits.length + sharpOutside} of ${measured} short, ${sharpOutside} with no radius` };
      }
    }
  };
  radiusCheck('InsufficientFilletRadius', 'fillet', 'Fillet radius (inside edges)');
  radiusCheck('InsufficientCornerRadius', 'corner', 'Corner radius (outside edges)');

  // ── Forged blind holes: how deep the die can push a punch ─────────────────────────────────────────────────────────────────────
  {
    const rule = 'HighBlindHoleLengthToDiameterRatio'; const name = 'Forged blind hole depth to diameter';
    const row = rowsFor(ref, rule, part.materialType)[0];
    if (!enabled(rule)) { /* disabled */ }
    else if (!row) notEvaluated(rule, name, `${TABLE} has no ${rule} row.`);
    else if (minForgeable == null) notEvaluated(rule, name, 'forging variable minForgeableHoleDiameter is not staged.');
    else {
      const blind = part.holes.filter((h) => forgedHole(h) && h.variant === 'blind' && h.depthMm != null);
      if (!blind.length) checks.push({ rule, name, limit: limitsOf(row), source: SOURCE, status: 'passed', detail: `no blind hole is forged (at least ${minForgeable} mm across, along the die direction); smaller holes are drilled` });
      else {
        const hits = blind.flatMap((h) => {
          const ratio = h.depthMm! / h.diameterMm;
          const s = severityOf(row, ratio);
          return s ? [{ ...s, value: ratio, faces: h.faces, occurrences: [{ featureId: h.featureId, occurrenceIndex: h.occurrenceIndex }] }] : [];
        });
        judge(rule, name, `${limitsOf(row)} depth : diameter`, SOURCE, hits, blind.length, ' : 1', 'highest',
          (n, s, w) => `${n} forged blind hole${n === 1 ? '' : 's'} deeper than ${fmt(w.limit)} diameters, deepest ${fmt(w.value)} : 1`,
          'Make the forged hole shallower and drill the rest, or drill it entirely.');
      }
    }
  }

  // ── Rules the data names without a limit ──────────────────────────────────────────────────────────────────────────────────────
  if (enabled('ThickSlug')) notEvaluated('ThickSlug', 'Pierced slug thickness', 'The forging data flags a slug above a recommended maximum but does not give the maximum (minSlugThickness is deprecated).');
  if (enabled('ThickWalledHole')) notEvaluated('ThickWalledHole', 'Thick walled hole', 'The forging data flags a hole wall above a recommended maximum but does not give the maximum.');

  // ── Die lock: anything a two-half die cannot release ──────────────────────────────────────────────────────────────────────────
  {
    const rule = 'InaccessibleFeature'; const name = 'Die lock (undercuts and trapped volumes)';
    const row = rowsFor(ref, rule, part.materialType)[0];
    if (!enabled(rule)) { /* disabled */ }
    else if (part.draftFaces == null || part.undercutAreaMm2 == null) notEvaluated(rule, name, 'The undercuts are not measured on this analysis: use Refresh analysis.');
    else {
      const severity = (row && SEVERITIES.find((s) => text(row[COLUMN[s]]).toUpperCase() === 'TRUE')) ?? 'critical';
      const faces = part.draftFaces.filter((f) => f.undercutFraction >= 0.5).map((f) => f.faceId);
      const trapped = part.trappedVolumes ?? 0;
      const locked = part.undercutAreaMm2 > 1 || trapped > 0;
      checks.push({ rule, name, limit: 'none', source: SOURCE, status: locked ? 'failed' : 'passed',
        detail: locked ? `${fmt(part.undercutAreaMm2, 0)} mm² covered from its own die half${trapped ? `, ${trapped} trapped volume${trapped === 1 ? '' : 's'}` : ''}` : 'every face releases along the die direction' });
      if (locked) findings.push({
        rule, severity, label: `${faces.length} face${faces.length === 1 ? '' : 's'} a two-half die cannot release${trapped ? `, ${trapped} trapped volume${trapped === 1 ? '' : 's'}` : ''}`,
        limit: 'none', source: SOURCE, recommendation: 'Change the design so every face releases along the die direction, or forge the region solid and machine it.',
        featureIds: [], occurrences: [], faces,
      });
    }
  }

  // ── Threads ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  if (enabled('Threaded')) {
    const row = rowsFor(ref, 'Threaded', part.materialType)[0];
    const severity = (row && SEVERITIES.find((s) => text(row[COLUMN[s]]).toUpperCase() === 'TRUE')) ?? 'critical';
    checks.push({ rule: 'Threaded', name: 'Threads', limit: 'none', source: SOURCE, status: part.threads > 0 ? 'failed' : 'passed',
      detail: part.threads > 0 ? `${part.threads} thread${part.threads === 1 ? '' : 's'} on the drawing` : 'no thread on the drawing' });
    if (part.threads > 0) findings.push({ rule: 'Threaded', severity, label: `${part.threads} thread${part.threads === 1 ? '' : 's'}: a thread cannot be forged`, limit: 'none', source: SOURCE,
      recommendation: 'Threads are cut or rolled after forging: they are costed with the machining.', featureIds: [], occurrences: [], faces: [] });
  }

  // ── Tolerances tighter than forging holds ────────────────────────────────────────────────────────────────────────────────────
  {
    const name = 'Tolerances forging holds';
    const rules = ref.severity.map((r) => text(r['Rule Name'])).filter((r) => r.startsWith('TightTolerance') && enabled(r));
    if (!rules.length) { /* none enabled or staged */ }
    else if (!part.tolerances.assessed) notEvaluated('TightTolerance', name, part.tolerances.reason);
    else {
      const byCategory = new Map<string, typeof part.tolerances.short[number][]>();
      for (const f of part.tolerances.short) for (const c of f.categories) byCategory.set(c, [...(byCategory.get(c) ?? []), f]);
      checks.push({ rule: 'TightTolerance', name, limit: 'tblGtolProcessCapabilities, process Forging', source: SOURCE,
        status: byCategory.size ? 'failed' : 'passed',
        detail: byCategory.size ? `${part.tolerances.short.length} feature${part.tolerances.short.length === 1 ? '' : 's'} toleranced tighter than forging holds` : 'no tolerance tighter than forging holds (tolerances from the GD&T tab)' });
      for (const [category, features] of byCategory) {
        const rule = rules.find((r) => r.toLowerCase() === `TightTolerance${category}`.toLowerCase()) ?? `TightTolerance${category}`;
        const row = ref.severity.find((r) => text(r['Rule Name']) === rule);
        const severity = (row && SEVERITIES.find((s) => text(row[COLUMN[s]]).toUpperCase() === 'TRUE')) ?? 'major';
        findings.push({
          rule, severity, label: `${features.length} feature${features.length === 1 ? '' : 's'} with a ${category} tighter than forging holds: ${features.map((f) => f.label).join(', ')}`,
          limit: 'tblGtolProcessCapabilities, process Forging', source: SOURCE, recommendation: 'Machined after forging (costed); widen the tolerance where the function allows.',
          featureIds: [...new Set(features.flatMap((f) => (f.featureId ? [f.featureId] : [])))],
          occurrences: features.flatMap((f) => (f.featureId ? [{ featureId: f.featureId, occurrenceIndex: f.occurrenceIndex }] : [])),
          faces: [...new Set(features.flatMap((f) => f.faces))],
        });
      }
    }
  }

  findings.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
  return { findings, checks };
}
