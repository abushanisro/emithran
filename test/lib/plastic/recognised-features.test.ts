import { describe, expect, it } from "vitest";

import { groupFeatures, isPlasticGraph, notAssessed, type PlasticFeatureGraph, type PlasticGraphItem } from "@/lib/plastic/recognised-features";

const item = (feature_type: string, attributes: Record<string, unknown> = {}, id = feature_type): PlasticGraphItem => ({
  id, feature_type, variant: null, diameter_mm: null, depth_mm: null, attributes, occurrences: [{ face_ids: [1], centroid: [0, 0, 0] }],
});

describe("groupFeatures", () => {
  it("groups by catalog type in a fixed order, counting ribs and faces by their own count and the rest one each", () => {
    const groups = groupFeatures([
      item("PlanarFace", { faces: 131 }), item("Void", {}, "v1"), item("SimpleHole", {}, "h1"), item("Void", {}, "v2"), item("Rib", { count: 7 }), item("SimpleHole", {}, "h2"),
    ]);
    expect(groups.map((g) => [g.type, g.count])).toEqual([["SimpleHole", 2], ["Void", 2], ["Rib", 7], ["PlanarFace", 131]]);
  });

  it("marks the groups the engine says are a reading", () => {
    const g = groupFeatures([item("Void", { reading: "side_action_reading_v1" }), item("SimpleHole")]);
    expect(g.find((x) => x.type === "Void")?.reading).toBe("side_action_reading_v1");
    expect(g.find((x) => x.type === "SimpleHole")?.reading).toBeNull();
  });
});

describe("notAssessed / isPlasticGraph", () => {
  const graph: PlasticFeatureGraph = { schema: "plastic_feature_graph_v1", items: [], not_yet_recognized: ["SharpEdge", "PartingLine"], not_assessed_reasons: { SharpEdge: "no staged rule" }, unclassified_faces: 0 };

  it("gives each type its reason, and a plain statement when an older engine gave none", () => {
    expect(notAssessed(graph)).toEqual([{ type: "SharpEdge", reason: "no staged rule" }, { type: "PartingLine", reason: "not assessed from the CAD yet" }]);
  });

  it("only accepts the plastic graph schema", () => {
    expect(isPlasticGraph(graph)).toBe(true);
    expect(isPlasticGraph({ schema: "feature_graph_v2", items: [] })).toBe(false);
    expect(isPlasticGraph(null)).toBe(false);
  });
});
