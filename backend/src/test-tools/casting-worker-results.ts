// Compares the casting worker's results with casting-worker/tests/expected.json (hand-worked answers) and its
// result.schema.json. A TypeScript port of the check the worker had in the retired petrus-demo prototype (`emithran-checks worker-results`),
// same rules, so the worker's own golden file is used unchanged. Pure functions: files are read by the caller.
import Ajv2020 from "ajv8/dist/2020";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Check {
  name: string;
  ok: boolean;
  detail?: unknown;
}

/**
 * Fields in `expected` only; numbers within 0.1 % (0.001 absolute near zero), everything else exactly.
 * `{ approx: n, within_pct: p }` accepts a number within p % of n (measurements taken by sampling, e.g. ray casting).
 */
export function same(expected: Json, actual: Json | undefined): boolean {
  if (
    expected !== null &&
    typeof expected === "object" &&
    !Array.isArray(expected) &&
    typeof expected.approx === "number" &&
    typeof expected.within_pct === "number"
  ) {
    return (
      typeof actual === "number" &&
      Math.abs(actual - expected.approx) <=
        (expected.within_pct / 100) * Math.abs(expected.approx)
    );
  }
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((e, i) => same(e, actual[i]))
    );
  }
  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual))
      return false;
    const a = actual as { [key: string]: Json };
    return Object.entries(expected).every(([k, v]) => k in a && same(v, a[k]));
  }
  if (typeof expected === "number" && typeof actual === "number") {
    return Math.abs(actual - expected) <= Math.max(1e-3, 1e-3 * Math.abs(expected));
  }
  return expected === actual;
}

/** A GLB file's JSON chunk if the file is a well-formed glTF 2.0 binary (header, declared length = file size). */
export function glbJson(bytes: Buffer | undefined): Obj | null {
  if (!bytes || bytes.length < 20) return null;
  if (bytes.toString("latin1", 0, 4) !== "glTF") return null;
  if (bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) return null;
  if (bytes.readUInt32LE(16) !== 0x4e4f534a) return null;
  const end = 20 + bytes.readUInt32LE(12);
  if (end > bytes.length) return null;
  try {
    return JSON.parse(bytes.toString("utf8", 20, end)) as Obj;
  } catch {
    return null;
  }
}

const HOLE_KINDS = [
  "SimpleHole",
  "MultiStepHole",
  "RingedHole",
  "Ring",
  "Void",
  "ComboVoid",
];
const one = (n: number) => n.toFixed(1);

/**
 * Holes, rings and voids as one sorted line each: "SimpleHole d=12.0 L=15.0 blind", "Ring d=16.0 w=10.0 inner in
 * RingedHole", "Void 30.0x10.0x10.0 core=1 in ComboVoid", "ComboVoid members=2 core=1". Hidden ones end in " hidden".
 */
export function holesAndRings(features: Obj[] | undefined): string[] {
  const lines = (features ?? [])
    .filter((f) => HOLE_KINDS.includes(f.type))
    .map((f) => {
      const p: Obj = f.parameters ?? {};
      const num = (k: string): number => (typeof p[k] === "number" ? p[k] : 0);
      let s: string;
      if (f.type === "Void") {
        s = `Void ${one(num("box_length_mm"))}x${one(num("box_width_mm"))}x${one(num("box_height_mm"))} core=${num("core")}`;
      } else if (f.type === "ComboVoid") {
        s = `ComboVoid members=${num("members")} core=${num("core")}`;
      } else {
        s = `${f.type} d=${one(num("diameter_mm"))}`;
      }
      if (typeof p.max_diameter_mm === "number") s += `-${one(p.max_diameter_mm)}`;
      if (typeof p.depth_mm === "number") s += ` L=${one(p.depth_mm)}`;
      if (typeof p.width_mm === "number") s += ` w=${one(p.width_mm)}`;
      if (typeof p.through === "number") s += p.through === 1 ? " through" : " blind";
      if (typeof p.outer === "number") s += p.outer === 1 ? " outer" : " inner";
      if (p.hidden === 1) s += " hidden";
      if (typeof f.parent === "string") s += ` in ${f.parent.split(":")[0]}`;
      return s;
    });
  return lines.sort();
}

/** Adds to each part what expected.json compares for features: counts per type, concave sharp edges, hole lines. */
export function summariseFeatures(result: Obj): void {
  for (const part of result.parts ?? []) {
    const counts: Record<string, number> = {};
    let concave = 0;
    for (const f of part.features ?? []) {
      const kind = typeof f.type === "string" ? f.type : "?";
      counts[kind] = (counts[kind] ?? 0) + 1;
      if (f.type === "SharpEdge" && f.parameters?.convex === 0) concave += 1;
    }
    part.feature_counts = counts;
    part.concave_sharp_edges = concave;
    part.holes = holesAndRings(part.features);
  }
}

function instanceIds(nodes: Obj[] | undefined, out: string[]): void {
  for (const node of nodes ?? []) {
    for (const id of node.instance_ids ?? []) if (typeof id === "string") out.push(id);
    instanceIds(node.children, out);
  }
}

/** What one sample run left behind (written by check.sh): exit code, stdout, result.json and the GLB files. */
export interface SampleRun {
  exit: number;
  out: string;
  result?: string; // result.json text
  file: (relative: string) => Buffer | undefined; // a file next to result.json
}

