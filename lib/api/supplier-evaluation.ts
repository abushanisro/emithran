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

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Create a new supplier evaluation
 */
export async function createSupplierEvaluation(
  data: CreateSupplierEvaluationData
): Promise<SupplierEvaluation> {
  const response = await apiClient.post<SupplierEvaluation>(
    '/supplier-evaluations',
    data
  );
  return response;
}

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

/**
 * Get supplier evaluation by ID
 */
export async function getSupplierEvaluation(id: string): Promise<SupplierEvaluation> {
  const response = await apiClient.get<SupplierEvaluation>(
    `/supplier-evaluations/${id}`
  );
  return response;
}

/**
 * Update supplier evaluation (only if not frozen)
 */
export async function updateSupplierEvaluation(
  id: string,
  data: UpdateSupplierEvaluationData
): Promise<SupplierEvaluation> {
  const response = await apiClient.put<SupplierEvaluation>(
    `/supplier-evaluations/${id}`,
    data
  );
  return response;
}

/**
 * Delete supplier evaluation (only if not frozen)
 */
export async function deleteSupplierEvaluation(id: string): Promise<void> {
  await apiClient.delete(`/supplier-evaluations/${id}`);
}

/**
 * Mark evaluation as completed
 */
export async function completeSupplierEvaluation(id: string): Promise<SupplierEvaluation> {
  const response = await apiClient.post<SupplierEvaluation>(
    `/supplier-evaluations/${id}/complete`
  );
  return response;
}

/**
 * Approve and freeze evaluation (creates immutable snapshot)
 */
export async function approveSupplierEvaluation(id: string): Promise<{ snapshotId: string }> {
  const response = await apiClient.post<{ snapshotId: string }>(
    `/supplier-evaluations/${id}/approve`
  );
  return response;
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

/**
 * Get vendors capable of performing a specific process
 * Industry-standard: Evaluation = BOM × Vendor × Process
 */
export async function getVendorsByProcess(processId: string): Promise<VendorCapability[]> {
  const response = await apiClient.get<VendorCapability[]>(
    `/processes/vendors-by-process/${processId}`
  );
  return response || [];
}

/**
 * Get processes that a vendor can perform
 */
export async function getProcessesByVendor(vendorId: string): Promise<any[]> {
  const response = await apiClient.get<any[]>(`/processes/by-vendor/${vendorId}`);
  return response || [];
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate technical percentage from evaluation
 */
export function calculateTechnicalPercentage(evaluation: SupplierEvaluation): number {
  if (!evaluation.technicalMaxScore) return 0;
  return (evaluation.technicalTotalScore / evaluation.technicalMaxScore) * 100;
}

/**
 * Get color based on score percentage
 */
export function getScoreColor(percentage: number): string {
  if (percentage >= 80) return 'green';
  if (percentage >= 60) return 'blue';
  if (percentage >= 40) return 'orange';
  return 'red';
}

/**
 * Format evaluation for comparison
 */
export function formatEvaluationForComparison(evaluation: SupplierEvaluation) {
  return {
    id: evaluation.id,
    vendorId: evaluation.vendorId,
    technicalScore: evaluation.technicalTotalScore,
    technicalPercentage: evaluation.technicalPercentage,
    costScore: evaluation.costCompetitivenessScore || 0,
    vendorRating: evaluation.vendorRatingScore || 0,
    overallScore: evaluation.overallWeightedScore || 0,
    recommendationStatus: evaluation.recommendationStatus,
    isFrozen: evaluation.isFrozen,
  };
}
