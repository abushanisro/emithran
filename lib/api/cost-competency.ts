import { apiClient } from './client';

export interface CostCompetencyAnalysis {
  id: string;
  nominationEvaluationId: string;
  costComponent: string;
  baseValue?: number;
  basePaymentTerm?: string;
  unit?: string;
  isRanking: boolean;
  sortOrder: number;
  vendorValues: CostVendorValue[];
}

export interface CostVendorValue {
  id: string;
  vendorId: string;
  numericValue?: number;
  textValue?: string;
}

export interface CostComponentUpdate {
  costComponent: string;
  baseValue?: number;
  basePaymentTerm?: string;
  vendorValues: VendorValueUpdate[];
}

export interface VendorValueUpdate {
  vendorId: string;
  numericValue?: number;
  textValue?: string;
}

export interface BulkUpdateCostData {
  components: CostComponentUpdate[];
}

export interface UpdateCostValue {
  baseValue?: number;
  basePaymentTerm?: string;
  numericValue?: number;
  textValue?: string;
}

/**
 * Get cost competency analysis data for a nomination
 */
export async function getCostAnalysis(nominationId: string): Promise<CostCompetencyAnalysis[]> {
  const response = await apiClient.get(`/supplier-nominations/${nominationId}/cost-analysis`);
  return Array.isArray(response) ? response : [];
}

/**
 * Initialize cost competency analysis data for a nomination
 */
export async function initializeCostAnalysis(nominationId: string): Promise<void> {
  await apiClient.post(`/supplier-nominations/${nominationId}/cost-analysis/init`);
}

/**
 * Bulk update cost competency analysis data
 */
export async function updateCostAnalysis(
  nominationId: string,
  data: BulkUpdateCostData
): Promise<CostCompetencyAnalysis[]> {
  const response = await apiClient.put(`/supplier-nominations/${nominationId}/cost-analysis`, data);
  return Array.isArray(response) ? response : [];
}

/**
 * Batch update cost competency analysis data - ENTERPRISE BEST PRACTICE
 */
export async function batchUpdateCostAnalysis(
  nominationId: string,
  data: BulkUpdateCostData
): Promise<CostCompetencyAnalysis[]> {
  try {
    // Try batch endpoint first - send components array directly
    const response = await apiClient.put(`/supplier-nominations/${nominationId}/cost-analysis/batch`, data.components);
    return Array.isArray(response) ? response : [];
  } catch (error) {

// Fallback to regular bulk update if batch fails
    // This ensures compatibility during API rollout
    return await updateCostAnalysis(nominationId, data);
  }
}

/**
 * Update specific cost component
 */
export async function updateCostComponent(
  nominationId: string,
  costComponent: string,
  data: UpdateCostValue
): Promise<void> {
  await apiClient.put(`/supplier-nominations/${nominationId}/cost-analysis/${encodeURIComponent(costComponent)}`, data);
}

/**
 * Update vendor-specific cost value
 */
export async function updateVendorCostValue(
  nominationId: string,
  costComponent: string,
  vendorId: string,
  data: { numericValue?: number; textValue?: string }
): Promise<void> {
  await apiClient.put(`/supplier-nominations/${nominationId}/cost-analysis/${encodeURIComponent(costComponent)}/vendor/${vendorId}`, data);
}

/**
 * Auto-save with debouncing utility
 */
let autoSaveTimeout: NodeJS.Timeout | null = null;

export function autoSaveCostData(
  nominationId: string,
  costComponent: string,
  data: UpdateCostValue,
  delay: number = 1000
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Clear previous timeout
    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
    }

    // Set new timeout for debounced save
    autoSaveTimeout = setTimeout(async () => {
      try {
        await updateCostComponent(nominationId, costComponent, data);
        resolve();
      } catch (error) {
        reject(error);
      }
    }, delay);
  });
}

/**
 * Transform cost competency data from API format to component format
 */
export function transformCostAnalysisToComponentData(
  costAnalysis: CostCompetencyAnalysis[],
  vendors: Array<{ id: string; name: string }>
) {
  const _vendorMap = new Map(vendors.map(v => [v.id, v]));
  
  return costAnalysis.map(analysis => {
    const supplierValues: number[] = [];
    const paymentTerms: string[] = [];
    
    // Sort vendor values by vendor order
    vendors.forEach(vendor => {
      const vendorValue = analysis.vendorValues.find(vv => vv.vendorId === vendor.id);
      
      if (analysis.costComponent === 'Payment Terms') {
        paymentTerms.push(vendorValue?.textValue || '');
      } else {
        supplierValues.push(vendorValue?.numericValue || 0);
      }
    });

    return {
      id: parseInt(analysis.id.slice(-3), 16) || analysis.sortOrder, // Convert UUID to number for compatibility
      costComponent: analysis.costComponent,
      baseValue: analysis.baseValue || 0,
      basePaymentTerm: analysis.basePaymentTerm,
      supplierValues,
      paymentTerms: analysis.costComponent === 'Payment Terms' ? paymentTerms : undefined,
      isRanking: analysis.isRanking,
      unit: analysis.unit
    };
  });
}

/**
 * Transform component data back to API format for bulk update
 */
export function transformComponentDataToCostAnalysis(
  costData: any[],
  vendors: Array<{ id: string; name: string }>
): BulkUpdateCostData {
  const components: CostComponentUpdate[] = costData.map(row => {
    const vendorValues: VendorValueUpdate[] = vendors.map((vendor, index) => ({
      vendorId: vendor.id,
      numericValue: row.paymentTerms ? undefined : (row.supplierValues[index] || 0),
      textValue: row.paymentTerms ? (row.paymentTerms[index] || '') : undefined
    }));

    return {
      costComponent: row.costComponent,
      baseValue: row.baseValue,
      basePaymentTerm: row.basePaymentTerm,
      vendorValues
    };
  });

  return { components };
}