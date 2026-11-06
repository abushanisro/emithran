import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Applying a scenario analyses the part itself (POST /bom-items/:id/analysis-runs), so there is no separate Refresh Analysis action. This keeps it
// from coming back under the same name or another: no button, hook or text of that kind in the app, its libraries or its components. The electronics
// module is a different workflow (an ECAD design) with its own button, and is not covered.
const ROOT = join(__dirname, "..", "..");
const FORBIDDEN = [/Refresh Analysis/i, /useRefreshAnalysis/, /handleRefreshAnalysis/, /onReanalyse/, /Re-analyse part/];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name === ".next" || name === "electronics" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("no Refresh Analysis action", () => {
  it("appears nowhere in app/, lib/ or components/", () => {
    const hits = ["app", "lib", "components"].flatMap((d) => sources(join(ROOT, d))).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return FORBIDDEN.filter((re) => re.test(text)).map((re) => `${file.replace(ROOT, "")}: ${String(re)}`);
    });
    expect(hits).toEqual([]);
  });

  it("the manufacturing-intelligence page applies a scenario as one backend request, which makes the analysis current itself", () => {
    const page = readFileSync(join(ROOT, "app/(dashboard)/projects/[id]/bom/[bomId]/items/[itemId]/manufacturing-intelligence/page.tsx"), "utf8");
    expect(page).toContain("useApplyScenario(item?.id)");
    // The step-by-step client sequence (material record, route re-apply, volume commit as part of Apply) is gone.
    for (const removed of ["autoAddMaterialCost", "reapplyExistingOrDefaultRoute", "autoAddProcessCosts", "useCreateRawMaterialCost"]) expect(page).not.toContain(removed);
  });
});
