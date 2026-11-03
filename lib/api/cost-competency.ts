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
 * Transform cost competency data from API format to component format
 */
export function transformCostAnalysisToComponentData(
  costAnalysis: CostCompetencyAnalysis[],
  vendors: Array<{ id: string; name: string }>
) {
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