import { describe, expect, it } from "vitest";

import { thicknessColor, thicknessMap } from "@/lib/casting/thickness-map";

function mapOf(faces: Parameters<typeof thicknessMap>[0]) {
  const m = thicknessMap(faces);
  if (!m) throw new Error("expected a map");
  return m;
}

describe("the wall-thickness colour map", () => {
  const faces = [
    { face: 0, min: 4 },
    { face: 1, min: 12 },
    { face: 2, min: 20 },
  ];

  it("runs from red at the thinnest measured face to blue at the thickest, with the part's own range", () => {
    const m = mapOf(faces);
    expect(m.range).toEqual({ min: 4, max: 20 });
    expect(m.colors.get(0)).toBe("hsl(0, 80%, 50%)");
    expect(m.colors.get(1)).toBe("hsl(120, 80%, 50%)");
    expect(m.colors.get(2)).toBe("hsl(240, 80%, 50%)");
  });

  it("a part with one thickness everywhere is one colour, not a division by zero", () => {
    const m = mapOf([{ face: 3, min: 8 }, { face: 5, min: 8 }]);
    expect(new Set(m.colors.values()).size).toBe(1);
    expect(thicknessColor(8, { min: 8, max: 8 })).toBe("hsl(120, 80%, 50%)");
  });

  it("leaves out faces with no usable measurement, and gives nothing when none has one", () => {
    const m = mapOf([{ face: 0, min: Number.NaN }, { face: 1, min: 0 }, { face: 2, min: 6 }]);
    expect([...m.colors.keys()]).toEqual([2]);
    expect(thicknessMap([])).toBeNull();
    expect(thicknessMap([{ face: 0, min: -1 }])).toBeNull();
  });

  it("clamps a value outside the range to the ends", () => {
    expect(thicknessColor(1, { min: 4, max: 20 })).toBe("hsl(0, 80%, 50%)");
    expect(thicknessColor(99, { min: 4, max: 20 })).toBe("hsl(240, 80%, 50%)");
  });
});
