/**
 * API functions for production planning date updates
 * Updates existing main processes with schedule dates
 */

import { apiClient } from './client';

export interface ProcessScheduleUpdate {
  planned_start_date: string;
  planned_end_date: string;
  assigned_department?: string;
  responsible_person?: string;
}

export const productionPlanningApi = {
  /**
   * Update schedule dates for an existing production process
   * This updates the main process (Raw Material, Process Conversion, etc.)
   */
  updateProcessScheduleDates: async (
    processId: string,
    scheduleData: ProcessScheduleUpdate
  ) => {
    return apiClient.put(
      `/production-planning/processes/${processId}/schedule-dates`,
      scheduleData
    );
  },

  /**
   * Update production lot dates - for main planned task dates
   */
  updateProductionLotDates: async (
    lotId: string,
    dateData: {
      plannedStartDate?: string;
      plannedEndDate?: string;
    }
  ) => {
    return apiClient.put(
      `/production-planning/lots/${lotId}`,
      dateData,
      {
        timeout: 20000, // Longer timeout for date updates
      }
    );
  },

  /**
   * Get all processes for a production lot
   */
getProcessesByLot: async (lotId: string, _useCache: boolean = true) => {
    return apiClient.get(
      `/production-planning/processes/lot/${lotId}`
    );
  },

  /**
   * Get production lot by ID - includes main lot dates
   */
  getProductionLotById: async (lotId: string, _useCache: boolean = true) => {
    return apiClient.get(
      `/production-planning/lots/${lotId}`
    );
  },

  /**
   * Prefetch related data for better UX
   */
  prefetchLotData: async (lotId: string) => {
    // Fire and forget - prefetch commonly accessed data
    Promise.all([
      productionPlanningApi.getProductionLotById(lotId),
      productionPlanningApi.getProcessesByLot(lotId),
    ]).catch(() => {

    });
  },

  /**
   * Batch update multiple lot dates (for bulk operations)
   */
  batchUpdateLotDates: async (
    updates: Array<{
      lotId: string;
      dateData: {
        plannedStartDate?: string;
        plannedEndDate?: string;
      };
    }>
  ) => {
    // Execute updates with limited concurrency to avoid overwhelming the server
    const BATCH_SIZE = 3;
    const results = [];

    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map(update =>
        productionPlanningApi.updateProductionLotDates(update.lotId, update.dateData)
      );

      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults);

      // Small delay between batches to respect rate limits
      if (i + BATCH_SIZE < updates.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  },

  /**
   * Clear all production planning related cache
   */
  clearCache: () => {
    // No-op: handled by React Query
  },

  /**
   * Get cache statistics for debugging
   */
  getCacheStats: () => {
    return { size: 0, keys: [] };
  },

  /**
   * Get process templates for production planning
   */
  getProcessTemplates: async (_useCache: boolean = true) => {
    return apiClient.get(
      `/production-planning/process-templates`
    );
  },

  /**
   * Create a custom process template
   */
  createProcessTemplate: async (templateData: {
    name: string;
    description?: string;
    category?: string;
  }) => {
    return apiClient.post(
      `/production-planning/process-templates`,
      templateData
    );
  },

  /**
   * Update production lot status
   */
  updateLotStatus: async (lotId: string, status: string) => {
    return apiClient.put(
      `/production-planning/lots/${lotId}`,
      { status }
    );
  },

  /**
   * Auto-update lot status based on progress
   */
  updateLotStatusByProgress: async (lotId: string) => {
    return apiClient.post(
      `/production-planning/lots/${lotId}/update-status-by-progress`,
      {}
    );
  },

  /**
   * Clean up production lot materials to only show selected BOM items
   */
  cleanupLotMaterials: async (lotId: string) => {
    return apiClient.post(
      `/production-planning/lots/${lotId}/cleanup-materials`,
      {}
    );
  },
};

/**
 * Helper function to format dates for API
 */
export const formatDateForAPI = (date: Date): string => {
  return date.toISOString();
};

/**
 * Helper function to update multiple processes with dates
 * Use this when user selects dates in the UI
 */
export const updateProcessesWithDates = async (
  processes: Array<{
    id: string;
    startDate: Date;
    endDate: Date;
    department?: string;
    responsiblePerson?: string;
  }>
) => {
  const results = [];

  for (const process of processes) {
    try {
      const result = await productionPlanningApi.updateProcessScheduleDates(
        process.id,
        {
          planned_start_date: formatDateForAPI(process.startDate),
          planned_end_date: formatDateForAPI(process.endDate),
          ...(process.department !== undefined ? { assigned_department: process.department } : {}),
          ...(process.responsiblePerson !== undefined ? { responsible_person: process.responsiblePerson } : {}),
        }
      );
      results.push(result);
    } catch (error) {
      console.error(`Failed to update process ${process.id}:`, error);
      throw error;
    }
  }

  return results;
};