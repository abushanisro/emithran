import { describe, expect, it } from "vitest";
import {
  analysesForDirection,
  describeDrawDirection,
  directionOf,
  drawDirectionError,
  heldBack,
} from "@/lib/casting/draw-direction";

describe("analysesForDirection", () => {
  const list = [
    { id: "a", drawDirection: "auto" as const },
    { id: "b", drawDirection: "y" as const },
    { id: "c", drawDirection: "auto" as const },
  ];
  it("keeps only the analyses along the asked direction, in order", () => {
    expect(analysesForDirection(list, "auto").map((a) => a.id)).toEqual(["a", "c"]);
    expect(analysesForDirection(list, "y").map((a) => a.id)).toEqual(["b"]);
    expect(analysesForDirection(list, "z")).toEqual([]);
  });
});

describe("directionOf", () => {
  it("is the engineer's axis, else automatic (also before it has loaded)", () => {
    expect(directionOf({ axis: "z", reason: "r", setBy: "u", setAt: "t" })).toBe("z");
    expect(directionOf({ axis: null, reason: null, setBy: null, setAt: null })).toBe(
      "auto",
    );
    expect(directionOf(undefined)).toBe("auto");
  });
});

describe("drawDirectionError", () => {
  it("accepts an axis and a reason of 3 to 500 characters (trimmed)", () => {
    expect(
      drawDirectionError({ axis: "y", reason: "split on the long side" }, null),
    ).toBeNull();
    expect(drawDirectionError({ axis: "x", reason: "abc" }, "y")).toBeNull();
    expect(drawDirectionError({ axis: "x", reason: "x".repeat(500) }, null)).toBeNull();
  });
  it("says what is wrong", () => {
    expect(drawDirectionError({ axis: "", reason: "because" }, null)).toMatch(
      /Choose the axis/,
    );
    expect(drawDirectionError({ axis: "w", reason: "because" }, null)).toMatch(
      /Choose the axis/,
    );
    expect(drawDirectionError({ axis: "y", reason: "because" }, "y")).toBe(
      "The draw direction is already Y.",
    );
    expect(drawDirectionError({ axis: "y", reason: "  ab  " }, null)).toMatch(
      /at least 3/,
    );
    expect(drawDirectionError({ axis: "y", reason: "x".repeat(501) }, null)).toMatch(
      /at most 500/,
    );
  });
});

describe("describeDrawDirection", () => {
  it("says what was chosen and by whom", () => {
    expect(
      describeDrawDirection({ axis: "y", reason: "r", setBy: "u", setAt: "t" }, "x"),
    ).toBe("Fixed to Y by an engineer");
    expect(describeDrawDirection(undefined, "x")).toMatch(
      /^Automatic: the worker chose X/,
    );
    expect(
      describeDrawDirection({ axis: null, reason: null, setBy: null, setAt: null }, null),
    ).toMatch(/^Automatic: the worker chooses/);
  });
});

describe("a draw direction held back after the item's file was replaced", () => {
  const view = (over: Record<string, unknown> = {}) =>
    ({
      axis: null,
      declaredAxis: "y",
      reason: "split on the long side",
      setBy: "u",
      setAt: "t",
      status: "needs_confirmation",
      notice:
        "The 3D file was replaced by a different geometry (faces 12 to 17): the draw direction is not applied.",
      ...over,
    }) as never;

  it("is the choice with why it is not applied, and it can be confirmed; a pending one cannot (nothing to confirm against yet)", () => {
    expect(heldBack(view())).toEqual({
      axis: "y",
      notice: expect.stringContaining("different geometry"),
      pending: false,
    });
    expect(
      heldBack(
        view({
          status: "pending",
          notice: "The 3D file was replaced: checked when its analysis is done.",
        }),
      ),
    ).toMatchObject({ axis: "y", pending: true });
  });

  it("is nothing when there is no choice or it applies", () => {
    expect(heldBack(undefined)).toBeNull();
    expect(heldBack(view({ declaredAxis: null, status: null, notice: null }))).toBeNull();
    expect(heldBack(view({ axis: "y", status: "in_force", notice: null }))).toBeNull();
  });

  it("runs the analysis automatically meanwhile: the direction is auto, and the words say the choice is held back", () => {
    expect(directionOf(view())).toBe("auto");
    expect(describeDrawDirection(view(), null)).toBe(
      "Automatic for now: the draw direction Y is held back",
    );
  });
});
