import {
  type AccuracyManifest,
  type ManifestPart,
  comparePart,
  formatReport,
  gate,
  validateManifest,
} from "./casting-accuracy";

// A worker result reduced to what the gate reads. The hollow box of casting-worker/tests is 100 x 60 x 40 mm with one closed 60 x 20 x 20 mm cavity.
const result = (
  over: {
    volume?: number | null;
    wall?: number | null;
    cores?: number;
    axis?: string | null;
  } = {},
) => ({
  parts: [
    {
      volume_mm3: over.volume === undefined ? 216000 : over.volume,
      casting:
        over.axis === null
          ? null
          : {
              draw_axis: over.axis ?? "x",
              wall_mm:
                over.wall === null
                  ? null
                  : { min: over.wall ?? 10, nominal: 40, max: 100 },
              cores: Array.from({ length: over.cores ?? 1 }, () => ({})),
            },
    },
  ],
});
const part = (over: Partial<ManifestPart> = {}): ManifestPart => ({
  id: "hollow",
  file: "hollow.step",
  densityKgM3: 7100,
  // 216 000 mm3 = 0.000216 m3; x 7100 kg/m3 = 1.5336 kg
  labels: { weightKg: 1.5336, coreCount: 1, minWallMm: 10, drawAxis: "x" },
  ...over,
});
const TOL = { weightPct: 2, minWallMm: 0.5 };

describe("comparePart", () => {
  it("measures a part that matches its labels: the weight from the volume and the density, cores counted, the thinnest wall, the draw axis", () => {
    const r = comparePart(part(), result(), TOL);
    expect(r.problem).toBeNull();
    expect(r.metrics.map((m) => [m.metric, m.ok])).toEqual([
      ["weight", true],
      ["coreCount", true],
      ["minWall", true],
      ["drawAxis", true],
    ]);
    expect(r.metrics[0]!.actual).toBeCloseTo(1.5336, 6);
  });

  it("weight: a measurement 3 % off a 2 % tolerance is a miss, 1 % is within", () => {
    expect(
      comparePart(part(), result({ volume: 216000 * 1.03 }), TOL).metrics[0],
    ).toMatchObject({ ok: false, tolerance: 2 });
    expect(
      comparePart(part(), result({ volume: 216000 * 0.99 }), TOL).metrics[0]!.ok,
    ).toBe(true);
  });

  it("core count is exact: 2 cores for 1 labelled is a miss, off by 1", () => {
    const m = comparePart(part(), result({ cores: 2 }), TOL).metrics[1]!;
    expect(m).toMatchObject({ metric: "coreCount", ok: false, error: 1, actual: 2 });
  });

  it("minimum wall: 0.5 mm tolerance accepts 10.4 and refuses 11", () => {
    expect(comparePart(part(), result({ wall: 10.4 }), TOL).metrics[2]!.ok).toBe(true);
    expect(comparePart(part(), result({ wall: 11 }), TOL).metrics[2]).toMatchObject({
      ok: false,
      error: 1,
    });
  });

  it("draw axis: another axis than the engineer's is a miss", () => {
    expect(comparePart(part(), result({ axis: "y" }), TOL).metrics[3]).toMatchObject({
      ok: false,
      actual: "y",
      expected: "x",
    });
  });

  it("a measurement the worker did not make is a miss with the reason, never skipped", () => {
    const noWall = comparePart(part(), result({ wall: null }), TOL);
    expect(noWall.metrics.find((m) => m.metric === "minWall")).toMatchObject({
      ok: false,
      actual: null,
      note: "the wall was not measured",
    });
    const noVolume = comparePart(part(), result({ volume: null }), TOL);
    expect(noVolume.metrics.find((m) => m.metric === "weight")).toMatchObject({
      ok: false,
      note: "the part has no volume (not a valid solid)",
    });
    const noCasting = comparePart(part(), result({ axis: null }), TOL);
    expect(
      noCasting.metrics.filter((m) => m.metric !== "weight").every((m) => !m.ok),
    ).toBe(true);
  });

  it("a part the worker could not analyse misses every label", () => {
    for (const bad of [null, {}, { parts: [] }]) {
      const r = comparePart(part(), bad, TOL);
      expect(r.problem).not.toBeNull();
      expect(r.metrics.length).toBe(4);
      expect(r.metrics.every((m) => !m.ok)).toBe(true);
    }
    const two = comparePart(
      part(),
      { parts: [result().parts[0], result().parts[0]] },
      TOL,
    );
    expect(two.problem).toMatch(/2 distinct parts/);
    expect(two.metrics.every((m) => !m.ok)).toBe(true);
  });

  it("only the labelled metrics are judged", () => {
    expect(
      comparePart(part({ labels: { coreCount: 1 } }), result(), TOL).metrics.map(
        (m) => m.metric,
      ),
    ).toEqual(["coreCount"]);
  });
});

