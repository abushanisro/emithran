// Can a process hold a feature's required tolerance? Pure; every domain uses it.
//
// Data (both staged from memory/, never constants here):
//   tblGtolProcessCapabilities  memory/Machining/lookup (migration 747): per
//     process and GD&T category, Capability System 'IT' (grade) or 'literal'
//     (a value in the category's own unit: um for roughness, mm otherwise),
//     with Best Achievable (finest the process holds).
//   iso286_standard_tolerances  memory/Standards/lookup (migration 880):
//     ISO 286-1 standard tolerance (um) per IT grade and nominal size range.
//
// Requirement values:
//   tolerance, diamTolerance          symmetric +/- value (mm); the tolerance
//                                     band ISO 286 grades is twice it.
//   every geometric tolerance         the tolerance zone width (mm), as on a
//   (flatness, positionTolerance ...) feature control frame.
//   roughness (Ra), roughnessRz       um.
//   bendAngleTolerance                degrees (compared only with literal rows).
// A requirement is held when it is no finer than the process's Best Achievable.

export const GTOL_CATEGORIES = [
  'tolerance', 'diamTolerance', 'positionTolerance', 'roughness', 'roughnessRz', 'bendAngleTolerance',
  'circularity', 'concentricity', 'cylindricity', 'flatness', 'parallelism', 'perpendicularity',
  'profileOfSurface', 'runout', 'totalRunout', 'straightness', 'symmetry', 'angularity',
] as const;
export type GtolCategory = (typeof GTOL_CATEGORIES)[number];

/** Categories entered as a +/- value; the band is twice the value. */
const SYMMETRIC: ReadonlySet<GtolCategory> = new Set(['tolerance', 'diamTolerance']);

export interface IsoToleranceRow { aboveMm: number; upToMm: number; umByGrade: ReadonlyMap<number, number> }

export interface CapabilityRow {
  process: string;
  category: string;
  system: 'IT' | 'literal';
  best: number;
  worst: number;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Staged iso286_standard_tolerances rows to the typed table. */
export function resolveIsoTable(rows: ReadonlyArray<Record<string, unknown>>): IsoToleranceRow[] {
  return rows.map((r) => {
    const umByGrade = new Map<number, number>();
    for (let g = 1; g <= 18; g++) {
      const v = num(r[`IT${g} (um)`]);
      if (v != null) umByGrade.set(g, v);
    }
    return { aboveMm: num(r['Above (mm)']) ?? NaN, upToMm: num(r['Up To And Including (mm)']) ?? NaN, umByGrade };
  }).sort((a, b) => a.aboveMm - b.aboveMm);
}

/** Staged tblGtolProcessCapabilities rows to the typed table (rows with no usable values dropped). */
export function resolveCapabilityTable(rows: ReadonlyArray<Record<string, unknown>>): CapabilityRow[] {
  const out: CapabilityRow[] = [];
  for (const r of rows) {
    const system = String(r['Capability System'] ?? '').trim();
    const best = num(r['Best Achievable']);
    const worst = num(r['Worst Achievable']);
    const category = String(r['GtolCategory'] ?? r['Gtol Category'] ?? '').trim();
    if ((system !== 'IT' && system !== 'literal') || best == null || worst == null || !category) continue;
    out.push({ process: String(r['Process']).trim(), category, system, best, worst });
  }
  return out;
}

/**
 * The loosest IT grade whose standard tolerance at this size fits inside the
 * band (the grade the requirement amounts to). null when the size is outside
 * the table, or the band is finer than IT1.
 */
export function requiredItGrade(bandMm: number, sizeMm: number, iso: readonly IsoToleranceRow[]): number | null {
  const row = iso.find((r) => sizeMm > r.aboveMm && sizeMm <= r.upToMm) ?? (sizeMm === 0 ? iso[0] : undefined);
  if (!row || !(bandMm > 0)) return null;
  let grade: number | null = null;
  for (const [g, um] of [...row.umByGrade].sort((a, b) => a[0] - b[0])) {
    if (um / 1000 <= bandMm + 1e-12) grade = g;
  }
  return grade;
}

export interface Requirement { category: GtolCategory; value: number }

export type HoldResult =
  | { held: true; detail: string }
  | { held: false; detail: string }
  | { held: null; detail: string };

/**
 * Whether `process` holds the requirement on a feature of nominal size sizeMm.
 * held: null when the data cannot decide (no row for the process/category,
 * size outside ISO 286), with the reason.
 */
export function processHolds(
  process: string,
  req: Requirement,
  sizeMm: number | null,
  capability: readonly CapabilityRow[],
  iso: readonly IsoToleranceRow[],
): HoldResult {
  const row = capability.find((c) => c.process === process && c.category === req.category);
  if (!row) return { held: null, detail: `tblGtolProcessCapabilities has no ${process} ${req.category} row` };
  if (row.system === 'literal') {
    return req.value >= row.best
      ? { held: true, detail: `${req.category} ${req.value} ≥ ${process} best ${row.best}` }
      : { held: false, detail: `${req.category} ${req.value} finer than ${process} best ${row.best}` };
  }
  if (sizeMm == null) return { held: null, detail: `${req.category}: no feature size to grade it by ISO 286` };
  const band = SYMMETRIC.has(req.category) ? 2 * req.value : req.value;
  const grade = requiredItGrade(band, sizeMm, iso);
  if (grade == null) return { held: null, detail: `${req.category} ${req.value} mm at ${sizeMm} mm is outside ISO 286-1` };
  return grade >= row.best
    ? { held: true, detail: `${req.category} ${req.value} mm at ${sizeMm} mm = IT${grade}; ${process} holds IT${row.best}` }
    : { held: false, detail: `${req.category} ${req.value} mm at ${sizeMm} mm = IT${grade}; ${process} best is IT${row.best}` };
}
