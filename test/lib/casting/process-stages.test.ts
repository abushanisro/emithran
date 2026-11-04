import { describe, expect, it } from "vitest";

import { processStages, stageMinutes } from "@/lib/casting/process-stages";

const lines = [
  { process: "Melting", cycleTimeMin: 2 },
  { process: "Hot Box coremaking", cycleTimeMin: 1.5 },
  { process: "Horizontal Automatic", cycleTimeMin: 0.75 },
  { process: "Pour", cycleTimeMin: 0.5 },
  { process: "Cooling", cycleTimeMin: 30 },
  { process: "Shakeout", cycleTimeMin: 0.25 },
  { process: "Degating", cycleTimeMin: 1 },
  { process: "Cleaning", cycleTimeMin: 0.5 },
  { process: "Finishing", cycleTimeMin: 3 },
  { process: "Visual Inspection", cycleTimeMin: 0.25 },
];

describe("the stages of making a sand casting", () => {
  const stages = processStages(lines, "Horizontal Automatic");
  const by = (k: string) => stages.find((s) => s.key === k)!;

  it("runs in the route's order: mould, cores, close, pour, cool, shakeout, degate, finish", () => {
    expect(stages.map((s) => s.key)).toEqual(["mould", "cores", "close", "pour", "cool", "shakeout", "degate", "finish"]);
  });

  it("gives each stage the route lines that cost it, and nothing else", () => {
    expect(by("mould").lines.map((l) => l.process)).toEqual(["Horizontal Automatic"]);
    expect(by("cores").lines.map((l) => l.process)).toEqual(["Hot Box coremaking"]);
    expect(by("pour").lines.map((l) => l.process)).toEqual(["Melting", "Pour"]);
    expect(by("finish").lines.map((l) => l.process)).toEqual(["Cleaning", "Finishing", "Visual Inspection"]);
    expect(stages.flatMap((s) => s.lines)).toHaveLength(lines.length);
  });

  it("puts the coating, the drying and the core gluing with the stage they belong to", () => {
    const coated = processStages(
      [
        ...lines,
        { process: "Core Refractory Coat", cycleTimeMin: 0.1 },
        { process: "Core assembly", cycleTimeMin: 1 },
        { process: "Refractory Coat Oven Dry (cores)", cycleTimeMin: 0.2 },
        { process: "Mold Refractory Coat", cycleTimeMin: 0.3 },
        { process: "Refractory Coat Air Dry (mould)", cycleTimeMin: 0.4 },
      ],
      "Horizontal Automatic",
    );
    const names = (k: string) => coated.find((s) => s.key === k)!.lines.map((l) => l.process);
    expect(names("cores")).toEqual(["Hot Box coremaking", "Core Refractory Coat", "Core assembly", "Refractory Coat Oven Dry (cores)"]);
    expect(names("mould")).toEqual(["Horizontal Automatic", "Mold Refractory Coat", "Refractory Coat Air Dry (mould)"]);
    expect(coated.flatMap((s) => s.lines)).toHaveLength(lines.length + 5);
  });

  it("adds a stage's minutes, and says nothing for a stage the route has no line for", () => {
    expect(stageMinutes(by("pour"))).toBe(2.5);
    expect(stageMinutes(by("finish"))).toBe(3.75);
    expect(stageMinutes(by("close"))).toBeNull();
  });

  it("a part with no cores has no core line, and a route not yet built has no lines at all", () => {
    const none = processStages(lines.filter((l) => !/coremaking/.test(l.process)), "Horizontal Automatic");
    expect(none.find((s) => s.key === "cores")!.lines).toEqual([]);
    expect(processStages(null, null).every((s) => s.lines.length === 0)).toBe(true);
  });

  it("shows the assembly state: open while moulding, closed and cut for pouring, sand gone after shakeout, gating gone at the end", () => {
    expect(by("mould").view).toMatchObject({ mould: true, open: 1, cores: false });
    expect(by("cores").view).toMatchObject({ mould: true, open: 1, cores: true });
    expect(by("pour").view).toMatchObject({ mould: true, open: 0, section: true });
    expect(by("shakeout").view).toMatchObject({ mould: false, gating: true });
    expect(by("finish").view).toMatchObject({ mould: false, gating: false, cores: false });
  });
});
