import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// One place starts the part's analysis: the Refresh analysis button in the top bar (POST /bom-items/:id/analysis-runs through useAnalysisRun). Apply
// Scenario and Apply Route never start one: on a part that is not analysed they point at that button (the backend refuses them too, 409
// analysis_not_ready). This keeps a second, hidden way of starting an analysis from coming back. The electronics module (an ECAD design) has its
// own workflow and is not covered.
const ROOT = join(__dirname, "..", "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name === ".next" || name === "electronics" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("the analysis has one entry point", () => {
  it("only the Refresh analysis button runs the analysis", () => {
    const users = ["app", "lib", "components"].flatMap((d) => sources(join(ROOT, d)))
      .filter((file) => !file.endsWith("useAnalysisRun.ts") && /\buseAnalysisRun\(/.test(readFileSync(file, "utf8")))
      .map((file) => file.replace(ROOT, ""));
    expect(users).toEqual(["/components/features/analysis/RefreshAnalysisButton.tsx"]);
  });

  it("the manufacturing-intelligence page shows the button, gates both Apply buttons, and applies a scenario as one backend request", () => {
    const page = readFileSync(join(ROOT, "app/(dashboard)/projects/[id]/bom/[bomId]/items/[itemId]/manufacturing-intelligence/page.tsx"), "utf8");
    expect(page).toContain("<RefreshAnalysisButton");
    expect(page.match(/cueRefreshAnalysis\(\)/g)?.length).toBe(2);
    expect(page).toContain("useApplyScenario(item?.id)");
    for (const removed of ["autoAddMaterialCost", "reapplyExistingOrDefaultRoute", "autoAddProcessCosts", "useCreateRawMaterialCost"]) expect(page).not.toContain(removed);
  });
});
