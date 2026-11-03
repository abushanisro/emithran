/**
 * Supplier Evaluation API
 * Handles vendor evaluation for specific parts/projects
 */

import { apiClient } from './client';

// ============================================================================
// TYPES
// ============================================================================

export type EvaluationStatus = 'draft' | 'in_progress' | 'completed' | 'approved' | 'archived';

export type RecommendationStatus = 'recommended' | 'conditional' | 'not_recommended' | 'pending';

export type SupplierEvaluation = {
  id: string;
  userId: string;
  vendorId: string;
  vendorName: string;
  projectId?: string;
  bomItemId?: string;
  processId: string; // REQUIRED: Manufacturing process context
  processName: string;

  // Technical scores (0-100 each)
  materialAvailabilityScore: number;
  equipmentCapabilityScore: number;
  processFeasibilityScore: number;
  qualityCertificationScore: number;
  financialStabilityScore: number;
  capacityScore: number;
  leadTimeScore: number;

  // Calculated technical scores
  technicalTotalScore: number;
  technicalMaxScore: number;
  technicalPercentage: number;

  // Cost & vendor rating
  quotedCost?: number;
  marketAverageCost?: number;
  costCompetitivenessScore?: number;
  vendorRatingScore?: number;
  overallWeightedScore?: number;

  // Status
  status: EvaluationStatus;
  evaluationRound: number;
  evaluatorNotes?: string;
  recommendationStatus?: RecommendationStatus;

  // Metadata
  isFrozen: boolean;
  approvedAt?: string;
  approvedBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateSupplierEvaluationData = {
  vendorId: string;
  projectId?: string;
  bomItemId?: string;
  processId: string; // REQUIRED: Process context
  materialAvailabilityScore?: number;
  equipmentCapabilityScore?: number;
  processFeasibilityScore?: number;
  qualityCertificationScore?: number;
  financialStabilityScore?: number;
  capacityScore?: number;
  leadTimeScore?: number;
  quotedCost?: number;
  marketAverageCost?: number;
  costCompetitivenessScore?: number;
  vendorRatingScore?: number;
  evaluationRound?: number;
  evaluatorNotes?: string;
  recommendationStatus?: RecommendationStatus;
};

export type UpdateSupplierEvaluationData = {
  materialAvailabilityScore?: number;
  equipmentCapabilityScore?: number;
  processFeasibilityScore?: number;
  qualityCertificationScore?: number;
  financialStabilityScore?: number;
  capacityScore?: number;
  leadTimeScore?: number;
  quotedCost?: number;
  marketAverageCost?: number;
  costCompetitivenessScore?: number;
  vendorRatingScore?: number;
  evaluatorNotes?: string;
  recommendationStatus?: RecommendationStatus;
};

export type SupplierEvaluationQuery = {
  vendorId?: string;
  projectId?: string;
  bomItemId?: string;
  processId?: string;
  status?: EvaluationStatus;
  recommendationStatus?: RecommendationStatus;
  isFrozen?: boolean;
  evaluationRound?: number;
};

/**
 * Get all supplier evaluations with optional filtering
 */
export async function getSupplierEvaluations(
  query?: SupplierEvaluationQuery
): Promise<SupplierEvaluation[]> {
  const response = await apiClient.get<SupplierEvaluation[]>(
    '/supplier-evaluations',
    { ...(query !== undefined ? { params: query } : {}) }
  );
  return response || [];
}

// ============================================================================
// VENDOR PROCESS CAPABILITIES (Industry-standard)
// ============================================================================

export type VendorCapability = {
  vendor_id: string;
  vendor_name: string;
  vendor_code: string;
  equipment_available: string[];
  capacity_per_month: number;
  lead_time_days: number;
  certifications: string[];
};
