import { describe, expect, it } from "vitest";
import { castingPartView } from "@/lib/casting/result-view";

const part = {
  glb: "parts/0-1-1-1.glb",
  glb_faces: [3, 1, 2],
  features: [
    {
      id: "Void:1",
      type: "Void",
      parent: null,
      faces: [1, 2],
      edges: [],
      parameters: { core: 1 },
    },
    {
      id: "SharpEdge:1",
      type: "SharpEdge",
      parent: "Void:1",
      faces: [3],
      edges: [
        [
          [0, 0, 0],
          [1, 0, 0],
        ],
      ],
      parameters: { convex: 1 },
    },
  ],
  casting: {
    draw_axis: "z",
    draw_axis_source: "requested",
    cores_glb: "parts/0-1-1-1-cores.glb",
    parting: {
      points: [
        [0, 0, 5],
        [1, 0, 5],
        [1, 1, 5],
      ],
    },
  },
};

describe("castingPartView", () => {
  it("reads the one part: meshes, faces, features, parting line, draw axis", () => {
    const v = castingPartView({ parts: [part] });
    expect(v).toEqual({
      glb: "parts/0-1-1-1.glb",
      coresGlb: "parts/0-1-1-1-cores.glb",
      glbFaces: [3, 1, 2],
      features: [
        {
          id: "Void:1",
          type: "Void",
          parent: null,
          faces: [1, 2],
          edges: [],
          parameters: { core: 1 },
        },
        {
          id: "SharpEdge:1",
          type: "SharpEdge",
          parent: "Void:1",
          faces: [3],
          edges: [
            [
              [0, 0, 0],
              [1, 0, 0],
            ],
          ],
          parameters: { convex: 1 },
        },
      ],
      partingPoints: [
        [0, 0, 5],
        [1, 0, 5],
        [1, 1, 5],
      ],
      drawAxis: "z",
      drawAxisSource: "requested",
    });
  });

  it("shows nothing of a piece the result lacks, and does not break", () => {
    const v = castingPartView({
      parts: [
        {
          features: [
            { id: "x" },
            null,
            {
              id: "Ring:1",
              type: "Ring",
              faces: ["a", 2],
              edges: [
                [
                  [1, 2],
                  [1, 2, 3],
                ],
              ],
              parameters: { d: "x", w: 2 },
            },
          ],
          casting: null,
        },
      ],
    });
    expect(v).toEqual({
      glb: null,
      coresGlb: null,
      glbFaces: [],
      partingPoints: null,
      drawAxis: null,
      drawAxisSource: null,
      features: [
        {
          id: "Ring:1",
          type: "Ring",
          parent: null,
          faces: [2],
          edges: [[[1, 2, 3]]],
          parameters: { w: 2 },
        },
      ],
    });
  });

  it("says why an analysis of no part or several parts is not shown", () => {
    expect(castingPartView(null)).toEqual({ reason: "The analysis holds no part." });
    expect(castingPartView({ parts: [] })).toEqual({
      reason: "The analysis holds no part.",
    });
    expect(castingPartView({ parts: [part, part] })).toEqual({
      reason: "The analysis holds 2 distinct parts: the casting views are for one part.",
    });
  });

  it("a parting line of fewer than three points is not a loop", () => {
    expect(
      (
        castingPartView({
          parts: [
            {
              ...part,
              casting: {
                ...part.casting,
                parting: {
                  points: [
                    [0, 0, 0],
                    [1, 0, 0],
                  ],
                },
              },
            },
          ],
        }) as { partingPoints: unknown }
      ).partingPoints,
    ).toBeNull();
  });
});
