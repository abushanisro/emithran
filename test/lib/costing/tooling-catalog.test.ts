import { describe, expect, it } from "vitest";

import { catalogItemFields, catalogSourceLabel, catalogSourceLine, domainForProcessGroup, defaultAmortization, processLabel } from "@/lib/costing/tooling-catalog";
import type { ToolingCatalogItem } from "@/lib/api/tooling-catalogs";

const AIR_POPPET: ToolingCatalogItem = {
  id: "2026-Plastic:cmStandardToolingComponents:0",
  kind: "Mold component",
  name: "Air Poppet",
  details: "",
  unitCostUsd: 25,
  unit: "each",
  typicalQuantity: 30,
  source: { dataset: "2026-Plastic", table: "cmStandardToolingComponents", row: 0 },
};

const STEEL: ToolingCatalogItem = {
  ...AIR_POPPET,
  id: "2026-Plastic:digital_factory_tool_materials_usa:0",
  kind: "Tool steel",
  name: "AISI 1020",
  details: "hardness 143",
  unitCostUsd: 1.54,
  unit: "kg",
  typicalQuantity: null,
  source: { dataset: "2026-Plastic", table: "digital_factory_tool_materials_usa", row: 0 },
};

describe("tooling catalog in the Add Tooling dialog", () => {
  it("fills the form from a catalog item: type, description, unit cost and the typical quantity per tool", () => {
    expect(catalogItemFields(AIR_POPPET)).toEqual({
      toolingType: "Mold component",
      description: "Air Poppet",
      specifications: "",
      unitCost: "25",
      quantity: "30",
    });
  });

  it("prices a per-kg item per kg and leaves the quantity at one kg for the user to set", () => {
    expect(catalogItemFields(STEEL)).toMatchObject({ description: "AISI 1020", specifications: "hardness 143", unitCost: "1.54", quantity: "1" });
  });

  it("says where the price came from, row numbered from 1 as the table shows it", () => {
    expect(catalogSourceLine(AIR_POPPET)).toBe("25 USD each, from cmStandardToolingComponents row 1 (2026-Plastic)");
    expect(catalogSourceLine(STEEL)).toBe("1.54 USD per kg, from digital_factory_tool_materials_usa row 1 (2026-Plastic)");
  });

  it("amortizes over the part's lifetime volume when its annual volume is on file, and says so", () => {
    expect(defaultAmortization({ annualVolume: 10_000, productionLifeYears: 3 })).toEqual({
      parts: 30_000,
      why: "10,000 parts a year x 3 years of production life",
    });
  });

  it("gives no default without a real annual volume (never a made-up figure)", () => {
    expect(defaultAmortization({ annualVolume: null, productionLifeYears: 3 })).toBeNull();
    expect(defaultAmortization(undefined)).toBeNull();
    expect(defaultAmortization({ annualVolume: 10_000, productionLifeYears: 0 })).toBeNull();
  });

  it("labels a process by its catalog domain, and an older saved key readably", () => {
    const domains = [{ key: "injection_molding", label: "Plastic Molding" }];
    expect(processLabel("injection_molding", domains)).toBe("Plastic Molding");
    expect(processLabel("quality_inspection", domains)).toBe("Quality Inspection");
    expect(processLabel(null, domains)).toBe("");
  });

  it("labels a saved row by its catalog row, as custom, or not at all for a row saved before the catalog", () => {
    expect(catalogSourceLabel({ isCustom: false, catalogSource: "2026-Plastic:cmStandardToolingComponents:0" })).toBe("from cmStandardToolingComponents row 1");
    expect(catalogSourceLabel({ isCustom: true, catalogSource: null })).toBe("custom item");
    expect(catalogSourceLabel({ isCustom: false, catalogSource: null })).toBeNull();
  });

  it("opens on the part's own process: the catalog domain whose label is the part's process group", () => {
    const domains = [{ key: "injection_molding", label: "Plastic Molding" }, { key: "die_casting", label: "Die Casting" }];
    expect(domainForProcessGroup("Plastic Molding", domains)).toBe("injection_molding");
    expect(domainForProcessGroup("plastic molding ", domains)).toBe("injection_molding");
    // a process with no tooling catalog opens with none chosen, never a guess
    expect(domainForProcessGroup("Forging", domains)).toBeNull();
    expect(domainForProcessGroup(null, domains)).toBeNull();
  });
});
