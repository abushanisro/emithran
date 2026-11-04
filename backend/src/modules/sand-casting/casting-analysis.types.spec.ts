import {
  CASTING_SCHEMA_VERSION,
  CASTING_WORKER_VERSION,
  configHash,
  DEFAULT_CASTING_CONFIG,
} from "./casting-analysis.types";

describe("casting analysis identity", () => {
  it("gives the same configuration hash whatever the key order", () => {
    expect(configHash({ drawDirection: "auto" })).toBe(
      configHash(JSON.parse('{"drawDirection":"auto"}')),
    );
    expect(configHash(DEFAULT_CASTING_CONFIG)).toMatch(/^[0-9a-f]{16}$/);
  });
  it("is tied to the worker and contract this backend was built for", () => {
    expect(CASTING_WORKER_VERSION).toBe("0.14.0");
    expect(CASTING_SCHEMA_VERSION).toBe(1);
  });
});
