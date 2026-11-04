import { readFileSync } from "fs";
import { join } from "path";
import { measurementsFromCastingResult } from "./casting-measurements";
import { parseCastingResult } from "./casting-result";

// The worker's own output for a synthetic hollow box (backend/test/fixtures/casting/README.md): 100 x 60 x 40 mm with a closed 60 x 20 x 20 mm void.
// Hand-worked from that shape: volume 100 x 60 x 40 - 24 000 = 216 000 mm³; drawn along x, the footprint is 60 x 40 and the depth 100; the parting
// line is the section at x = 50 (the box's middle), 2 x (60 + 40) = 200 mm long; the casting stands 100 - 50 = 50 mm above it; one core of 24 000 mm³.
const fixture = JSON.parse(readFileSync(join(__dirname, "../../../test/fixtures/casting/hollow-box.result.json"), "utf8"));

describe("measurementsFromCastingResult (the worker's result for a hollow box)", () => {
  it("the fixture is a result of the contract this backend reads", () => {
    expect(() => parseCastingResult(fixture)).not.toThrow();
  });

  it("reads the exact solid: volume, surface, size, footprint and draw depth", () => {
    const { measurements, missing } = measurementsFromCastingResult(fixture);
    expect(missing).toEqual([]);
    expect(measurements).toMatchObject({ volumeMm3: 216000, surfaceAreaMm2: 30400, bboxMm: [100, 60, 40], footprintMm: [60, 40], drawDepthMm: 100 });
  });

  it("reads the parting line, the height above it and the nominal wall", () => {
    const { measurements } = measurementsFromCastingResult(fixture);
    expect(measurements!.partingPerimeterMm).toBe(200);
    expect(measurements!.abovePartingMm).toBe(50);
    expect(measurements!.wallNominalMm).toBe(40);
  });

  it("reads the core with its true volume and size", () => {
    const { measurements } = measurementsFromCastingResult(fixture);
    expect(measurements!.rawCores).toEqual([{ volume_mm3: 24000, box_mm: [60, 20, 20] }]);
  });

  it("measures a part with no core as having none (an empty list, not unknown)", () => {
    const solid = { ...fixture, parts: [{ ...fixture.parts[0], casting: { ...fixture.parts[0].casting, cores: [] } }] };
    expect(measurementsFromCastingResult(solid).measurements!.rawCores).toEqual([]);
  });

  it("leaves the height above the parting line unknown when the part has no parting section, never a guess", () => {
    const none = { ...fixture, parts: [{ ...fixture.parts[0], casting: { ...fixture.parts[0].casting, parting: null } }] };
    expect(measurementsFromCastingResult(none).measurements!.abovePartingMm).toBeNull();
  });

  it("refuses what is not one analysed casting: an assembly, no part, no casting block, no volume", () => {
    const two = { ...fixture, parts: [fixture.parts[0], fixture.parts[0]] };
    expect(measurementsFromCastingResult(two).missing[0]).toMatch(/2 distinct parts/);
    expect(measurementsFromCastingResult({ parts: [] }).missing[0]).toMatch(/no part/);
    expect(measurementsFromCastingResult({ parts: [{ ...fixture.parts[0], casting: null }] }).missing[0]).toMatch(/no casting measurement/);
    expect(measurementsFromCastingResult({ parts: [{ ...fixture.parts[0], volume_mm3: null }] }).missing[0]).toMatch(/part volume/);
    expect(measurementsFromCastingResult(null).measurements).toBeNull();
  });
});
