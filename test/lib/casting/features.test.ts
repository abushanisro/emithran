import { describe, expect, it } from "vitest";
import {
  castingFeatureProperties,
  groupCastingFeatures,
  type CastingWorkerFeature,
} from "@/lib/casting/features";

const f = (
  id: string,
  parent: string | null = null,
  parameters: Record<string, number> = {},
): CastingWorkerFeature => ({
  id,
  type: id.split(":")[0]!,
  parent,
  faces: [1, 2],
  edges: [],
  parameters,
});

describe("groupCastingFeatures", () => {
  it("groups by the die-casting categories and keeps every feature once, in the worker order", () => {
    const groups = groupCastingFeatures([
      f("SimpleHole:1"),
      f("PlanarFace:1"),
      f("SimpleHole:2"),
      f("Void:1"),
    ]);
    expect(groups.map((g) => [g.key, g.count])).toEqual([
      ["volume", 1],
      ["holes", 2],
      ["surfaces", 1],
    ]);
    expect(groups[1]!.types[0]!.rows.map((r) => r.label)).toEqual([
      "SimpleHole:1",
      "SimpleHole:2",
    ]);
  });

  it("never drops a type no category lists", () => {
    const groups = groupCastingFeatures([f("Gusset:1")]);
    expect(groups).toEqual([
      {
        key: "other",
        label: "Other",
        count: 1,
        types: [
          { type: "Gusset", rows: [expect.objectContaining({ label: "Gusset:1" })] },
        ],
      },
    ]);
  });

  it("is empty for no features", () => {
    expect(groupCastingFeatures([])).toEqual([]);
  });
});

describe("castingFeatureProperties", () => {
  it("lists the name, parent, measured parameters and face count", () => {
    const row = groupCastingFeatures([
      f("Ring:1", "SimpleHole:1", { diameter_mm: 12, depth_mm: 7.456 }),
    ])[0]!.types[0]!.rows[0]!;
    expect(castingFeatureProperties(row)).toEqual([
      { name: "Name", value: "Ring:1" },
      { name: "Part of", value: "SimpleHole:1" },
      { name: "diameter_mm", value: "12" },
      { name: "depth_mm", value: "7.46" },
      { name: "Faces", value: "2" },
    ]);
  });
});
