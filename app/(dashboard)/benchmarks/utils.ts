import type { EnrichedBOMItem, ProductMetrics } from "./types";

// ─── Number / formatting helpers ──────────────────────────────────────────────
export const safeNum = (v: number | string | null | undefined): number =>
  Number(v) || 0;

export const formatPrice = (price: number | string | null | undefined): string => {
  const n = safeNum(price);
  if (n === 0) return "No price set";
  if (n >= 100_000) return `$${(n / 100_000).toFixed(1)}L`;
  return `$${n.toLocaleString("en-IN")}`;
};

export const formatDate = (dateString: string): string =>
  new Date(dateString).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

// ─── Item-level helpers ───────────────────────────────────────────────────────
export const itemCost = (item: EnrichedBOMItem): number =>
  safeNum(item.unitCost) * safeNum(item.quantity);

export const itemWeight = (item: EnrichedBOMItem): number =>
  (safeNum(item.weight) || safeNum(item.unitWeight)) * safeNum(item.quantity);

// ─── Metrics calculator ───────────────────────────────────────────────────────
export const calculateMetrics = (
  bomItems: EnrichedBOMItem[] | undefined
): ProductMetrics => {
  if (!bomItems?.length) {
    return {
      totalParts: 0,
      totalWeight: 0,
      totalCost: 0,
      supplierCount: 0,
      makeVsBuy: { make: 0, buy: 0 },
      materialBreakdown: [],
      complexityMetrics: { assemblyParts: 0, subAssemblyParts: 0, childParts: 0 },
    };
  }

  const materialMap = new Map<
    string,
    { material: string; count: number; weight: number; cost: number }
  >();
  const makeVsBuy = { make: 0, buy: 0 };
  const complexityMetrics = { assemblyParts: 0, subAssemblyParts: 0, childParts: 0 };

  for (const item of bomItems) {
    if (item.makeBuy === "make") makeVsBuy.make++;
    else if (item.makeBuy === "buy") makeVsBuy.buy++;

    if (item.itemType === "assembly") complexityMetrics.assemblyParts++;
    else if (item.itemType === "sub_assembly") complexityMetrics.subAssemblyParts++;
    else if (item.itemType === "child_part") complexityMetrics.childParts++;

    if (item.material) {
      const existing = materialMap.get(item.material) ?? {
        material: item.material,
        count: 0,
        weight: 0,
        cost: 0,
      };
      materialMap.set(item.material, {
        ...existing,
        count: existing.count + 1,
        weight: existing.weight + itemWeight(item),
        cost: existing.cost + itemCost(item),
      });
    }
  }

  return {
    totalParts: bomItems.length,
    totalWeight: bomItems.reduce((s, i) => s + itemWeight(i), 0),
    totalCost: bomItems.reduce((s, i) => s + itemCost(i), 0),
    supplierCount: 0,
    makeVsBuy,
    materialBreakdown: Array.from(materialMap.values()),
    complexityMetrics,
  };
};

// ─── Chart colour helper ──────────────────────────────────────────────────────
export const chartColor = (index: number): string =>
  `hsl(${220 + index * 40}, 70%, ${45 + index * 8}%)`;