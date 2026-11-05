import { describe, expect, it } from "vitest";

import { isDevAuthBypass } from "@/lib/auth/dev-bypass";

describe("isDevAuthBypass", () => {
  it("is on only outside production and only for exactly 'true'", () => {
    expect(isDevAuthBypass("development", "true")).toBe(true);
    expect(isDevAuthBypass(undefined, "true")).toBe(true);
    expect(isDevAuthBypass("test", "true")).toBe(true);
  });

  it("is never on in production, whatever the flag says", () => {
    expect(isDevAuthBypass("production", "true")).toBe(false);
  });

  it("needs the explicit flag: unset, false, 1 or yes do not turn it on", () => {
    for (const flag of [undefined, "", "false", "1", "yes", "TRUE"]) expect(isDevAuthBypass("development", flag)).toBe(false);
  });
});
