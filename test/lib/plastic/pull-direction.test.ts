import { describe, expect, it } from "vitest";

import type { PlasticPullDirection } from "@/lib/api/plastic-pull-direction";
import { describePullDirection, heldBack, pullDirectionError } from "@/lib/plastic/pull-direction";

const base: PlasticPullDirection = { axis: null, declaredAxis: null, reason: null, setBy: null, setAt: null, status: "automatic", notice: null };

describe("pullDirectionError", () => {
  it("needs an axis, a different one, and a reason of 3 to 500 characters", () => {
    expect(pullDirectionError({ axis: "", reason: "tool opens along Y" }, null)).toMatch(/Choose the axis/);
    expect(pullDirectionError({ axis: "w", reason: "tool opens along Y" }, null)).toMatch(/Choose the axis/);
    expect(pullDirectionError({ axis: "y", reason: "tool opens along Y" }, "y")).toMatch(/already Y/);
    expect(pullDirectionError({ axis: "y", reason: " ab " }, null)).toMatch(/at least 3/);
    expect(pullDirectionError({ axis: "y", reason: "x".repeat(501) }, null)).toMatch(/too long/);
    expect(pullDirectionError({ axis: "y", reason: "tool opens along Y" }, null)).toBeNull();
  });
});

describe("describePullDirection / heldBack", () => {
  it("says automatic, fixed, or held back", () => {
    expect(describePullDirection(undefined)).toMatch(/^Automatic/);
    expect(describePullDirection({ ...base, axis: "z", declaredAxis: "z", status: "in_force" })).toBe("Fixed to Z by an engineer");
    const held: PlasticPullDirection = { ...base, declaredAxis: "x", status: "needs_confirmation", notice: "The 3D file was replaced." };
    expect(describePullDirection(held)).toMatch(/X is held back/);
    expect(heldBack(held)).toEqual({ axis: "x", notice: "The 3D file was replaced." });
  });

  it("an override that applies is not held back", () => {
    expect(heldBack({ ...base, axis: "z", declaredAxis: "z", status: "in_force" })).toBeNull();
    expect(heldBack(base)).toBeNull();
  });
});
