import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../client';

export interface CostDriver {
  label: string;
  category: 'process' | 'raw_material' | 'tooling' | 'procured_part' | 'packaging';
  costPerPart: number;
  pctOfMfgCost: number;
}

export interface ProcessLine {
  opNbr: number;
  operation: string | null;
  processGroup: string | null;
  processRoute: string | null;
  machineRate: number;
  laborRate: number;
  cycleTimeSec: number;
  setupTimeMin: number;
  batchSize: number;
  heads: number;
  setupManning: number;
  partsPerCycle: number;
  scrap: number;
  setupCostPerPart: number;
  cycleCostPerPart: number;
  totalCostPerPart: number;
  featureType: string | null;
}

export interface MaterialLine {
  materialName: string;
  materialDescription: string | null;
  unitCost: number;
  netUsage: number;
  grossUsage: number;
  scrap: number;
  overhead: number;
  totalCost: number;
}

export interface CostConfidence {
  material: 'high' | 'medium' | 'low';
  processRouting: 'high' | 'medium' | 'low';
  cycleTime: 'high' | 'medium' | 'low';
  supplierCost: 'high' | 'medium' | 'low';
  overall: number;
  label: string;
}

export interface BomItemCostAnalysis {
  bomItemId: string;
  rawMaterialCost: number;
  processCost: number;
  toolingCost: number;
  packagingCost: number;
  procuredPartCost: number;
  manufacturingCost: number;
  sgaCost: number;
  profitCost: number;
  sellingPrice: number;
  costDrivers: CostDriver[];
  confidence: CostConfidence;
  processLines: ProcessLine[];
  materialLines: MaterialLine[];
}

export function useBomItemCostAnalysis(bomItemId?: string) {
  return useQuery<BomItemCostAnalysis>({
    queryKey: ['cost-analysis', 'bom-item', bomItemId],
    queryFn: async () => {
      const result = await apiClient.get<BomItemCostAnalysis>(`/cost-analysis/bom-item/${bomItemId}`);
      return result;
    },
    enabled: !!bomItemId,
    staleTime: 30_000,
  });
}
