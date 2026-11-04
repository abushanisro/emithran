import {
  DRAW_AXIS_INPUT,
  PART_INPUT,
  drawDirectionMismatch,
  workerInputs,
} from "./casting-config";

const STEP = Buffer.from("ISO-10303-21;");

describe("workerInputs", () => {
  it("is the part alone for the automatic draw direction", () => {
    expect(workerInputs(STEP, { drawDirection: "auto" })).toEqual([
      { name: PART_INPUT, bytes: STEP },
    ]);
  });

  it("adds the axis as a file whose whole content is the axis", () => {
    for (const axis of ["x", "y", "z"] as const) {
      const inputs = workerInputs(STEP, { drawDirection: axis });
      expect(inputs.map((i) => i.name)).toEqual([PART_INPUT, DRAW_AXIS_INPUT]);
      expect(inputs[1]!.bytes.toString("utf8")).toBe(axis);
    }
  });

  it("uses the name the worker image's adapter looks for", () => {
    // casting-worker/host-adapter.sh reads exactly this input; the two must stay equal.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const adapter = require("node:fs").readFileSync(
      require.resolve("../../../../casting-worker/host-adapter.sh"),
      "utf8",
    ) as string;
    expect(adapter).toContain(`"${DRAW_AXIS_INPUT}"`);
  });
});

describe("drawDirectionMismatch", () => {
  const part = (axis: string, source: string) => ({
    parts: [{ casting: { draw_axis: axis, draw_axis_source: source } }],
  });

  it("accepts what was asked for", () => {
    expect(
      drawDirectionMismatch(part("y", "requested"), { drawDirection: "y" }),
    ).toBeNull();
    expect(
      drawDirectionMismatch(part("x", "auto"), { drawDirection: "auto" }),
    ).toBeNull();
  });

  it("names a result that is not what was asked for", () => {
    expect(drawDirectionMismatch(part("x", "auto"), { drawDirection: "y" })).toMatch(
      /asked for draw axis y, the worker reports x \(auto\)/,
    );
    expect(drawDirectionMismatch(part("z", "requested"), { drawDirection: "y" })).toMatch(
      /reports z \(requested\)/,
    );
    expect(
      drawDirectionMismatch(part("y", "requested"), { drawDirection: "auto" }),
    ).toMatch(/asked for the automatic draw axis/);
  });

  it("looks at every measured part, and skips a part with no casting block (no valid solid)", () => {
    expect(
      drawDirectionMismatch(
        {
          parts: [
            { casting: null },
            { casting: { draw_axis: "y", draw_axis_source: "requested" } },
          ],
        },
        { drawDirection: "y" },
      ),
    ).toBeNull();
    expect(
      drawDirectionMismatch(
        {
          parts: [
            { casting: { draw_axis: "y", draw_axis_source: "requested" } },
            { casting: { draw_axis: "x", draw_axis_source: "requested" } },
          ],
        },
        { drawDirection: "y" },
      ),
    ).not.toBeNull();
    expect(drawDirectionMismatch({}, { drawDirection: "y" })).toBeNull();
  });
});
