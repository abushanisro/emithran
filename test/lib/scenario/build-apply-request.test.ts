import { describe, expect, it } from "vitest";

import { buildApplyScenarioRequest, type StagedScenario } from "@/lib/scenario/build-apply-request";

const base: StagedScenario = {
  location: "USA", batchSizeDraft: null, batchSizeAuto: false, productionLife: null, annualVolumeDraft: 1000, annualVolumeSaved: 1000,
  materialGrade: "", processRouting: "auto", manualRoute: null, isDieCast: false,
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
});
