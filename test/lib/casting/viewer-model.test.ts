import { describe, expect, it } from "vitest";
import {
  glbMatchesFaces,
  lineSegments,
  primitivesOfFaces,
  toGlbFrame,
} from "@/lib/casting/viewer-model";

describe("toGlbFrame", () => {
  it("turns Z-up millimetres into Y-up metres", () => {
    expect(toGlbFrame([1000, 2000, 3000])).toEqual([1, 3, -2]);
    expect(toGlbFrame([0, 0, 0])).toEqual([0, 0, -0]);
  });
});

describe("lineSegments", () => {
  const a = [0, 0, 0] as const,
    b = [1000, 0, 0] as const,
    c = [1000, 1000, 0] as const;
  it("joins consecutive points of an open polyline", () => {
    expect([...lineSegments([[a, b, c]])]).toEqual([
      0, 0, -0, 1, 0, -0, 1, 0, -0, 1, 0, -1,
    ]);
  });
  it("closes a loop back to its first point, repeating nothing", () => {
    expect(lineSegments([[a, b, c]], true).length).toBe(3 * 6); // three segments, two points each
    expect([...lineSegments([[a, b, c]], true)].slice(-6)).toEqual([1, 0, -1, 0, 0, -0]);
  });
  it("draws nothing for one point, and skips a point that is not finite", () => {
    expect(lineSegments([[a]]).length).toBe(0);
    expect(lineSegments([[a, [NaN, 0, 0], b]]).length).toBe(6);
    expect(lineSegments([]).length).toBe(0);
  });
});

describe("primitivesOfFaces", () => {
  it("finds the primitives that show the faces, in primitive order", () => {
    expect(primitivesOfFaces([5, 7, 3, 9], [9, 5])).toEqual([0, 3]);
  });
  it("selects nothing for a face the GLB does not show", () => {
    expect(primitivesOfFaces([5, 7], [1])).toEqual([]);
    expect(primitivesOfFaces([5, 7], [])).toEqual([]);
  });
});

describe("glbMatchesFaces", () => {
  it("requires one mesh per glb_faces entry", () => {
    expect(glbMatchesFaces(4, [1, 2, 3, 4])).toBe(true);
    expect(glbMatchesFaces(3, [1, 2, 3, 4])).toBe(false);
    expect(glbMatchesFaces(0, [])).toBe(false);
  });
});