export function compareSample(
  sample: string,
  expected: Obj,
  run: SampleRun,
  validate: (result: unknown) => string[],
): Check[] {
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    checks.push({ name, ok, detail });
  check(`${sample}: exit code ${expected.exit}`, expected.exit === run.exit, run.exit);
  if (expected.error !== undefined) {
    let out: Obj = {};
    try {
      out = JSON.parse(run.out) as Obj;
    } catch {
      /* stays empty: the check below fails */
    }
    check(`${sample}: error ${expected.error}`, out.error === expected.error, run.out);
    return checks;
  }
  if (run.exit !== 0) return checks;

  let result: Obj = {};
  try {
    result = JSON.parse(run.result ?? "") as Obj;
  } catch {
    /* an unreadable result fails the schema check */
  }
  const schemaErrors = validate(result);
  summariseFeatures(result);
  check(
    `${sample}: result.json matches result.schema.json`,
    schemaErrors.length === 0,
    schemaErrors,
  );

  const badGlb: string[] = [];
  for (const part of result.parts ?? []) {
    if (typeof part.glb === "string") {
      const json = glbJson(run.file(part.glb)) ?? {};
      const meshes: Obj[] = json.meshes ?? [];
      const primitives = meshes.reduce((n, m) => n + (m.primitives?.length ?? 0), 0);
      const faces = (part.glb_faces ?? []).length;
      // One primitive per face, in the order `glb_faces` lists: what the page highlights.
      if (meshes.length === 0 || !part.triangles || primitives !== faces) {
        badGlb.push(`${part.glb}: ${primitives} primitives, ${faces} glb_faces`);
      }
    }
    const coresGlb = part.casting?.cores_glb;
    if (typeof coresGlb === "string") {
      const json = glbJson(run.file(coresGlb)) ?? {};
      const names: string[] = (json.nodes ?? [])
        .map((n: Obj) => n.name)
        .filter((n: unknown) => typeof n === "string");
      (part.casting.cores ?? []).forEach((core: Obj, i: number) => {
        const name = `core ${i + 1}`;
        if (core.body === true && !names.some((x) => x.startsWith(name))) {
          badGlb.push(`${coresGlb}: no node ${name} in ${JSON.stringify(names)}`);
        }
      });
    }
  }
  check(
    `${sample}: every part GLB is valid glTF 2.0 with meshes`,
    badGlb.length === 0,
    badGlb,
  );

  if (typeof result.model_glb === "string") {
    const model = glbJson(run.file("model.glb")) ?? {};
    const names: string[] = (model.nodes ?? [])
      .map((n: Obj) => n.name)
      .filter((n: unknown) => typeof n === "string");
    const ids: string[] = [];
    instanceIds(result.assembly, ids);
    const missing = ids.filter((id) => !names.some((n) => n.endsWith(`[${id}]`)));
    check(
      `${sample}: model.glb has a node for every instance in the tree`,
      names.length > 0 && missing.length === 0,
      missing,
    );
  }

  check(
    `${sample}: schema version 1, millimetres`,
    result.schema_version === 1 && result.units === "mm",
  );
  for (const key of ["status", "diagnostics", "inputs"]) {
    if (expected[key] !== undefined)
      check(`${sample}: ${key}`, same(expected[key], result[key]), result[key]);
  }
  if (expected.tree !== undefined)
    check(
      `${sample}: assembly tree and quantities`,
      same(expected.tree, result.assembly),
      result.assembly,
    );
  if (expected.parts !== undefined)
    check(`${sample}: part properties`, same(expected.parts, result.parts), result.parts);
  for (const [name, props] of Object.entries(expected.parts_by_name ?? {})) {
    const part = (result.parts ?? []).find((p: Obj) => p.name === name);
    check(
      `${sample}: part ${name}`,
      part !== undefined && same(props as Json, part),
      part,
    );
  }
  return checks;
}

/** A schema validator that returns the list of problems (empty = valid). */
export function schemaValidator(schema: object): (result: unknown) => string[] {
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  return (result) =>
    validate(result)
      ? []
      : (validate.errors ?? []).map((e) => `${e.instancePath}: ${e.message}`);
}

/**
 * A copy of a STEP file with its first vertex moved 0.5 mm along X, off the edges that meet there: what an imprecise
 * export looks like (still a solid, no longer valid).
 */
export function shiftVertex(text: string): string | null {
  const at = text.indexOf("VERTEX_POINT('");
  if (at < 0) return null;
  const comma = text.indexOf(",#", at);
  if (comma < 0) return null;
  const id = /^\d+/.exec(text.slice(comma + 2))?.[0];
  if (!id) return null;
  const line = text.indexOf(`#${id} = CARTESIAN_POINT(`);
  if (line < 0) return null;
  const open = text.indexOf(",(", line);
  if (open < 0) return null;
  const start = open + 2;
  const end = text.indexOf(",", start);
  if (end < 0) return null;
  const moved = Number(text.slice(start, end).trim()) + 0.5;
  return Number.isFinite(moved)
    ? `${text.slice(0, start)}${moved}${text.slice(end)}`
    : null;
}
