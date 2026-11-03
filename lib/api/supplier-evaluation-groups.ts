/**
 * Supplier Evaluation Groups API
 * Manages BOM + Process selections for vendor evaluation
 */

import { apiClient } from './client';

// ============================================================================
// TYPES
// ============================================================================

export type BomItemForEvaluation = {
  id: string;
  bomId?: string;
  name: string;
  partNumber?: string;
  material?: string;
  quantity: number;
};

export type ProcessForEvaluation = {
  id: string;
  name: string;
  processGroup: string;
  type: 'manufacturing' | 'service';
  isPredefined: boolean;
};

export type SupplierEvaluationGroup = {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  notes?: string;
  status: 'draft' | 'active' | 'completed' | 'archived';
  createdAt: string;
  updatedAt: string;
  bomItems: BomItemForEvaluation[];
  processes: ProcessForEvaluation[];
};

export type SupplierEvaluationGroupSummary = {
  id: string;
  projectId: string;
  projectName?: string;
  name: string;
  description?: string;
  notes?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  bomItemsCount: number;
  processesCount: number;
};

export type CreateSupplierEvaluationGroupData = {
  projectId: string;
  name: string;
  description?: string;
  notes?: string;
  bomItems: BomItemForEvaluation[];
  processes: ProcessForEvaluation[];
};

export type UpdateSupplierEvaluationGroupData = {
  name?: string;
  description?: string;
  notes?: string;
  status?: 'draft' | 'active' | 'completed' | 'archived';
  bomItems?: BomItemForEvaluation[];
  processes?: ProcessForEvaluation[];
};

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Create a new supplier evaluation group
 */
export async function createSupplierEvaluationGroup(
  data: CreateSupplierEvaluationGroupData
): Promise<SupplierEvaluationGroup> {
  const response = await apiClient.post<SupplierEvaluationGroup>(
    '/supplier-evaluation-groups',
    data
  );
  return response;
}

/**
 * Get all supplier evaluation groups for current user
 */
export async function getAllSupplierEvaluationGroups(): Promise<SupplierEvaluationGroupSummary[]> {
  const response = await apiClient.get<SupplierEvaluationGroupSummary[]>(
    '/supplier-evaluation-groups'
  );
  return response || [];
}

/**
 * Get all supplier evaluation groups for a project
 */
export async function getSupplierEvaluationGroupsByProject(
  projectId: string
): Promise<SupplierEvaluationGroupSummary[]> {
  const response = await apiClient.get<SupplierEvaluationGroupSummary[]>(
    `/supplier-evaluation-groups/project/${projectId}`
  );
  return response || [];
}

/**
 * Get supplier evaluation group by ID
 */
export async function getSupplierEvaluationGroup(
  groupId: string
): Promise<SupplierEvaluationGroup> {
  const response = await apiClient.get<SupplierEvaluationGroup>(
    `/supplier-evaluation-groups/${groupId}`
  );
  return response;
}

/**
 * Update supplier evaluation group
 */
export async function updateSupplierEvaluationGroup(
  groupId: string,
  data: UpdateSupplierEvaluationGroupData
): Promise<SupplierEvaluationGroup> {
  const response = await apiClient.patch<SupplierEvaluationGroup>(
    `/supplier-evaluation-groups/${groupId}`,
    data
  );
  return response;
}

/**
 * Validate if supplier evaluation group can be deleted
 */
export async function validateSupplierEvaluationGroupDeletion(groupId: string): Promise<{
  canDelete: boolean;
  warnings: string[];
  blockers: string[];
  impactSummary: Array<{ label: string; count: number }>;
}> {
  const response = await apiClient.get(`/supplier-evaluation-groups/${groupId}/deletion-check`);
  return response;
}

/**
 * Delete supplier evaluation group
 */
export async function deleteSupplierEvaluationGroup(groupId: string): Promise<void> {
  await apiClient.delete(`/supplier-evaluation-groups/${groupId}`);
}