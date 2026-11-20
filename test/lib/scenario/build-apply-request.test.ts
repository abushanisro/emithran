import { describe, expect, it } from "vitest";

import { buildApplyScenarioRequest, type StagedScenario } from "@/lib/scenario/build-apply-request";

const base: StagedScenario = {
  location: "USA", batchSizeDraft: null, batchSizeAuto: false, productionLife: null, annualVolumeDraft: 1000, annualVolumeSaved: 1000,
  materialGrade: "", processRouting: "auto", manualRoute: null, isDieCast: false, isForged: false,
};
const built = (over: Partial<StagedScenario>) => {
  const r = buildApplyScenarioRequest({ ...base, ...over });
  if (!r.ok) throw new Error(r.reason);
  return r.request;
};

describe("buildApplyScenarioRequest", () => {
  it("auto routing keeps the applied route (the backend applies the recommendation when there is none)", () => {
    expect(built({}).route).toEqual({ mode: "keep" });
    expect(built({}).scenarioPatch).toEqual({ processRouting: "auto" });
  });

  it("sends the batch size as typed, as null for 'derive it again', and not at all otherwise", () => {
    expect(built({ batchSizeDraft: 250 }).batchSize).toBe(250);
    expect(built({ batchSizeAuto: true }).batchSize).toBeNull();
    expect("batchSize" in built({})).toBe(false);
  });

  it("sends the annual volume only when it is a positive figure that changed", () => {
    expect(built({ annualVolumeDraft: 2000 }).annualVolume).toBe(2000);
    expect("annualVolume" in built({ annualVolumeDraft: 1000 })).toBe(false);
    expect("annualVolume" in built({ annualVolumeDraft: null })).toBe(false);
    expect("annualVolume" in built({ annualVolumeDraft: 0 })).toBe(false);
  });

  it("sends the trimmed grade, and nothing when there is none", () => {
    expect(built({ materialGrade: " ABS " }).materialGrade).toBe("ABS");
    expect("materialGrade" in built({ materialGrade: " " })).toBe(false);
  });

  it("a chosen route is applied as it is, with the machines picked for it", () => {
    const r = built({
      processRouting: "manual",
      manualRoute: { label: "Small press", directApplyRouteId: "im-small-50t", machineOverrides: [{ processKey: "Injection Molding", mhrRecordId: "m1" }] },
    });
    expect(r.route).toEqual({ mode: "route", routeId: "im-small-50t" });
    expect(r.machineOverrides).toEqual([{ processKey: "Injection Molding", mhrRecordId: "m1" }]);
    expect(r.scenarioPatch).toEqual({ processRouting: "manual" });
  });

  it("a Workflow Builder route leads with its cutting line, then its steps; a real step is sent by name only", () => {
    const r = built({
      processRouting: "manual",
      manualRoute: {
        label: "Custom", dynamicCuttingRouteId: "sm-laser", dynamicCuttingStep: { process: "Fiber Laser Cutting" },
        dynamicSteps: [{ process: "Press Brake", machineClass: "press_brake", isReal: true }, { process: "Deburring", machineClass: "deburring", isReal: false, processGroup: "Finishing" }],
      },
    });
    expect(r.route).toEqual({
      mode: "custom", baseCuttingRouteId: "sm-laser",
      steps: [{ process: "Fiber Laser Cutting" }, { process: "Press Brake" }, { process: "Deburring", machineClass: "deburring", processGroup: "Finishing" }],
    });
  });

  it("a staged route with no apply target is refused with the reason, not sent", () => {
    const r = buildApplyScenarioRequest({ ...base, processRouting: "manual", manualRoute: { label: "Odd route" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/"Odd route" cannot be applied/);
  });

  it("die casting names the chosen process on Manual and clears it on Auto; the form's currency rides in the same patch", () => {
    const manual = { label: "HPDC", directApplyRouteId: "dc-hpdc", dieCastingProcess: "High Pressure Die Casting" };
    expect(built({ isDieCast: true, processRouting: "manual", manualRoute: manual }).scenarioPatch).toEqual({ processRouting: "manual", dieCastingProcess: "High Pressure Die Casting" });
    expect(built({ isDieCast: true, scenarioPatch: { scenarioCurrency: "EUR" } }).scenarioPatch).toEqual({ processRouting: "auto", dieCastingProcess: null, scenarioCurrency: "EUR" });
  });

  it("a forging route picked in the Workflow Builder is quoted on Manual, and Auto quotes the cheapest again", () => {
    const manual = { label: "Closed-die forging · die hammer", directApplyRouteId: "forging-closed_die_hammer", forgingRoute: "closed_die_hammer" };
    expect(built({ isForged: true, processRouting: "manual", manualRoute: manual }).scenarioPatch).toEqual({ processRouting: "manual", forgingRoute: "closed_die_hammer" });
    expect(built({ isForged: true, processRouting: "manual", manualRoute: manual }).route).toEqual({ mode: "route", routeId: "forging-closed_die_hammer" });
    expect(built({ isForged: true }).scenarioPatch).toEqual({ processRouting: "auto", forgingRoute: null });
  });

  it("a bar and tube route picked in the Workflow Builder is quoted on Manual, and Auto quotes the cheapest again", () => {
    const manual = { label: "Plate oxyfuel", directApplyRouteId: "bar-tube-plate_oxyfuel", barTubeRoute: "plate_oxyfuel" };
    expect(built({ isBarTube: true, processRouting: "manual", manualRoute: manual }).scenarioPatch).toEqual({ processRouting: "manual", barTubeRoute: "plate_oxyfuel" });
    expect(built({ isBarTube: true, processRouting: "manual", manualRoute: manual }).route).toEqual({ mode: "route", routeId: "bar-tube-plate_oxyfuel" });
    expect(built({ isBarTube: true }).scenarioPatch).toEqual({ processRouting: "auto", barTubeRoute: null });
  });

  it("an additive route picked in the Workflow Builder is quoted on Manual, and Auto quotes the cheapest again", () => {
    const manual = { label: "Stereolithography (SLA)", directApplyRouteId: "additive-resin_curing", additiveRoute: "resin_curing" };
    expect(built({ isAdditive: true, processRouting: "manual", manualRoute: manual }).scenarioPatch).toEqual({ processRouting: "manual", additiveRoute: "resin_curing" });
    expect(built({ isAdditive: true, processRouting: "manual", manualRoute: manual }).route).toEqual({ mode: "route", routeId: "additive-resin_curing" });
    expect(built({ isAdditive: true }).scenarioPatch).toEqual({ processRouting: "auto", additiveRoute: null });
  });

  it("an assembly route picked in the Workflow Builder is quoted on Manual, and Auto quotes the cheapest again", () => {
    const manual = { label: "Robotic welding", directApplyRouteId: "assembly-robotic", assemblyRoute: "robotic" };
    expect(built({ isAssembly: true, processRouting: "manual", manualRoute: manual }).scenarioPatch).toEqual({ processRouting: "manual", assemblyRoute: "robotic" });
    expect(built({ isAssembly: true }).scenarioPatch).toEqual({ processRouting: "auto", assemblyRoute: null });
  });

  it("an insert molding load method picked in the Workflow Builder is quoted on Manual, and Auto quotes the cheapest again", () => {
    const manual = { label: "Insert molding · 3-axis robot", directApplyRouteId: "im-insert-3-axis", insertMoldingRoute: "3_axis" };
    expect(built({ isInsertMolding: true, processRouting: "manual", manualRoute: manual }).scenarioPatch).toEqual({ processRouting: "manual", insertMoldingRoute: "3_axis" });
    expect(built({ isInsertMolding: true }).scenarioPatch).toEqual({ processRouting: "auto", insertMoldingRoute: null });
    // Multi-shot the same: Manual quotes the press orientation picked; Auto clears it.
    const ms = { label: "Multi-shot · vertical press", directApplyRouteId: "ms-vertical", multiShotRoute: "vertical" };
    expect(built({ isMultiShot: true, processRouting: "manual", manualRoute: ms }).scenarioPatch).toEqual({ processRouting: "manual", multiShotRoute: "vertical" });
    expect(built({ isMultiShot: true }).scenarioPatch).toEqual({ processRouting: "auto", multiShotRoute: null });
  });

  it("a multi-spindle route picked in the Workflow Builder is quoted on Manual, and Auto quotes the cheapest again", () => {
    const manual = { label: "8-spindle multi-spindle", directApplyRouteId: "multispindle-8", multiSpindleRoute: "8" };
    expect(built({ isMultiSpindle: true, processRouting: "manual", manualRoute: manual }).scenarioPatch).toEqual({ processRouting: "manual", multiSpindleRoute: "8" });
    expect(built({ isMultiSpindle: true }).scenarioPatch).toEqual({ processRouting: "auto", multiSpindleRoute: null });
    // A part that is not made on a multi-spindle never writes the key.
    expect(built({ processRouting: "manual", manualRoute: manual }).scenarioPatch).not.toHaveProperty("multiSpindleRoute");
  });

  it("a weldment route picked in the Workflow Builder is quoted on Manual, and Auto quotes the cheapest again", () => {
    const manual = { label: "Robotic welding", directApplyRouteId: "partassembly-robotic", partAssemblyRoute: "robotic" };
    expect(built({ isPartAssembly: true, processRouting: "manual", manualRoute: manual }).scenarioPatch).toEqual({ processRouting: "manual", partAssemblyRoute: "robotic" });
    expect(built({ isPartAssembly: true, processRouting: "manual", manualRoute: manual }).route).toEqual({ mode: "route", routeId: "partassembly-robotic" });
    expect(built({ isPartAssembly: true }).scenarioPatch).toEqual({ processRouting: "auto", partAssemblyRoute: null });
    // A part that is not a weldment never writes the key.
    expect(built({ processRouting: "manual", manualRoute: manual }).scenarioPatch).not.toHaveProperty("partAssemblyRoute");
  });
});
