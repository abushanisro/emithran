// Design-for-machining checks of a part's CAD features against the reference limits: the operation size ranges
// (tblOperationSizeRanges), the machining variables (variables.csv) and the drill size chart (tblDrillSizeChart).
// Every check names the limit and where it is from. A check whose limit is not staged, or whose measurement the
// CAD analysis does not report, is listed as not evaluated with the reason: never shown as passed.
// Pure: no database, no engine.

export type DfmSeverity = 'critical' | 'major' | 'minor';

export interface MachiningDfmReference {
  /** tblOperationSizeRanges rows: OperationName, Comment, LowerBound, UpperBound (-1 = no bound). */
  sizeRanges: ReadonlyArray<Record<string, unknown>> | null;
  /** Machining variables by name (easyL2DRatio, difficultL2DRatio, ...); absent or null = not staged. */
  variables: Readonly<Record<string, number | null | undefined>>;
  /** Standard drill diameters, mm (tblDrillSizeChart); null = not staged. */
  drillSizesMm: readonly number[] | null;
}

export interface MachiningDfmPart {
  /** Bounding dimensions, mm; any missing = the part-shape checks are not evaluated. */
  dimensionsMm: ReadonlyArray<number | null | undefined>;
  weightKg: number | null | undefined;
}

export interface MachiningDfmFinding {
  rule: string;
  severity: DfmSeverity;
  /** What is wrong, with the count and the worst measurement. */
  label: string;
  limit: string;
  source: string;
  recommendation: string;
  featureIds: string[];
  occurrences: Array<{ featureId: string; occurrenceIndex: number }>;
  /** CAD faces of the offending instances, for the viewer highlight. */
  faces: number[];
}

export interface MachiningDfmCheck {
  rule: string;
  name: string;
  limit: string;
  source: string;
  status: 'passed' | 'failed' | 'not_evaluated';
  /** The worst measurement judged, or why the check was not evaluated. */
  detail: string;
}

export interface MachiningDfmResult {
  findings: MachiningDfmFinding[];
  checks: MachiningDfmCheck[];
}

interface Instance { featureId: string; occurrenceIndex: number; faces: number[]; value: number }
interface Feature { id?: string; feature_type?: string; variant?: string; diameter_mm?: number; occurrences?: Array<Record<string, unknown>> }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const fmt = (v: number, digits = 2) => String(Number(v.toFixed(digits)));
const SEVERITY_ORDER: DfmSeverity[] = ['critical', 'major', 'minor'];

