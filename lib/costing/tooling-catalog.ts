import type { ToolingCatalogDomain, ToolingCatalogItem } from "@/lib/api/tooling-catalogs";

/** The Add Tooling form fields a catalog item fills. A per-kg or per-cavity item starts at one unit for the user to set. */
export function catalogItemFields(item: ToolingCatalogItem) {
  return {
    toolingType: item.kind,
    description: item.name,
    specifications: item.details,
    unitCost: String(item.unitCostUsd),
    quantity: String(item.typicalQuantity ?? 1),
  };
}

const UNIT_TEXT: Record<ToolingCatalogItem["unit"], string> = { each: "each", kg: "per kg", cavity: "per cavity" };

/** Where the price came from: the staged table and its row (numbered from 1, as the table shows it). */
export function catalogSourceLine(item: ToolingCatalogItem): string {
  const { dataset, table, row } = item.source;
  return `${item.unitCostUsd} USD ${UNIT_TEXT[item.unit]}, from ${table} row ${row + 1} (${dataset})`;
}

/** Tooling spread over the part's lifetime volume: annual volume x production life. None without a real annual volume. */
export function defaultAmortization(
  inputs: { annualVolume: number | null; productionLifeYears: number } | undefined,
): { parts: number; why: string } | null {
  if (!inputs?.annualVolume || !(inputs.productionLifeYears > 0)) return null;
  return {
    parts: Math.round(inputs.annualVolume * inputs.productionLifeYears),
    why: `${inputs.annualVolume.toLocaleString("en-US")} parts a year x ${inputs.productionLifeYears} years of production life`,
  };
}

/** Where a saved tooling row was priced from: its catalog row, or "custom"; nothing for a row saved before the catalog. */
export function catalogSourceLabel(r: { isCustom?: boolean | null; catalogSource?: string | null }): string | null {
  const m = r.catalogSource ? /^([^:]+):([^:]+):([0-9]+)$/.exec(r.catalogSource) : null;
  if (m) return `from ${m[2] ?? ""} row ${Number(m[3]) + 1}`;
  return r.isCustom ? "custom item" : null;
}

/** A process's display name: its catalog domain label, else the saved key made readable (records saved before the catalog). */
export function processLabel(key: string | null | undefined, domains: readonly ToolingCatalogDomain[]): string {
  if (!key) return "";
  return domains.find((d) => d.key === key)?.label ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