describe("gate", () => {
  const manifest = (over: Partial<AccuracyManifest> = {}): AccuracyManifest => ({
    corpus: "real",
    requiredPassRate: 0.9,
    minParts: 3,
    tolerances: TOL,
    parts: [],
    ...over,
  });
  const reports = (n: number, missing = 0) =>
    Array.from({ length: n }, (_, i) =>
      comparePart(part({ id: `p${i}` }), result(i < missing ? { cores: 3 } : {}), TOL),
    );

  it("passes a real corpus whose parts are within tolerance at the required rate and size", () => {
    const g = gate(manifest(), reports(10, 1)); // coreCount 9 of 10 = 90 %
    expect(g).toMatchObject({ measurementsOk: true, s3Passed: true, failures: [] });
  });

  it("fails a metric below the required rate, saying which and by how much", () => {
    const g = gate(manifest(), reports(10, 2)); // 80 % < 90 %
    expect(g.measurementsOk).toBe(false);
    expect(g.s3Passed).toBe(false);
    expect(g.failures).toEqual([
      "coreCount: 8 of 10 within tolerance (80.0%), the manifest requires 90.0%",
    ]);
  });

  it("a corpus smaller than the manifest requires does not pass, however good", () => {
    const g = gate(manifest(), reports(2));
    expect(g.measurementsOk).toBe(false);
    expect(g.failures[0]).toMatch(/2 parts, the manifest requires at least 3/);
  });

  it("a synthetic corpus can have good measurements but can never claim the real-part gate", () => {
    const g = gate(manifest({ corpus: "synthetic" }), reports(5));
    expect(g.measurementsOk).toBe(true);
    expect(g.s3Passed).toBe(false);
    expect(formatReport(reports(5), g)).toMatch(
      /S3 {4}NOT claimed: the corpus is synthetic/,
    );
  });

  it("the report lists every miss with its numbers, then the verdict", () => {
    const rs = reports(3, 1);
    const text = formatReport(rs, gate(manifest({ minParts: 1 }), rs));
    expect(text).toMatch(
      /MISS {2}p0 {2}coreCount: label 1, measured 3, off by 2 \(tolerance 0\)/,
    );
    expect(text).toMatch(/FAIL {2}coreCount: 2 of 3 within tolerance/);
    expect(text).toMatch(/GATE {2}measurements NOT within tolerance/);
  });
});

describe("validateManifest", () => {
  const ok = (): AccuracyManifest => ({
    corpus: "real",
    requiredPassRate: 0.9,
    minParts: 2,
    tolerances: TOL,
    parts: [part({ id: "a" }), part({ id: "b" })],
  });
  const errors = (m: unknown) =>
    "errors" in validateManifest(m)
      ? (validateManifest(m) as { errors: string[] }).errors
      : [];

  it("accepts a complete manifest", () => {
    expect(validateManifest(ok())).toEqual({ manifest: ok() });
  });

  it("defaults nothing: the pass rate, the corpus size and the tolerances must be written", () => {
    expect(errors({ ...ok(), requiredPassRate: undefined })).toContain(
      "requiredPassRate must be a number above 0 and at most 1",
    );
    expect(errors({ ...ok(), requiredPassRate: 1.2 })).toHaveLength(1);
    expect(errors({ ...ok(), minParts: 0 })).toContain(
      "minParts must be a whole number of at least 1",
    );
    expect(errors({ ...ok(), tolerances: {} })).toEqual([
      "tolerances.weightPct is required (a percentage above 0) because parts are labelled with a weight",
      "tolerances.minWallMm is required (mm above 0) because parts are labelled with a minimum wall",
    ]);
    expect(errors({ ...ok(), corpus: "demo" })).toContain(
      'corpus must be "real" or "synthetic"',
    );
  });

  it("names a bad part: duplicate id, no labels, a weight without a density, an unknown label, a bad axis", () => {
    const m = ok();
    m.parts = [
      part({ id: "a" }),
      part({ id: "a" }),
      part({ id: "c", labels: {} }),
      part({ id: "d", densityKgM3: undefined }),
      part({ id: "e", labels: { colour: 1 } as never }),
      part({ id: "f", labels: { drawAxis: "w" as never } }),
    ];
    const e = errors(m);
    expect(e).toEqual(
      expect.arrayContaining([
        expect.stringContaining("parts[1] (a): id is used twice"),
        expect.stringContaining("parts[2] (c): labels must name at least one"),
        expect.stringContaining("parts[3] (d): densityKgM3 is required with weightKg"),
        expect.stringContaining("parts[4] (e): unknown label colour"),
        expect.stringContaining("parts[5] (f): drawAxis must be x, y or z"),
      ]),
    );
  });

  it("a manifest that is not one", () => {
    expect(errors(null)).toEqual(["the manifest is not an object"]);
    expect(errors({ ...ok(), parts: [] })).toContain(
      "parts must be a list of at least one part",
    );
  });
});