/** The bound of an operation's row in tblOperationSizeRanges, or null when the row or the bound is absent (-1). */
function bound(ref: MachiningDfmReference, operation: string, side: 'LowerBound' | 'UpperBound', comment?: string): number | null {
  const row = (ref.sizeRanges ?? []).find((r) => r.OperationName === operation && (!comment || r.Comment === comment));
  const v = Number(row?.[side]);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

export function evaluateMachiningDfm(features: readonly unknown[] | null | undefined, part: MachiningDfmPart, ref: MachiningDfmReference): MachiningDfmResult {
  const all = ((features ?? []) as Feature[]).filter((f) => f.id && f.feature_type);
  const findings: MachiningDfmFinding[] = [];
  const checks: MachiningDfmCheck[] = [];

  /** Every instance of the feature types with the measurement `measure` reads off it; an instance without it is left out. */
  const instances = (types: readonly string[], measure: (f: Feature, o: Record<string, unknown>) => number | null, variant?: string): Instance[] =>
    all.filter((f) => types.includes(f.feature_type!) && (!variant || f.variant === variant)).flatMap((f) => (f.occurrences ?? []).flatMap((o, i) => {
      const value = measure(f, o);
      return value == null ? [] : [{ featureId: f.id!, occurrenceIndex: i, faces: Array.isArray(o.face_ids) ? (o.face_ids as number[]) : [], value }];
    }));

  /**
   * One check: `judged` are the instances it measured, `levels` the limits from most to least severe. The check fails
   * with one finding per severity that has instances; with no limit staged or nothing to measure it is not evaluated.
   */
  const check = (c: {
    rule: string; name: string; unit: string; source: string; what: string; recommendation: string;
    judged: Instance[]; nothing: string; worst: 'highest' | 'lowest';
    levels: Array<{ severity: DfmSeverity; limit: number | null; exceeds: (value: number, limit: number) => boolean; says: string }>;
  }) => {
    const levels = c.levels.filter((l): l is typeof l & { limit: number } => l.limit != null);
    const limit = levels.map((l) => `${l.says} ${fmt(l.limit)}${c.unit} (${l.severity})`).join(', ');
    const base = { rule: c.rule, name: c.name, limit: limit || 'not staged', source: c.source };
    if (levels.length === 0) { checks.push({ ...base, status: 'not_evaluated', detail: `The limit is not staged (${c.source}).` }); return; }
    if (c.judged.length === 0) { checks.push({ ...base, status: 'not_evaluated', detail: c.nothing }); return; }
    const worstOf = (xs: Instance[]) => xs.reduce((a, b) => ((c.worst === 'highest' ? b.value > a.value : b.value < a.value) ? b : a)).value;
    let remaining = c.judged;
    let failed = false;
    for (const level of levels) {
      const hit = remaining.filter((x) => level.exceeds(x.value, level.limit));
      remaining = remaining.filter((x) => !level.exceeds(x.value, level.limit));
      if (hit.length === 0) continue;
      failed = true;
      findings.push({
        rule: c.rule, severity: level.severity,
        label: `${hit.length} of ${c.judged.length} ${c.what}: ${c.worst} ${fmt(worstOf(hit))}${c.unit}`,
        limit: `${level.says} ${fmt(level.limit)}${c.unit}`, source: c.source, recommendation: c.recommendation,
        featureIds: [...new Set(hit.map((x) => x.featureId))],
        occurrences: hit.map((x) => ({ featureId: x.featureId, occurrenceIndex: x.occurrenceIndex })),
        faces: [...new Set(hit.flatMap((x) => x.faces))],
      });
    }
    checks.push({ ...base, status: failed ? 'failed' : 'passed', detail: `${c.worst} ${fmt(worstOf(c.judged))}${c.unit} over ${c.judged.length} measured` });
  };
  const above = (value: number, limit: number) => value > limit;
  const below = (value: number, limit: number) => value < limit;

  // ── Holes ──────────────────────────────────────────────────────────────────
  const holeRatio = (f: Feature, o: Record<string, unknown>) => {
    const d = num(f.diameter_mm);
    const depth = num(o.depth_mm);
    return num(o.ld_ratio) ?? (d && depth ? depth / d : null);
  };
  check({
    rule: 'HoleDepthToDiameter', name: 'Hole depth to diameter', unit: ' : 1', worst: 'highest',
    source: 'tblOperationSizeRanges: Standard Drilling and Gun Drilling, ratio of L/D',
    what: 'holes are deeper than standard drilling reaches', nothing: 'The part has no hole with a measured depth.',
    recommendation: 'Shorten the hole or enlarge its diameter. Past the standard ratio the hole is peck drilled; past the gun drilling ratio it moves to a gun drill.',
    judged: instances(['SimpleHole'], holeRatio),
    levels: [
      { severity: 'major', limit: bound(ref, 'Gun Drilling', 'LowerBound'), exceeds: above, says: 'above' },
      { severity: 'minor', limit: bound(ref, 'Standard Drilling', 'UpperBound'), exceeds: above, says: 'above' },
    ],
  });

  const drills = ref.drillSizesMm;
  const drillMax = bound(ref, 'Drilling', 'UpperBound', 'Straight Drill');
  // The distance from a hole diameter to the nearest standard drill; a hole above the drilling range is bored or milled, not drilled.
  const offStandard = (f: Feature) => {
    const d = num(f.diameter_mm);
    if (!d || !drills?.length || (drillMax != null && d > drillMax)) return null;
    return Math.min(...drills.map((s) => Math.abs(s - d)));
  };
  check({
    rule: 'NonStandardHoleDiameter', name: 'Hole diameter is a standard drill size', unit: ' mm off', worst: 'highest',
    source: 'tblDrillSizeChart',
    what: 'holes are not a standard drill size', nothing: 'The part has no hole in the drilling range.',
    recommendation: 'Use the nearest standard drill diameter, or expect the hole to be bored or milled to size.',
    judged: instances(['SimpleHole'], offStandard),
    levels: [{ severity: 'minor', limit: drills?.length ? 0.01 : null, exceeds: above, says: 'more than' }],
  });

  const tapped = instances(['SimpleHole'], (f) => num(f.diameter_mm), 'threaded');
  check({
    rule: 'ThreadBelowTappingRange', name: 'Tapped hole diameter, smallest', unit: ' mm', worst: 'lowest',
    source: 'tblOperationSizeRanges: Tapping, hole diameter',
    what: 'tapped holes are smaller than the tapping range', nothing: 'The part has no tapped hole.',
    recommendation: 'Use a larger thread, or a thread-forming fastener.',
    judged: tapped, levels: [{ severity: 'major', limit: bound(ref, 'Tapping', 'LowerBound'), exceeds: below, says: 'below' }],
  });
  check({
    rule: 'ThreadAboveTappingRange', name: 'Tapped hole diameter, largest', unit: ' mm', worst: 'highest',
    source: 'tblOperationSizeRanges: Tapping, hole diameter',
    what: 'tapped holes are larger than the tapping range', nothing: 'The part has no tapped hole.',
    recommendation: 'A thread this large is thread milled or turned, not tapped.',
    judged: tapped, levels: [{ severity: 'minor', limit: bound(ref, 'Tapping', 'UpperBound'), exceeds: above, says: 'above' }],
  });

  // ── Pockets, slots and keyways ─────────────────────────────────────────────
  // A pocket's floor is its two largest extents; its depth the removed volume over that floor. A slot or keyway reports its own.
  const size = (o: Record<string, unknown>) => {
    const [lengthMm, widthMm] = (Array.isArray(o.extents_mm) ? (o.extents_mm as unknown[]).map(num) : []).filter((v): v is number => v != null).sort((a, b) => b - a);
    const width = num(o.width_mm) ?? widthMm ?? null;
    const removed = num(o.material_removed_mm3);
    const depth = num(o.depth_mm) ?? (removed && lengthMm && widthMm ? removed / (lengthMm * widthMm) : null);
    return { width, depth };
  };
  const MILLED = ['PocketV2', 'Slot', 'Keyway'];
  const notGroove = (f: Feature) => f.variant !== 'groove';
  check({
    rule: 'ToolReach', name: 'Pocket and slot depth to width (cutter reach)', unit: ' : 1', worst: 'highest',
    source: 'variables: easyL2DRatio, maxMillingLToDRatio, difficultL2DRatio',
    what: 'pockets or slots are deep for their width', nothing: 'The part has no pocket or slot with a measured width and depth.',
    recommendation: 'Widen the feature or make it shallower. The cutter can be no wider than the feature, so its reach over its diameter is at least this ratio; a long thin cutter deflects and is run slowly.',
    judged: instances(MILLED, (f, o) => { const s = size(o); return notGroove(f) && s.width && s.depth ? s.depth / s.width : null; }),
    levels: [
      { severity: 'critical', limit: ref.variables.difficultL2DRatio ?? null, exceeds: above, says: 'above' },
      { severity: 'major', limit: ref.variables.maxMillingLToDRatio ?? null, exceeds: above, says: 'above' },
      { severity: 'minor', limit: ref.variables.easyL2DRatio ?? null, exceeds: above, says: 'above' },
    ],
  });
  check({
    rule: 'NarrowMilledFeature', name: 'Pocket and slot width (smallest cutter)', unit: ' mm', worst: 'lowest',
    source: 'variables: imposedLowerToolDiameterLimitForMilling; tblOperationSizeRanges: Groove Milling, keyseat mill width',
    what: 'pockets or slots are narrower than the smallest standard cutter', nothing: 'The part has no pocket or slot with a measured width.',
    recommendation: 'Widen the feature. A cutter this small is fragile, slow, and a special tool.',
    judged: instances(MILLED, (f, o) => (notGroove(f) ? size(o).width : null)),
    levels: [
      { severity: 'critical', limit: bound(ref, 'Groove Milling', 'LowerBound', 'Keyseat Mill, Width'), exceeds: below, says: 'below' },
      { severity: 'major', limit: ref.variables.imposedLowerToolDiameterLimitForMilling ?? null, exceeds: below, says: 'below' },
    ],
  });

  // ── The part as a whole ────────────────────────────────────────────────────
  const dims = part.dimensionsMm.map(num).filter((v): v is number => v != null).sort((a, b) => b - a);
  const whole = (value: number | null): Instance[] => (value == null ? [] : [{ featureId: 'part', occurrenceIndex: 0, faces: [], value }]);
  const [maxDim, midDim, minDim] = dims.length === 3 ? dims : [null, null, null];
  check({
    rule: 'DelicatePart', name: 'Part middle to smallest dimension', unit: ' : 1', worst: 'highest',
    source: 'variables: delicatePartRatio',
    what: 'part is thin for its size', nothing: 'The part has no three bounding dimensions on file.',
    recommendation: 'A thin part deflects under the cutter and the clamp: add thickness, or expect supported fixturing and lighter cuts.',
    judged: whole(midDim && minDim ? midDim / minDim : null),
    levels: [{ severity: 'minor', limit: ref.variables.delicatePartRatio ?? null, exceeds: above, says: 'above' }],
  });
  check({
    rule: 'HighAspectRatio', name: 'Part longest to middle dimension', unit: ' : 1', worst: 'highest',
    source: 'variables: aspectRatioLimitRatio',
    what: 'part is long for its section', nothing: 'The part has no three bounding dimensions on file.',
    recommendation: 'A long slender part needs extra support (steady rest, multiple vises) and limits the cutter size.',
    judged: whole(maxDim && midDim ? maxDim / midDim : null),
    levels: [{ severity: 'minor', limit: ref.variables.aspectRatioLimitRatio ?? null, exceeds: above, says: 'above' }],
  });
  check({
    rule: 'HeavyPart', name: 'Part weight (manual loading)', unit: ' kg', worst: 'highest',
    source: 'variables: pickWeight',
    what: 'part is too heavy to load by hand', nothing: 'The part has no weight on file.',
    recommendation: 'Above this weight the part is loaded with a lifting device: loading takes longer on every setup.',
    judged: whole(num(part.weightKg)),
    levels: [{ severity: 'minor', limit: ref.variables.pickWeight ?? null, exceeds: above, says: 'above' }],
  });

  // ── What the CAD analysis does not measure yet ─────────────────────────────
  const unmeasured = (rule: string, name: string, detail: string) => checks.push({ rule, name, limit: '—', source: '—', status: 'not_evaluated', detail });
  unmeasured('InternalCornerRadius', 'Pocket internal corner radius', 'The CAD analysis does not report the corner radii of pockets.');
  unmeasured('ThinWall', 'Wall thickness between features', 'The CAD analysis does not measure wall thickness on a machined part.');
  unmeasured('ToolAccess', 'Tool access and number of setups', 'The CAD analysis carries no tool axis per feature.');

  findings.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  // The part-level findings point at no feature.
  for (const f of findings) {
    if (f.featureIds.length === 1 && f.featureIds[0] === 'part') { f.featureIds = []; f.occurrences = []; f.label = `The ${f.label.replace(/^1 of 1 /, '')}`; }
  }
  return { findings, checks };
}
