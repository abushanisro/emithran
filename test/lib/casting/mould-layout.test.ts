import { describe, expect, it } from "vitest";

import type { GatingSolid } from "@/lib/casting/gating-layout";
import { gatingWhenOpen, mouldSolids, sectionAxisFor } from "@/lib/casting/mould-layout";

// A part 100 x 60 x 40 mm with its parting plane at z = 20, a runner beside it, in a flask 400 x 300 x 200 mm.
const part = { partMin: [0, 0, 0] as const, partMax: [100, 60, 40] as const };
const runner: GatingSolid = { name: "Runner", box: { min: [-20, 60, 14], max: [100, 80, 20] } };
const base = {
  flask: { lengthMm: 300, widthMm: 400, heightMm: 200 },
  partMin: part.partMin as unknown as [number, number, number],
  partMax: part.partMax as unknown as [number, number, number],
  gating: [runner],
  drawAxis: "z" as const,
  partingHeight: 20,
  open: 0,
};
const box = (s: GatingSolid) => ("box" in s ? s.box : null);

describe("the mould around the part", () => {
  it("splits the flask at the parting plane: half its height above (cope) and half below (drag)", () => {
    const m = mouldSolids(base)!;
    expect(box(m.cope)!.min[2]).toBe(20);
    expect(box(m.cope)!.max[2]).toBe(120);
    expect(box(m.drag)!.min[2]).toBe(-80);
    expect(box(m.drag)!.max[2]).toBe(20);
  });

  it("centres the flask on the footprint of the part and its gating, the flask's longer side along the footprint's longer side", () => {
    // footprint: x -20..100 (120), y 0..80 (80): x is longer, so the 400 mm side lies along x, centred on x = 40, y = 40.
    const m = mouldSolids(base)!;
    expect(box(m.cope)!.min[0]).toBe(40 - 200);
    expect(box(m.cope)!.max[0]).toBe(40 + 200);
    expect(box(m.cope)!.min[1]).toBe(40 - 150);
    expect(box(m.cope)!.max[1]).toBe(40 + 150);
    expect(m.fits).toBe(true);
  });

  it("opening the mould moves the cope up and the drag down by half the flask height each, fully open", () => {
    const m = mouldSolids({ ...base, open: 1 })!;
    expect(box(m.cope)!.min[2]).toBe(120);
    expect(box(m.drag)!.max[2]).toBe(-80);
    const half = mouldSolids({ ...base, open: 0.5 })!;
    expect(box(half.cope)!.min[2]).toBe(70);
    expect(mouldSolids({ ...base, open: 7 })!.cope).toEqual(m.cope);
  });

  it("says when the part and its gating do not fit the flask, and draws nothing without a flask", () => {
    expect(mouldSolids({ ...base, flask: { lengthMm: 100, widthMm: 80, heightMm: 200 } })!.fits).toBe(false);
    expect(mouldSolids({ ...base, flask: { lengthMm: 0, widthMm: 400, heightMm: 200 } })).toBeNull();
  });

  it("uses the middle of the draw depth when the parting height is not measured, and a cylinder's whole extent", () => {
    const riser: GatingSolid = { name: "Riser", cylinder: { base: [50, 30, 40], axis: 2, radius: 25, length: 30 } };
    const m = mouldSolids({ ...base, gating: [riser], partingHeight: null })!;
    expect(box(m.cope)!.min[2]).toBe(20);
    // footprint x 0..100, y 0..60 (riser 25..75 inside the part's): fits
    expect(m.fits).toBe(true);
  });
});

describe("the gating when the mould is opened", () => {
  const solids: GatingSolid[] = [
    { name: "Runner", box: { min: [0, 0, 10], max: [10, 10, 20] } },
    { name: "Sprue", cylinder: { base: [5, 5, 20], axis: 2, radius: 5, length: 90 } },
    { name: "Sprue well", cylinder: { base: [5, 5, 0], axis: 2, radius: 8, length: 20 } },
    { name: "Riser 1", cylinder: { base: [50, 5, 40], axis: 2, radius: 10, length: 30 } },
  ];
  it("moves the sprue and risers with the cope, and leaves the runner and the well with the drag", () => {
    const open = gatingWhenOpen(solids, "z", 100);
    const by = (n: string) => open.find((s) => s.name === n)!;
    expect("cylinder" in by("Sprue") && by("Sprue").cylinder.base[2]).toBe(120);
    expect("cylinder" in by("Riser 1") && by("Riser 1").cylinder.base[2]).toBe(140);
    expect(by("Runner")).toEqual(solids[0]);
    expect(by("Sprue well")).toEqual(solids[2]);
  });
  it("closed, nothing moves", () => {
    expect(gatingWhenOpen(solids, "z", 0)).toEqual(solids);
  });
});

describe("the section", () => {
  it("never cuts in the parting plane: across the frame's z when the draw axis is x, across x otherwise", () => {
    expect(sectionAxisFor("x")).toBe(2);
    expect(sectionAxisFor("y")).toBe(0);
    expect(sectionAxisFor("z")).toBe(0);
    expect(sectionAxisFor(null)).toBe(0);
  });
});
