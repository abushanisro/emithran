import type { EnrichedBOMItem, MaterialCategory, ProductMetrics } from "./types";

// ─── Number / formatting helpers ──────────────────────────────────────────────
export const safeNum = (v: number | string | null | undefined): number =>
  Number(v) || 0;

export const formatPrice = (price: number | string | null | undefined): string => {
  const n = safeNum(price);
  if (n === 0) return "No price set";
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`;
  return `₹${n.toLocaleString("en-IN")}`;
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

// ─── Material classification ──────────────────────────────────────────────────
export const buildMaterialCategories = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawMaterials: any[]
): Record<MaterialCategory, Set<string>> => {
  // Enhanced material extraction that handles multiple possible API structures
  const extractMaterials = (materials: any[], categoryFilter: (m: any) => boolean) => {
    if (!Array.isArray(materials)) return [];
    
    return materials
      .filter(categoryFilter)
      .map((m) => {
        // Try different property names for material name
        return m.name || m.materialName || m.material || m.title || m.description || String(m);
      })
      .filter(Boolean);
  };

  const ferrousFilter = (m: any) => {
    const category = (m.category || m.type || m.materialType || '').toLowerCase();
    const name = (m.name || m.materialName || m.material || '').toLowerCase();
    return (
      category.includes("steel") ||
      category.includes("iron") ||
      category.includes("ferrous") ||
      name.includes("steel") ||
      name.includes("iron")
    );
  };

  const nonFerrousFilter = (m: any) => {
    const category = (m.category || m.type || m.materialType || '').toLowerCase();
    const name = (m.name || m.materialName || m.material || '').toLowerCase();
    return (
      category.includes("aluminum") ||
      category.includes("copper") ||
      category.includes("brass") ||
      category.includes("bronze") ||
      category.includes("titanium") ||
      category.includes("non-ferrous") ||
      name.includes("aluminum") ||
      name.includes("copper") ||
      name.includes("brass") ||
      name.includes("bronze") ||
      name.includes("titanium")
    );
  };

  const plasticsFilter = (m: any) => {
    const category = (m.category || m.type || m.materialType || '').toLowerCase();
    const name = (m.name || m.materialName || m.material || '').toLowerCase();
    return (
      category.includes("plastic") ||
      category.includes("polymer") ||
      category.includes("thermoplastic") ||
      category.includes("abs") ||
      category.includes("polypropylene") ||
      category.includes("polyethylene") ||
      category.includes("pvc") ||
      name.includes("plastic") ||
      name.includes("polymer") ||
      name.includes("abs") ||
      name.includes("pp") ||
      name.includes("pe") ||
      name.includes("pvc") ||
      name.includes("pa") ||
      name.includes("pc") ||
      name.includes("pmma") ||
      name.includes("polypropylene") ||
      name.includes("polyethylene")
    );
  };

  const rubberFilter = (m: any) => {
    const category = (m.category || m.type || m.materialType || '').toLowerCase();
    const name = (m.name || m.materialName || m.material || '').toLowerCase();
    return (
      category.includes("rubber") ||
      category.includes("elastomer") ||
      category.includes("silicone") ||
      category.includes("epdm") ||
      category.includes("nbr") ||
      category.includes("neoprene") ||
      name.includes("rubber") ||
      name.includes("elastomer") ||
      name.includes("silicone") ||
      name.includes("epdm") ||
      name.includes("nbr") ||
      name.includes("neoprene")
    );
  };

  const compositesFilter = (m: any) => {
    const category = (m.category || m.type || m.materialType || '').toLowerCase();
    const name = (m.name || m.materialName || m.material || '').toLowerCase();
    return (
      category.includes("composite") ||
      category.includes("fiber") ||
      category.includes("carbon") ||
      category.includes("glass fiber") ||
      category.includes("frp") ||
      name.includes("composite") ||
      name.includes("fiber") ||
      name.includes("carbon") ||
      name.includes("frp")
    );
  };

  return {
    Ferrous: new Set([
      // Important hardcoded ferrous materials
      "Steel", "Iron", "Stainless Steel", "Carbon Steel", "Alloy Steel", "Cast Iron",
      "SS304", "SS316", "SS201", "MS", "Mild Steel", "Tool Steel", "Spring Steel",
      "High Carbon Steel", "Low Carbon Steel", "Galvanized Steel", "Cold Rolled Steel",
      "Hot Rolled Steel", "Cast Iron", "Ductile Iron", "Gray Iron", "Wrought Iron",
      ...extractMaterials(rawMaterials, ferrousFilter),
    ]),
    "Non-Ferrous": new Set([
      // Important hardcoded non-ferrous materials  
      "Aluminum", "Copper", "Brass", "Bronze", "Titanium", "Magnesium", "Zinc",
      "Al6061", "Al7075", "Al2024", "Al5052", "Aluminum Alloy", "Aluminium",
      "Copper Alloy", "Brass C360", "Brass C260", "Bronze C932", "Phosphor Bronze",
      "Titanium Grade 2", "Titanium Grade 5", "Ti-6Al-4V", "Magnesium Alloy",
      "Zinc Alloy", "Lead", "Tin", "Nickel", "Inconel", "Monel", "Hastelloy",
      ...extractMaterials(rawMaterials, nonFerrousFilter),
    ]),
    Plastics: new Set([
      // Important hardcoded plastic materials
      "ABS", "PP", "PE", "PVC", "PA", "PC", "PMMA", "Plastic", "Polymer",
      "Polypropylene", "Polyethylene", "Polystyrene", "Nylon", "Thermoplastic",
      "PA6", "PA66", "POM", "PTFE", "PEEK", "PEI", "PSU", "PPO", "PPS",
      "HDPE", "LDPE", "LLDPE", "PP Copolymer", "PP Homopolymer", "ABS+PC",
      "PC+ABS", "TPU", "TPE", "EVA", "COC", "COP", "PLA", "PET", "PETG",
      "Acetal", "Delrin", "Teflon", "Ultem", "Radel", "Noryl", "Ryton",
      ...extractMaterials(rawMaterials, plasticsFilter),
    ]),
    Rubber: new Set([
      // Important hardcoded rubber materials
      "Rubber", "Elastomer", "Silicone", "EPDM", "NBR", "Neoprene",
      "Natural Rubber", "Synthetic Rubber", "SBR", "Butyl Rubber", "IIR",
      "FKM", "Viton", "Kalrez", "FFKM", "ACM", "AEM", "CSM", "ECO", "FVMQ",
      "Hypalon", "Polyurethane Rubber", "TPR", "TPV", "LSR", "HTV", "RTV",
      "Silicone 70 Shore A", "Silicone 60 Shore A", "Nitrile Rubber",
      "Chloroprene Rubber", "Fluorosilicone", "Perfluoroelastomer",
      ...extractMaterials(rawMaterials, rubberFilter),
    ]),
    Composites: new Set([
      // Important hardcoded composite materials
      "Carbon Fiber", "Glass Fiber", "Composite", "FRP", "CFRP", "GFRP",
      "Carbon Fiber Reinforced Plastic", "Glass Fiber Reinforced Plastic",
      "Aramid Fiber", "Kevlar", "Fiberglass", "SMC", "BMC", "GMT", "LFT",
      "Carbon Prepreg", "Glass Prepreg", "Hybrid Composite", "Natural Fiber Composite",
      ...extractMaterials(rawMaterials, compositesFilter),
    ]),
    Other: new Set([
      // Important hardcoded other materials
      "Other", "Unknown", "Wood", "Plywood", "MDF", "Particle Board", "Bamboo",
      "Cork", "Leather", "Fabric", "Canvas", "Vinyl", "Foam", "Ceramic",
      "Glass", "Quartz", "Sapphire", "Diamond", "Graphite", "Paper", "Cardboard",
      ...rawMaterials
        .filter((m) => 
          !ferrousFilter(m) &&
          !nonFerrousFilter(m) &&
          !plasticsFilter(m) &&
          !rubberFilter(m) &&
          !compositesFilter(m)
        )
        .map((m) => m.name || m.materialName || m.material || String(m))
        .filter(Boolean),
    ]),
  };
};

export const classifyMaterial = (
  material: string,
  categories: Record<MaterialCategory, Set<string>>
): MaterialCategory => {
  const matLower = material.toLowerCase();
  
  // Enhanced classification with better pattern matching
  const plasticPatterns = [
    'plastic', 'polymer', 'abs', 'pp', 'pe', 'pvc', 'pa', 'pc', 'pmma',
    'polypropylene', 'polyethylene', 'polystyrene', 'nylon', 'thermoplastic'
  ];
  
  const rubberPatterns = [
    'rubber', 'elastomer', 'silicone', 'epdm', 'nbr', 'neoprene',
    'natural rubber', 'synthetic rubber'
  ];
  
  // Check for plastics first with enhanced pattern matching
  if (plasticPatterns.some(pattern => matLower.includes(pattern))) {
    return "Plastics";
  }
  
  // Check for rubber with enhanced pattern matching
  if (rubberPatterns.some(pattern => matLower.includes(pattern))) {
    return "Rubber";
  }
  
  // Standard category checking
  for (const [cat, keywords] of Object.entries(categories) as [
    MaterialCategory,
    Set<string>
  ][]) {
    if (cat === "Other") continue;
    for (const kw of keywords) {
      if (matLower.includes(kw.toLowerCase())) return cat;
    }
  }
  
  return "Other";
};

// ─── Chart colour helper ──────────────────────────────────────────────────────
export const chartColor = (index: number): string =>
  `hsl(${220 + index * 40}, 70%, ${45 + index * 8}%)`;