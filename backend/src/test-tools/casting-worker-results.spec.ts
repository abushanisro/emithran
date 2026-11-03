import {
  compareSample,
  glbJson,
  holesAndRings,
  same,
  schemaValidator,
  shiftVertex,
  summariseFeatures,
} from "./casting-worker-results";

describe("casting worker result comparison", () => {
  describe("same", () => {
    it("compares only the fields in expected", () => {
      expect(same({ a: 1 }, { a: 1, b: 2 })).toBe(true);
      expect(same({ a: 1, c: 3 }, { a: 1 })).toBe(false);
    });
    it("accepts numbers within 0.1 %, and 0.001 near zero", () => {
      expect(same(1000, 1000.9)).toBe(true);
      expect(same(1000, 1002)).toBe(false);
      expect(same(0, 0.0009)).toBe(true);
      expect(same(0, 0.01)).toBe(false);
    });
    it("accepts a sampled measurement within its stated percentage", () => {
      expect(same({ approx: 100, within_pct: 5 }, 104)).toBe(true);
      expect(same({ approx: 100, within_pct: 5 }, 106)).toBe(false);
      expect(same({ approx: 100, within_pct: 5 }, null)).toBe(false);
    });
    it("needs arrays of the same length and exact strings and null", () => {
      expect(same([1, 2], [1, 2, 3])).toBe(false);
      expect(same("mm", "mm")).toBe(true);
      expect(same(null, 0)).toBe(false);
    });
  });

  describe("holesAndRings", () => {
    it("writes one sorted line per hole, ring and void", () => {
      const lines = holesAndRings([
        { type: "PlanarFace" },
        { type: "SimpleHole", parameters: { diameter_mm: 12, depth_mm: 15, through: 0 } },
        {
          type: "Ring",
          parent: "RingedHole:1",
          parameters: { diameter_mm: 16, width_mm: 10, outer: 0 },
        },
        {
          type: "Void",
          parent: "ComboVoid:2",
          parameters: { box_length_mm: 30, box_width_mm: 10, box_height_mm: 10, core: 1 },
        },
        { type: "SimpleHole", parameters: { diameter_mm: 8, through: 1, hidden: 1 } },
      ]);
      expect(lines).toEqual([
        "Ring d=16.0 w=10.0 inner in RingedHole",
        "SimpleHole d=12.0 L=15.0 blind",
        "SimpleHole d=8.0 through hidden",
        "Void 30.0x10.0x10.0 core=1 in ComboVoid",
      ]);
    });
  });

  it("summarises features per type and counts concave sharp edges", () => {
    const result = {
      parts: [
        {
          features: [
            { type: "PlanarFace" },
            { type: "PlanarFace" },
            { type: "SharpEdge", parameters: { convex: 0 } },
            { type: "SharpEdge", parameters: { convex: 1 } },
          ],
        },
      ],
    };
    summariseFeatures(result);
    expect(result.parts[0]).toMatchObject({
      feature_counts: { PlanarFace: 2, SharpEdge: 2 },
      concave_sharp_edges: 1,
      holes: [],
    });
  });

  describe("glbJson", () => {
    const glb = (json: object, length?: number): Buffer => {
      const body = Buffer.from(JSON.stringify(json));
      const buf = Buffer.alloc(20 + body.length);
      buf.write("glTF", 0, "latin1");
      buf.writeUInt32LE(2, 4);
      buf.writeUInt32LE(length ?? buf.length, 8);
      buf.writeUInt32LE(body.length, 12);
      buf.writeUInt32LE(0x4e4f534a, 16);
      body.copy(buf, 20);
      return buf;
    };
    it("reads the JSON chunk of a well-formed binary", () => {
      expect(glbJson(glb({ meshes: [] }))).toEqual({ meshes: [] });
    });
    it("refuses a wrong declared length, a missing file and text", () => {
      expect(glbJson(glb({}, 999))).toBeNull();
      expect(glbJson(undefined)).toBeNull();
      expect(glbJson(Buffer.from("not a glb file at all, really"))).toBeNull();
    });
  });

  describe("shiftVertex", () => {
    const step = "#1 = CARTESIAN_POINT('',(0.,0.,0.));\n#2 = VERTEX_POINT('',#1);\n";
    it("moves the first vertex 0.5 mm along x", () => {
      expect(shiftVertex(step)).toContain("CARTESIAN_POINT('',(0.5,0.,0.))");
    });
    it("returns null when there is no vertex", () => {
      expect(shiftVertex("ISO-10303-21;")).toBeNull();
    });
  });

  describe("compareSample", () => {
    const validate = schemaValidator({ type: "object", required: ["schema_version"] });
    const noFile = () => undefined;
    it("checks an expected error against the worker output", () => {
      const ok = compareSample(
        "x.step",
        { exit: 2, error: "unreadable_step" },
        { exit: 2, out: '{"error":"unreadable_step"}', file: noFile },
        validate,
      );
      expect(ok.every((c) => c.ok)).toBe(true);
      const bad = compareSample(
        "x.step",
        { exit: 2, error: "unreadable_step" },
        { exit: 0, out: "", file: noFile },
        validate,
      );
      expect(bad.some((c) => !c.ok)).toBe(true);
    });
    it("fails a result that does not match the schema", () => {
      const checks = compareSample(
        "x.step",
        { exit: 0 },
        { exit: 0, out: "", result: "{}", file: noFile },
        validate,
      );
      expect(checks.find((c) => c.name.includes("result.schema.json"))?.ok).toBe(false);
    });
    it("passes a result whose expected parts match", () => {
      const result = JSON.stringify({
        schema_version: 1,
        units: "mm",
        parts: [{ name: "p", volume_mm3: 100 }],
      });
      const checks = compareSample(
        "x.step",
        { exit: 0, parts: [{ volume_mm3: 100 }] },
        { exit: 0, out: "", result, file: noFile },
        validate,
      );
      expect(checks.every((c) => c.ok)).toBe(true);
    });
  });
});
