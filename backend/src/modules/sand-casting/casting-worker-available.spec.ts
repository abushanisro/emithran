import { castingWorkerAvailable } from "./casting-config";

// One rule for "a casting worker will run the analyses": the runner and the analysis status both use it.
describe("castingWorkerAvailable", () => {
  it("needs the worker's socket", () => {
    expect(castingWorkerAvailable({ CASTING_WORKER_SOCKET: "/run/casting-worker/worker.sock" })).toBe(true);
    expect(castingWorkerAvailable({})).toBe(false);
    expect(castingWorkerAvailable({ CASTING_WORKER_SOCKET: "" })).toBe(false);
  });
  it("is off when the runner is switched off", () => {
    expect(castingWorkerAvailable({ CASTING_WORKER_SOCKET: "/s.sock", CASTING_ANALYSIS_RUNNER: "off" })).toBe(false);
  });
});
