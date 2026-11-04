import { describe, expect, it } from "vitest";

import { thicknessField, thicknessRgb, vertexColors, vertexThickness } from "@/lib/casting/thickness-field";
import { thicknessColor } from "@/lib/casting/thickness-map";

describe("the wall thickness over the surface", () => {
  it("groups the rays by face in the viewer's frame, and refuses an unusable range or no rays", () => {
    const f = thicknessField(
      [
        { face: 2, at: [1000, 2000, 3000], mm: 10 },
        { face: 2, at: [0, 0, 0], mm: 12 },
        { face: 5, at: [0, 0, 0], mm: 20 },
        { face: 5, at: [0, 0, 0], mm: Number.NaN },
        { face: 5, at: [0, 0, 0], mm: 0 },
      ],
      { min: 8, max: 24 },
    )!;
    expect([...f.byFace.keys()]).toEqual([2, 5]);
    expect(f.byFace.get(2)![0]!.p).toEqual([1, 3, -2]); // (x, y, z) mm -> (x, z, -y) m
    expect(f.byFace.get(5)).toHaveLength(1);
    expect(thicknessField([], { min: 8, max: 24 })).toBeNull();
    expect(thicknessField([{ face: 0, at: [0, 0, 0], mm: 5 }], null)).toBeNull();
    expect(thicknessField([{ face: 0, at: [0, 0, 0], mm: 5 }], { min: 0, max: 5 })).toBeNull();
  });

  it("a vertex on a ray takes its thickness; one midway between two takes their mean", () => {
    const samples = [
      { p: [0, 0, 0] as const, mm: 10 },
      { p: [2, 0, 0] as const, mm: 20 },
    ];
    const t = vertexThickness([0, 0, 0, 2, 0, 0, 1, 0, 0], samples);
    expect(t[0]).toBe(10);
    expect(t[1]).toBe(20);
    expect(t[2]).toBeCloseTo(15, 5);
  });

  it("is nearer to the nearer ray: a gradient, with weights by inverse square distance", () => {
    const samples = [
      { p: [0, 0, 0] as const, mm: 10 },
      { p: [4, 0, 0] as const, mm: 20 },
    ];
    // at x = 1: d² 1 and 9, weights 1 and 1/9: (10 + 20/9) / (1 + 1/9) = 11
    expect(vertexThickness([1, 0, 0], samples)[0]).toBeCloseTo(11, 5);
  });

  it("uses only the k nearest rays", () => {
    const samples = [0, 1, 2, 3, 100].map((x) => ({ p: [x, 0, 0] as const, mm: x === 100 ? 1e6 : 10 }));
    expect(vertexThickness([0.5, 0, 0], samples, 4)[0]).toBeCloseTo(10, 9);
  });

  it("no rays, no thickness (zeros that the caller does not use)", () => {
    expect([...vertexThickness([1, 2, 3], [])]).toEqual([0]);
  });

  it("the ramp's colours are the legend's: red at the thin end, blue at the thick end, and the same hue between", () => {
    const range = { min: 4, max: 20 };
    const css = (t: number) => {
      const m = /hsl\((\d+),/.exec(thicknessColor(t, range))!;
      return Number(m[1]);
    };
    expect(thicknessRgb(4, range).map((c) => Math.round(c * 255))).toEqual([230, 25, 25]);
    expect(thicknessRgb(20, range).map((c) => Math.round(c * 255))).toEqual([25, 25, 230]);
    expect(thicknessRgb(12, range).map((c) => Math.round(c * 255))).toEqual([25, 230, 25]);
    expect(css(12)).toBe(120);
    expect(thicknessRgb(1, range)).toEqual(thicknessRgb(4, range));
    expect(thicknessRgb(99, range)).toEqual(thicknessRgb(20, range));
  });

  it("colours every vertex", () => {
    const c = vertexColors(Float32Array.from([4, 20]), { min: 4, max: 20 });
    expect(c).toHaveLength(6);
    expect(Math.abs(c[0]! * 255 - 230)).toBeLessThan(1);
    expect(Math.abs(c[5]! * 255 - 230)).toBeLessThan(1);
  });
});
