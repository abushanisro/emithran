import type { BOMItem } from "@/lib/api/hooks/useBOMItems";

// ─── Extended BOM Item ────────────────────────────────────────────────────────
export type EnrichedBOMItem = BOMItem & {
  manufacturingProcess?: string;
  supplierId?: string;
  vendor?: string;
  supplier?: string;
  process?: string;
  toleranceGrade?: string;
  surfaceFinish?: string;
  heatTreatment?: string;
  maxLength?: number;
  maxWidth?: number;
  maxHeight?: number;
  length?: number;
  width?: number;
  description?: string;
  materialGrade?: string;
};

export type HighCostPart = EnrichedBOMItem & {
  totalCost: number;
  bomName: string;
};

// ─── Domain interfaces ────────────────────────────────────────────────────────
export interface SelectedProject {
  id: string;
  name: string;
  targetPrice: number;
  updatedAt: string;
}

export interface SelectedBOM {
  id: string;
  name: string;
  version: string;
  status: string;
}

export interface ProductMetrics {
  totalParts: number;
  totalWeight: number;
  totalCost: number;
  supplierCount: number;
  makeVsBuy: { make: number; buy: number };
  materialBreakdown: Array<{
    material: string;
    count: number;
    weight: number;
    cost: number;
  }>;
  complexityMetrics: {
    assemblyParts: number;
    subAssemblyParts: number;
    childParts: number;
  };
}

export interface BOMMetricEntry {
  bom: SelectedBOM;
  metrics: ProductMetrics;
  items: EnrichedBOMItem[] | undefined;
}

export type MaterialCategory =
  | "Ferrous"
  | "Non-Ferrous"
  | "Plastics"
  | "Rubber"
  | "Composites"
  | "Other";

export type BenchmarkStep = "project-selection" | "bom-selection" | "comparison";