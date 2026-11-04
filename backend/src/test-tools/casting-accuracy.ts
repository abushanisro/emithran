// The accuracy gate of the sand casting analysis (design step S3): the worker's measurements of a part compared with an engineer's labels of the same
// part, under tolerances the manifest itself states. Pure: the caller reads the manifest and the worker's result.json files.
//
// Nothing is defaulted. A tolerance, the pass rate and the minimum corpus size must be written in the manifest (they are an agreement between
// the people who judge the analysis, not a constant of the code), and a part the worker could not measure counts as a miss, never as a skip. A synthetic
// corpus can only ever say "development check"; only a corpus declared "real" can pass the gate.

export type DrawAxis = "x" | "y" | "z";

export interface Labels {
  /** The part's net weight, kg, from the drawing or a weighed casting. */
  weightKg?: number;
  /** How many sand cores the pattern shop makes for it. */
  coreCount?: number;
  /** The thinnest wall of the casting, mm, from the drawing. */
  minWallMm?: number;
  /** The axis the engineer would open the mould along. */
  drawAxis?: DrawAxis;
}

export interface ManifestPart {
  id: string;
  /** The part's STEP file, relative to the manifest. */
  file: string;
  /** The casting material's density, kg/m3, for the weight. Required when weightKg is labelled. */
  densityKgM3?: number;
  labels: Labels;
}

export interface Tolerances {
  /** A weight may differ from the label by this many percent. */
  weightPct?: number;
  /** A minimum wall may differ from the label by this many mm. */
  minWallMm?: number;
}

export interface AccuracyManifest {
  /** "real": parts from production, judged by an engineer; "synthetic": hand-worked parts of the checks (can never pass the gate). */
  corpus: "real" | "synthetic";
  /** The share of the labelled parts of a metric that must be within tolerance, in (0, 1]. */
  requiredPassRate: number;
  /** The fewest parts the corpus must have for the gate to mean anything. */
  minParts: number;
  tolerances: Tolerances;
  parts: ManifestPart[];
}

export const METRICS = ["weight", "coreCount", "minWall", "drawAxis"] as const;
export type MetricName = (typeof METRICS)[number];

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Everything wrong with a manifest, or the manifest. */
export function validateManifest(
  raw: unknown,
): { manifest: AccuracyManifest } | { errors: string[] } {
  const errors: string[] = [];
  const m = raw as Partial<AccuracyManifest> | null;
  if (!m || typeof m !== "object") return { errors: ["the manifest is not an object"] };
  if (m.corpus !== "real" && m.corpus !== "synthetic")
    errors.push('corpus must be "real" or "synthetic"');
  if (!isNum(m.requiredPassRate) || m.requiredPassRate <= 0 || m.requiredPassRate > 1)
    errors.push("requiredPassRate must be a number above 0 and at most 1");
  if (!isNum(m.minParts) || !Number.isInteger(m.minParts) || m.minParts < 1)
    errors.push("minParts must be a whole number of at least 1");
  const tol = m.tolerances ?? {};
  if (!Array.isArray(m.parts) || m.parts.length === 0) {
    errors.push("parts must be a list of at least one part");
    return { errors };
  }
  const ids = new Set<string>();
  let weighted = false;
  let walled = false;
  for (const [i, p] of m.parts.entries()) {
    const at = `parts[${i}]${typeof p?.id === "string" ? ` (${p.id})` : ""}`;
    if (typeof p?.id !== "string" || p.id === "") errors.push(`${at}: id is required`);
    else if (ids.has(p.id)) errors.push(`${at}: id is used twice`);
    else ids.add(p.id);
    if (typeof p?.file !== "string" || p.file === "")
      errors.push(`${at}: file is required`);
    const l = p?.labels;
    if (!l || typeof l !== "object" || Object.keys(l).length === 0) {
      errors.push(
        `${at}: labels must name at least one of weightKg, coreCount, minWallMm, drawAxis`,
      );
      continue;
    }
    if (l.weightKg !== undefined) {
      weighted = true;
      if (!isNum(l.weightKg) || l.weightKg <= 0)
        errors.push(`${at}: weightKg must be a positive number`);
      if (!isNum(p.densityKgM3) || p.densityKgM3 <= 0)
        errors.push(`${at}: densityKgM3 is required with weightKg`);
    }
    if (
      l.coreCount !== undefined &&
      (!isNum(l.coreCount) || !Number.isInteger(l.coreCount) || l.coreCount < 0)
    )
      errors.push(`${at}: coreCount must be a whole number, 0 or more`);
    if (l.minWallMm !== undefined) {
      walled = true;
      if (!isNum(l.minWallMm) || l.minWallMm <= 0)
        errors.push(`${at}: minWallMm must be a positive number`);
    }
    if (l.drawAxis !== undefined && !["x", "y", "z"].includes(l.drawAxis))
      errors.push(`${at}: drawAxis must be x, y or z`);
    for (const k of Object.keys(l))
      if (!["weightKg", "coreCount", "minWallMm", "drawAxis"].includes(k))
        errors.push(`${at}: unknown label ${k}`);
  }
  if (weighted && !(isNum(tol.weightPct) && tol.weightPct > 0))
    errors.push(
      "tolerances.weightPct is required (a percentage above 0) because parts are labelled with a weight",
    );
  if (walled && !(isNum(tol.minWallMm) && tol.minWallMm > 0))
    errors.push(
      "tolerances.minWallMm is required (mm above 0) because parts are labelled with a minimum wall",
    );
  return errors.length ? { errors } : { manifest: m as AccuracyManifest };
}

