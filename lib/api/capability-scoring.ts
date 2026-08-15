import { apiClient } from './client';

export interface CapabilityCriteria {
  id: string;
  criteriaId: string;
  criteriaName: string;
  maxScore: number;
  sortOrder: number;
  vendorScores: Record<string, number>;
}

/**
 * Get capability scoring data for a nomination
 */
export async function getCapabilityScores(nominationId: string): Promise<CapabilityCriteria[]> {
  const response = await apiClient.get(`/supplier-nominations/${nominationId}/capability-scores`);
  return Array.isArray(response) ? response : [];
}

/**
 * Initialize capability scoring criteria for a nomination
 */
export async function initializeCapabilityScores(nominationId: string): Promise<void> {
  await apiClient.post(`/supplier-nominations/${nominationId}/capability-scores/init`);
}

/**
 * Update capability score for specific vendor and criteria
 */
export async function updateCapabilityScore(
  nominationId: string,
  criteriaId: string,
  vendorId: string,
  score: number
): Promise<void> {
  await apiClient.put(`/supplier-nominations/${nominationId}/capability-scores/${criteriaId}/vendor/${vendorId}`, {
    score
  });
}

/**
 * Batch update capability scores - ENTERPRISE BEST PRACTICE
 */
export interface BatchCapabilityUpdate {
  criteriaId: string;
  vendorId: string;
  score: number;
}

export async function batchUpdateCapabilityScores(
  nominationId: string,
  updates: BatchCapabilityUpdate[]
): Promise<void> {
  try {
    // Try batch endpoint first (preferred)
    await apiClient.put(`/supplier-nominations/${nominationId}/capability-scores/batch`, {
      updates
    });
  } catch (error) {

// Fallback to individual requests if batch fails
    // This ensures compatibility during API rollout
    const updatePromises = updates.map(update =>
      updateCapabilityScore(nominationId, update.criteriaId, update.vendorId, update.score)
    );
    
    await Promise.all(updatePromises);
  }
}

/**
 * Transform capability data from API format to component format
 */
export function transformCapabilityDataToTable(
  capabilityData: any[],
  vendors: Array<{ id: string; name: string }>
) {
  if (!capabilityData || !Array.isArray(capabilityData) || capabilityData.length === 0) {
    return {
      suppliers: vendors.map(vendor => vendor.name),
      criteria: []
    };
  }

  return {
    suppliers: vendors.map(vendor => vendor.name),
    criteria: capabilityData.map((criteria, index) => {
      const criteriaId = criteria.criteria_id || criteria.id || criteria.criteriaId || `criteria_${index}`;
      const criteriaName = criteria.criteria_name || criteria.name || criteria.criteriaName || `Criteria ${index + 1}`;
      const maxScore = criteria.max_score || criteria.maxScore || criteria.score || 100;
      const vendorScores = criteria.vendor_scores || criteria.vendorScores || criteria.scores || {};
      
      return {
        id: criteriaId,
        name: criteriaName,
        maxScore: maxScore,
        scores: vendors.map(vendor => {
          return vendorScores?.[vendor.id] || 0;
        })
      };
    })
  };
}