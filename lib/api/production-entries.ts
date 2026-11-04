/**
 * API functions for production entries
 */

import { apiClient } from './client';

export interface ProductionEntry {
  id: string;
  lot_id: string;
  production_process_id?: string;
  production_process?: {
    process_name: string;
  };
  entry_date: string;
  shift?: 'MORNING' | 'AFTERNOON' | 'NIGHT';
  planned_quantity?: number;
  actual_quantity: number;
  rejected_quantity?: number;
  rework_quantity?: number;
  downtime_hours?: number;
  downtime_reason?: string;
  issues_encountered?: string;
  remarks?: string;
  entered_by?: string;
  created_at: string;
  updated_at: string;
  // Legacy or alternative fields for compatibility
  date?: string;
  quantity?: number;
  unit?: string;
  status?: string;
  operator_id?: string;
  operator_name?: string;
  notes?: string;
}

export interface CreateProductionEntryRequest {
  lot_id: string;
  productionLotId: string;
  productionProcessId?: string;
  entryDate: string;
  entryType: 'daily' | 'weekly' | 'shift';
  plannedQuantity?: number;
  actualQuantity: number;
  rejectedQuantity?: number;
  reworkQuantity?: number;
  downtimeHours?: number;
  downtimeReason?: string;
  shift?: string;
  operatorsCount?: number;
  supervisor?: string;
  remarks?: string;
  issuesEncountered?: string;
}

export interface UpdateProductionEntryRequest {
  processName?: string;
  entryDate?: string;
  shift?: 'MORNING' | 'AFTERNOON' | 'NIGHT';
  targetQuantity?: number;
  producedQuantity?: number;
  rejectedQuantity?: number;
  reworkQuantity?: number;
  downtimeMinutes?: number;
  downtimeReason?: string;
  qualityIssues?: string;
  operatorNotes?: string;
}

export const productionEntriesApi = {
  /**
   * Get production entries for a lot
   */
  getEntriesByLot: async (lotId: string): Promise<ProductionEntry[]> => {
    return apiClient.get(`/production-lots/${lotId}/production-entries`);
  },

  /**
   * Get production entries for a process
   */
  getEntriesByProcess: async (processId: string): Promise<ProductionEntry[]> => {
    return apiClient.get(`/production-processes/${processId}/production-entries`);
  },

  /**
   * Create a new production entry
   */
  createEntry: async (data: CreateProductionEntryRequest & { lot_id: string }): Promise<ProductionEntry> => {
    const { lot_id, ...entryData } = data;
    return apiClient.post(`/production-lots/${lot_id}/production-entries`, entryData);
  },

  /**
   * Update a production entry
   */
  updateEntry: async (entryId: string, data: UpdateProductionEntryRequest): Promise<ProductionEntry> => {
    return apiClient.put(`/production-entries/${entryId}`, data);
  },

  /**
   * Delete a production entry
   */
  deleteEntry: async (entryId: string): Promise<void> => {
    return apiClient.delete(`/production-entries/${entryId}`);
  },

  /**
   * Get entry by ID
   */
  getEntryById: async (entryId: string): Promise<ProductionEntry> => {
    return apiClient.get(`/production-entries/${entryId}`);
  },

  /**
   * Get weekly production summary
   */
  getWeeklySummary: async (lotId: string): Promise<{
    week: string;
    totalPlanned: number;
    totalActual: number;
    totalRejected: number;
    totalRework: number;
    efficiency: number;
    dailyBreakdown: Array<{
      date: string;
      planned: number;
      actual: number;
      rejected: number;
      rework: number;
      efficiency: number;
    }>;
  }[]> => {
    return apiClient.get(`/production-entries/weekly-summary/${lotId}`);
  }
};