export interface MetricResult {
  metric: MetricName;
  expected: number | string;
  /** null: the worker did not measure it. */
  actual: number | string | null;
  /** The difference in the metric's own unit (percent for a weight, mm for a wall, a count, or "match" for an axis); null when not measured. */
  error: number | null;
  tolerance: number | null;
  ok: boolean;
  note?: string;
}

export interface PartReport {
  id: string;
  /** The worker's own words when it could not analyse the part at all. */
  problem: string | null;
  metrics: MetricResult[];
}

interface Casting {
  draw_axis?: unknown;
  wall_mm?: { min?: unknown } | null;
  cores?: unknown[];
}

/**
 * One part's measurements against its labels. `result` is the worker's result.json for the part's file (null: the worker produced none).
 * A label whose measurement is missing is a miss with the reason, never skipped.
 */
export function comparePart(
  part: ManifestPart,
  result: unknown,
  tolerances: Tolerances,
): PartReport {
  const parts = (
    result as { parts?: Array<{ volume_mm3?: unknown; casting?: Casting | null }> } | null
  )?.parts;
  const measured = Array.isArray(parts) && parts.length === 1 ? parts[0] : undefined;
  const problem = !result
    ? "the worker produced no result"
    : !Array.isArray(parts) || parts.length === 0
      ? "the analysis holds no part"
      : parts.length > 1
        ? `the analysis holds ${parts.length} distinct parts (a casting is one part)`
        : null;
  const metrics: MetricResult[] = [];
  const l = part.labels;
  const casting = measured?.casting ?? null;
  const miss = (
    metric: MetricName,
    expected: number | string,
    tolerance: number | null,
    note: string,
  ): MetricResult => ({
    metric,
    expected,
    actual: null,
    error: null,
    tolerance,
    ok: false,
    note,
  });

  if (l.weightKg !== undefined) {
    const volume = measured?.volume_mm3;
    if (!isNum(volume))
      metrics.push(
        miss(
          "weight",
          l.weightKg,
          tolerances.weightPct ?? null,
          "the part has no volume (not a valid solid)",
        ),
      );
    else {
      const actual = volume * 1e-9 * (part.densityKgM3 as number);
      const error = (Math.abs(actual - l.weightKg) / l.weightKg) * 100;
      metrics.push({
        metric: "weight",
        expected: l.weightKg,
        actual,
        error,
        tolerance: tolerances.weightPct ?? null,
        ok: error <= (tolerances.weightPct as number),
      });
    }
  }
  if (l.coreCount !== undefined) {
    if (!casting || !Array.isArray(casting.cores))
      metrics.push(miss("coreCount", l.coreCount, 0, "no casting measurement"));
    else {
      const actual = casting.cores.length;
      metrics.push({
        metric: "coreCount",
        expected: l.coreCount,
        actual,
        error: actual - l.coreCount,
        tolerance: 0,
        ok: actual === l.coreCount,
      });
    }
  }
  if (l.minWallMm !== undefined) {
    const wall = casting?.wall_mm?.min;
    if (!isNum(wall))
      metrics.push(
        miss(
          "minWall",
          l.minWallMm,
          tolerances.minWallMm ?? null,
          "the wall was not measured",
        ),
      );
    else {
      const error = Math.abs(wall - l.minWallMm);
      metrics.push({
        metric: "minWall",
        expected: l.minWallMm,
        actual: wall,
        error,
        tolerance: tolerances.minWallMm ?? null,
        ok: error <= (tolerances.minWallMm as number),
      });
    }
  }
  if (l.drawAxis !== undefined) {
    const axis = casting?.draw_axis;
    if (typeof axis !== "string")
      metrics.push(miss("drawAxis", l.drawAxis, 0, "no casting measurement"));
    else
      metrics.push({
        metric: "drawAxis",
        expected: l.drawAxis,
        actual: axis,
        error: axis === l.drawAxis ? 0 : 1,
        tolerance: 0,
        ok: axis === l.drawAxis,
      });
  }
  // A part the worker could not analyse misses every label, whatever the metrics above found.
  return {
    id: part.id,
    problem,
    metrics: problem
      ? metrics.map((m) => ({ ...m, ok: false, note: m.note ?? problem }))
      : metrics,
  };
}

