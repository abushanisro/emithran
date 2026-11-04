import { readFileSync } from "node:fs";
import { join } from "node:path";

import { compareGeometry, fingerprintOf, parseFingerprint, type GeometryFingerprint } from "./geometry-fingerprint";

// The worker's own result for the hollow box: 100 x 60 x 40 mm with a closed 60 x 20 x 20 mm cavity.
const hollowBox = JSON.parse(readFileSync(join(__dirname, "../../../test/fixtures/casting/hollow-box.result.json"), "utf8"));

const g = (over: Partial<GeometryFingerprint> = {}): GeometryFingerprint => ({ solids: 1, faces: 12, edges: 24, volumeMm3: 216000, areaMm2: 31200, boxMm: [100, 60, 40], ...over });

describe("fingerprintOf", () => {
  it("reads the real worker result: one solid, 12 faces, 24 edges, 216 000 mm3, 100 x 60 x 40", () => {
    const f = fingerprintOf(hollowBox)!;
    expect(f).toMatchObject({ solids: 1, faces: 12, edges: 24, boxMm: [100, 60, 40] });
    expect(f.volumeMm3).toBeCloseTo(216000, 3);
    expect(f.areaMm2).toBeGreaterThan(0);
  });

  it("is null for what is not one measured part: none, several, or a missing measurement", () => {
    expect(fingerprintOf(null)).toBeNull();
    expect(fingerprintOf({ parts: [] })).toBeNull();
    expect(fingerprintOf({ parts: [hollowBox.parts[0], hollowBox.parts[0]] })).toBeNull();
    expect(fingerprintOf({ parts: [{ ...hollowBox.parts[0], volume_mm3: null }] })).toBeNull();
    expect(fingerprintOf({ parts: [{ ...hollowBox.parts[0], box_mm: { size: [1, 2] } }] })).toBeNull();
  });

  it("survives being stored and read back", () => {
    const f = fingerprintOf(hollowBox)!;
    expect(parseFingerprint(JSON.parse(JSON.stringify(f)))).toEqual(f);
    expect(parseFingerprint(null)).toBeNull();
    expect(parseFingerprint({ solids: 1 })).toBeNull();
    expect(parseFingerprint({ ...f, boxMm: [1, "x", 3] })).toBeNull();
  });
});

describe("compareGeometry", () => {
  it("the same part exported twice (differences of the exporter's tolerance) is the same", () => {
    expect(compareGeometry(g(), g({ volumeMm3: 216000.5, areaMm2: 31200.2, boxMm: [100.004, 59.998, 40] }))).toEqual({ same: true, differences: [] });
  });

  it("a different part is different, and the differences are named with both values", () => {
    // a rib added: more faces and edges, more volume, a taller box
    const r = compareGeometry(g(), g({ faces: 17, edges: 33, volumeMm3: 250000, areaMm2: 35000, boxMm: [100, 60, 55] }));
    expect(r.same).toBe(false);
    expect(r.differences).toEqual(["faces 12 to 17", "edges 24 to 33", "volume 216000 to 250000 mm3", "surface 31200 to 35000 mm2", "size along z 40.00 to 55.00 mm"]);
  });

  it("the same shape turned in its file is not the same part for a draw axis: the extents move between axes", () => {
    const r = compareGeometry(g(), g({ boxMm: [60, 100, 40] }));
    expect(r.same).toBe(false);
    expect(r.differences).toEqual(["size along x 100.00 to 60.00 mm", "size along y 60.00 to 100.00 mm"]);
  });

  it("a hole too small to move the volume past the tolerance still moves the face and edge counts", () => {
    const r = compareGeometry(g(), g({ faces: 14, edges: 27, volumeMm3: 215999 }));
    expect(r.same).toBe(false);
    expect(r.differences).toEqual(["faces 12 to 14", "edges 24 to 27"]);
  });

  it("the tolerances are 1e-4 relative (0.01 mm more on an extent): just inside is the same, just outside is not", () => {
    expect(compareGeometry(g(), g({ volumeMm3: 216000 * (1 + 0.9e-4) })).same).toBe(true);
    expect(compareGeometry(g(), g({ volumeMm3: 216000 * (1 + 1.5e-4) })).same).toBe(false);
    expect(compareGeometry(g(), g({ boxMm: [100.011, 60, 40] })).same).toBe(true);
    expect(compareGeometry(g(), g({ boxMm: [100.03, 60, 40] })).same).toBe(false);
  });
});
