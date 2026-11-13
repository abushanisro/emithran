import { castingSourcePath } from "./casting-source";

// The casting worker reads STEP only: a STEP upload's own file wins over its STL conversion for the viewer.
describe("castingSourcePath", () => {
  it("prefers the STEP when the item has both", () => {
    expect(castingSourcePath({ file_3d_path: "a/part.stl", file_step_path: "a/part.step" })).toBe("a/part.step");
  });
  it("uses the 3D file when there is no separate STEP (uploaded as STEP from the start)", () => {
    expect(castingSourcePath({ file_3d_path: "a/part.step", file_step_path: null })).toBe("a/part.step");
  });
  it("is null when the item has no file", () => {
    expect(castingSourcePath({ file_3d_path: null, file_step_path: null })).toBeNull();
  });
});