export interface MetricSummary {
  metric: MetricName;
  labelled: number;
  withinTolerance: number;
  passRate: number;
  ok: boolean;
}

export interface GateResult {
  corpus: AccuracyManifest["corpus"];
  parts: number;
  summaries: MetricSummary[];
  /** Why the measurements are not good enough (empty when they are). */
  failures: string[];
  /** Every labelled metric is within tolerance at the required rate, on enough parts. */
  measurementsOk: boolean;
  /** The claim the design reserves for production parts: measurements ok on a corpus declared "real". A synthetic corpus can never make it. */
  s3Passed: boolean;
}

export function gate(
  manifest: AccuracyManifest,
  reports: readonly PartReport[],
): GateResult {
  const failures: string[] = [];
  if (reports.length < manifest.minParts)
    failures.push(
      `the corpus has ${reports.length} parts, the manifest requires at least ${manifest.minParts}`,
    );
  const summaries: MetricSummary[] = [];
  for (const metric of METRICS) {
    const all = reports.flatMap((r) => r.metrics.filter((m) => m.metric === metric));
    if (all.length === 0) continue;
    const within = all.filter((m) => m.ok).length;
    const passRate = within / all.length;
    const ok = passRate >= manifest.requiredPassRate;
    summaries.push({
      metric,
      labelled: all.length,
      withinTolerance: within,
      passRate,
      ok,
    });
    if (!ok)
      failures.push(
        `${metric}: ${within} of ${all.length} within tolerance (${(passRate * 100).toFixed(1)}%), the manifest requires ${(manifest.requiredPassRate * 100).toFixed(1)}%`,
      );
  }
  const measurementsOk = failures.length === 0;
  return {
    corpus: manifest.corpus,
    parts: reports.length,
    summaries,
    failures,
    measurementsOk,
    s3Passed: measurementsOk && manifest.corpus === "real",
  };
}

const fmt = (v: number | string | null): string =>
  v === null
    ? "-"
    : typeof v === "number"
      ? Number.isInteger(v)
        ? String(v)
        : v.toFixed(3)
      : v;

/** The report as text: every miss with its numbers, then the verdict. */
export function formatReport(reports: readonly PartReport[], result: GateResult): string {
  const lines: string[] = [];
  for (const r of reports) {
    if (r.problem) lines.push(`MISS  ${r.id}: ${r.problem}`);
    for (const m of r.metrics) {
      lines.push(
        `${m.ok ? "ok  " : "MISS"}  ${r.id}  ${m.metric}: label ${fmt(m.expected)}, measured ${fmt(m.actual)}${m.error !== null ? `, off by ${fmt(m.error)}` : ""}${m.tolerance !== null ? ` (tolerance ${fmt(m.tolerance)})` : ""}${m.note ? ` - ${m.note}` : ""}`,
      );
    }
  }
  for (const s of result.summaries)
    lines.push(
      `${s.ok ? "pass" : "FAIL"}  ${s.metric}: ${s.withinTolerance} of ${s.labelled} within tolerance (${(s.passRate * 100).toFixed(1)}%)`,
    );
  for (const f of result.failures) lines.push(`GATE  ${f}`);
  lines.push(
    result.measurementsOk
      ? "GATE  measurements within tolerance"
      : "GATE  measurements NOT within tolerance",
  );
  lines.push(
    result.s3Passed
      ? "S3    the real-part accuracy gate is passed on this corpus"
      : result.corpus === "synthetic"
        ? "S3    NOT claimed: the corpus is synthetic (hand-worked parts check the tooling; only parts from production can pass the real-part gate)"
        : "S3    NOT passed",
  );
  return lines.join("\n");
}
