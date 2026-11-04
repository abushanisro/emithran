import { overrideBinding } from "./override-binding";
import { type GeometryFingerprint } from "./geometry-fingerprint";

const box = (over: Partial<GeometryFingerprint> = {}): GeometryFingerprint => ({ solids: 1, faces: 12, edges: 24, volumeMm3: 216000, areaMm2: 31200, boxMm: [100, 60, 40], ...over });

describe("overrideBinding: whether the engineer's draw direction still applies to the item's file", () => {
  it("applies while the item's file is the one it was set on, whatever else is known", () => {
    expect(overrideBinding({ override: { sourcePath: "a/part.step", geometry: box() }, currentPath: "a/part.step", current: null })).toEqual({ state: "in_force", basis: "same_file", notice: null });
    expect(overrideBinding({ override: { sourcePath: "a/part.step", geometry: null }, currentPath: "a/part.step", current: box({ faces: 99 }) }).state).toBe("in_force");
  });

  it("applies to an item with no file (nothing to analyse, nothing to attach to)", () => {
    expect(overrideBinding({ override: { sourcePath: "a/part.step", geometry: box() }, currentPath: null, current: null }).state).toBe("in_force");
  });

  it("a replaced file that is the same geometry (re-uploaded or re-exported): applies, by geometry", () => {
    const r = overrideBinding({ override: { sourcePath: "a/part.step", geometry: box() }, currentPath: "b/part-v2.step", current: box({ volumeMm3: 216000.2, boxMm: [100.002, 60, 40] }) });
    expect(r).toEqual({ state: "in_force", basis: "same_geometry", notice: null });
  });

  it("a replaced file that is a different geometry: held back, with what differs, to be confirmed or removed", () => {
    const r = overrideBinding({ override: { sourcePath: "a/part.step", geometry: box() }, currentPath: "b/part.step", current: box({ faces: 17, volumeMm3: 250000 }) });
    expect(r.state).toBe("needs_confirmation");
    expect(r.notice).toMatch(/replaced by a different geometry \(faces 12 to 17; volume 216000 to 250000 mm3\).*not applied.*Confirm it for the new file or remove it/);
  });

  it("a replaced file turned in its file (the part rotated) is not the same: held back", () => {
    expect(overrideBinding({ override: { sourcePath: "a", geometry: box() }, currentPath: "b", current: box({ boxMm: [60, 100, 40] }) }).state).toBe("needs_confirmation");
  });

  it("a replaced file not yet analysed: held back as pending, not guessed", () => {
    const r = overrideBinding({ override: { sourcePath: "a", geometry: box() }, currentPath: "b", current: null });
    expect(r.state).toBe("pending");
    expect(r.notice).toMatch(/checked when its analysis is done/);
  });

  it("a replaced file when the geometry the override was set on was never recorded: held back for confirmation, even if the new file is analysed (nothing to compare)", () => {
    for (const current of [null, box()]) {
      const r = overrideBinding({ override: { sourcePath: "a", geometry: null }, currentPath: "b", current });
      expect(r.state).toBe("needs_confirmation");
      expect(r.notice).toMatch(/was not recorded/);
    }
  });

  it("an override whose file was never recorded is held back when the item has a file it cannot be tied to", () => {
    // legacy rows are backfilled by the migration with the file current then; a null path here is a row that could not be, and is treated as a different file
    expect(overrideBinding({ override: { sourcePath: null, geometry: null }, currentPath: "b", current: box() }).state).toBe("needs_confirmation");
  });
});
