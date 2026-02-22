import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

// Types
export interface ProductionLot {
  id: string;
  bomId: string;
  lotNumber: string;
  productionQuantity: number;
  status: 'planned' | 'materials_ordered' | 'in_production' | 'completed' | 'cancelled' | 'on_hold';
  plannedStartDate: string;
  plannedEndDate: string;
  actualStartDate?: string;
  actualEndDate?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  lotType: 'standard' | 'prototype' | 'rework' | 'urgent';
  totalMaterialCost: number;
  totalProcessCost: number;
  totalEstimatedCost: number;
  remarks?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  bom?: {
    id: string;
    name: string;
    version: string;
  };
  vendorAssignments?: VendorAssignment[];
  processes?: ProductionProcess[];
}

export interface VendorAssignment {
  id: string;
  productionLotId: string;
  bomItemId: string;
  vendorId: string;
  requiredQuantity: number;
  unitCost: number;
  totalCost: number;
  deliveryStatus: 'pending' | 'ordered' | 'confirmed' | 'shipped' | 'delivered' | 'delayed';
  expectedDeliveryDate?: string;
  actualDeliveryDate?: string;
  qualityStatus: 'pending' | 'inspected' | 'approved' | 'rejected' | 'rework_required';
  remarks?: string;
  bomItem?: {
    id: string;
    partNumber: string;
    description: string;
  };
  vendor?: {
    id: string;
    companyName: string;
    contactEmail: string;
  };
}

export interface ProductionProcess {
  id: string;
  productionLotId: string;
  processId: string;
  processSequence: number;
  processName: string;
  description?: string;
  plannedStartDate: string;
  plannedEndDate: string;
  actualStartDate?: string;
  actualEndDate?: string;
  assignedDepartment?: string;
  responsiblePerson?: string;
  status: 'pending' | 'ready' | 'in_progress' | 'completed' | 'on_hold' | 'cancelled';
  completionPercentage: number;
  qualityCheckRequired: boolean;
  qualityStatus: 'pending' | 'in_progress' | 'passed' | 'failed' | 'rework_required';
  remarks?: string;
  subtasks?: ProcessSubtask[];
}

export interface ProcessSubtask {
  id: string;
  productionProcessId: string;
  taskName: string;
  description?: string;
  taskSequence: number;
  estimatedDurationHours: number;
  actualDurationHours?: number;
  assignedOperator?: string;
  skillRequirement?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed';
  qualityCheckRequired: boolean;
  qualityCheckPassed?: boolean;
  startedAt?: string;
  completedAt?: string;
  remarks?: string;
}

export interface DailyProductionEntry {
  id: string;
  productionLotId: string;
  productionProcessId?: string;
  entryDate: string;
  entryType: 'daily' | 'weekly' | 'shift';
  plannedQuantity: number;
  actualQuantity: number;
  rejectedQuantity: number;
  reworkQuantity: number;
  efficiencyPercentage: number;
  downtimeHours: number;
  downtimeReason?: string;
  shift?: string;
  operatorsCount: number;
  supervisor?: string;
  remarks?: string;
  issuesEncountered?: string;
  enteredBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionSummary {
  totalPlannedQuantity: number;
  totalActualQuantity: number;
  totalRejectedQuantity: number;
  totalReworkQuantity: number;
  overallEfficiency: number;
  totalDowntime: number;
  activeProcesses: number;
  completedProcesses: number;
  dailyProduction: {
    date: string;
    plannedQuantity: number;
    actualQuantity: number;
    efficiency: number;
  }[];
  qualityMetrics: {
    acceptanceRate: number;
    rejectionRate: number;
    reworkRate: number;
    firstPassYield: number;
  };
}

// API functions
export const productionPlanningApi = {
  // Production Lots
  getProductionLots: (filters?: { status?: string; bomId?: string; priority?: string }) =>
    apiClient.get('/production-planning/lots', { params: filters }),

  getProductionLotById: (id: string) =>
    apiClient.get(`/production-planning/lots/${id}`),

  createProductionLot: (data: any) =>
    apiClient.post('/production-planning/lots', data),

  updateProductionLot: (id: string, data: any) =>
    apiClient.put(`/production-planning/lots/${id}`, data),

  deleteProductionLot: (id: string) =>
    apiClient.delete(`/production-planning/lots/${id}`),

  // Vendor Assignments
  getVendorAssignments: (lotId: string) =>
    apiClient.get(`/production-planning/lots/${lotId}/vendor-assignments`),

  createVendorAssignment: (lotId: string, data: any) =>
    apiClient.post(`/production-planning/lots/${lotId}/vendor-assignments`, data),

  bulkCreateVendorAssignments: (lotId: string, data: any) =>
    apiClient.post(`/production-planning/lots/${lotId}/vendor-assignments/bulk`, data),

  updateVendorAssignment: (id: string, data: any) =>
    apiClient.put(`/production-planning/vendor-assignments/${id}`, data),

  deleteVendorAssignment: (id: string) =>
    apiClient.delete(`/production-planning/vendor-assignments/${id}`),

  // Production Processes
  getProductionProcesses: (lotId: string, filters?: { status?: string }) =>
    apiClient.get(`/production-planning/lots/${lotId}/processes`, { params: filters }),

  createProductionProcess: (lotId: string, data: any) =>
    apiClient.post(`/production-planning/lots/${lotId}/processes`, data),

  updateProductionProcess: (id: string, data: any) =>
    apiClient.put(`/production-planning/processes/${id}`, data),

  // Process Subtasks
  getProcessSubtasks: (processId: string) =>
    apiClient.get(`/production-planning/processes/${processId}/subtasks`),

  createProcessSubtask: (processId: string, data: any) =>
    apiClient.post(`/production-planning/processes/${processId}/subtasks`, data),

  updateProcessSubtask: (id: string, data: any) =>
    apiClient.put(`/production-planning/subtasks/${id}`, data),

  // Daily Production Entries
  getDailyProductionEntries: (lotId: string, filters?: { startDate?: string; endDate?: string; entryType?: string }) =>
    apiClient.get(`/production-planning/lots/${lotId}/production-entries`, { params: filters }),

  createDailyProductionEntry: (lotId: string, data: any) =>
    apiClient.post(`/production-planning/lots/${lotId}/production-entries`, data),

  updateDailyProductionEntry: (id: string, data: any) =>
    apiClient.put(`/production-planning/production-entries/${id}`, data),

  // Dashboard & Reporting
  getProductionSummary: (lotId: string) =>
    apiClient.get(`/production-planning/lots/${lotId}/summary`),

  getDashboardData: (filters?: { startDate?: string; endDate?: string }) =>
    apiClient.get('/production-planning/dashboard', { params: filters }),

  getGanttData: (lotId: string) =>
    apiClient.get(`/production-planning/lots/${lotId}/gantt`),
};

// Query keys
export const PRODUCTION_PLANNING_QUERY_KEYS = {
  all: ['production-planning'] as const,
  lots: () => [...PRODUCTION_PLANNING_QUERY_KEYS.all, 'lots'] as const,
  lot: (id: string) => [...PRODUCTION_PLANNING_QUERY_KEYS.lots(), id] as const,
  lotVendorAssignments: (lotId: string) => [...PRODUCTION_PLANNING_QUERY_KEYS.lot(lotId), 'vendor-assignments'] as const,
  lotProcesses: (lotId: string) => [...PRODUCTION_PLANNING_QUERY_KEYS.lot(lotId), 'processes'] as const,
  processSubtasks: (processId: string) => [...PRODUCTION_PLANNING_QUERY_KEYS.all, 'process-subtasks', processId] as const,
  lotProductionEntries: (lotId: string) => [...PRODUCTION_PLANNING_QUERY_KEYS.lot(lotId), 'production-entries'] as const,
  lotSummary: (lotId: string) => [...PRODUCTION_PLANNING_QUERY_KEYS.lot(lotId), 'summary'] as const,
  dashboard: () => [...PRODUCTION_PLANNING_QUERY_KEYS.all, 'dashboard'] as const,
  gantt: (lotId: string) => [...PRODUCTION_PLANNING_QUERY_KEYS.lot(lotId), 'gantt'] as const,
};

// React Query hooks
export function useProductionLots(filters?: { status?: string; bomId?: string; priority?: string; projectId?: string }) {
  return useQuery({
    queryKey: [...PRODUCTION_PLANNING_QUERY_KEYS.lots(), filters],
    queryFn: () => productionPlanningApi.getProductionLots(filters),
    select: (data) => {


      // Backend response structure: { data: ProductionLot[], timestamp: string, correlationId?: string }
      const result = data.data || [];

      return result;
    },
  });
}

export function useProductionLot(id?: string) {
  return useQuery({
    queryKey: PRODUCTION_PLANNING_QUERY_KEYS.lot(id!),
    queryFn: () => productionPlanningApi.getProductionLotById(id!),
    enabled: !!id,
    select: (data) => data.data?.data,
  });
}

export function useCreateProductionLot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: productionPlanningApi.createProductionLot,
    onSuccess: () => {
      // Invalidate all production lots queries (with any filters)
      queryClient.invalidateQueries({
        queryKey: PRODUCTION_PLANNING_QUERY_KEYS.lots(),
        exact: false
      });
      // Also invalidate dashboard data
      queryClient.invalidateQueries({
        queryKey: PRODUCTION_PLANNING_QUERY_KEYS.dashboard(),
        exact: false
      });
    },
  });
}

export function useUpdateProductionLot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      productionPlanningApi.updateProductionLot(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: PRODUCTION_PLANNING_QUERY_KEYS.lot(variables.id) });
      queryClient.invalidateQueries({ queryKey: PRODUCTION_PLANNING_QUERY_KEYS.lots() });
    },
  });
}

export function useDeleteProductionLot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: productionPlanningApi.deleteProductionLot,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRODUCTION_PLANNING_QUERY_KEYS.lots() });
    },
  });
}

export function useVendorAssignments(lotId?: string) {
  return useQuery({
    queryKey: PRODUCTION_PLANNING_QUERY_KEYS.lotVendorAssignments(lotId!),
    queryFn: () => productionPlanningApi.getVendorAssignments(lotId!),
    enabled: !!lotId,
    select: (data) => data.data?.data,
  });
}

export function useCreateVendorAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ lotId, data }: { lotId: string; data: any }) =>
      productionPlanningApi.createVendorAssignment(lotId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: PRODUCTION_PLANNING_QUERY_KEYS.lotVendorAssignments(variables.lotId)
      });
    },
  });
}

export function useProductionProcesses(lotId?: string, filters?: { status?: string }) {
  return useQuery({
    queryKey: [...PRODUCTION_PLANNING_QUERY_KEYS.lotProcesses(lotId!), filters],
    queryFn: () => productionPlanningApi.getProductionProcesses(lotId!, filters),
    enabled: !!lotId,
    select: (data) => data.data?.data,
  });
}

export function useCreateProductionProcess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ lotId, data }: { lotId: string; data: any }) =>
      productionPlanningApi.createProductionProcess(lotId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: PRODUCTION_PLANNING_QUERY_KEYS.lotProcesses(variables.lotId)
      });
    },
  });
}

export function useProcessSubtasks(processId?: string) {
  return useQuery({
    queryKey: PRODUCTION_PLANNING_QUERY_KEYS.processSubtasks(processId!),
    queryFn: () => productionPlanningApi.getProcessSubtasks(processId!),
    enabled: !!processId,
    select: (data) => data.data?.data,
  });
}

export function useCreateProcessSubtask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ processId, data }: { processId: string; data: any }) =>
      productionPlanningApi.createProcessSubtask(processId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: PRODUCTION_PLANNING_QUERY_KEYS.processSubtasks(variables.processId)
      });
    },
  });
}

export function useDailyProductionEntries(
  lotId?: string,
  filters?: { startDate?: string; endDate?: string; entryType?: string }
) {
  return useQuery({
    queryKey: [...PRODUCTION_PLANNING_QUERY_KEYS.lotProductionEntries(lotId!), filters],
    queryFn: () => productionPlanningApi.getDailyProductionEntries(lotId!, filters),
    enabled: !!lotId,
    select: (data) => data.data?.data,
  });
}

export function useCreateDailyProductionEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ lotId, data }: { lotId: string; data: any }) =>
      productionPlanningApi.createDailyProductionEntry(lotId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: PRODUCTION_PLANNING_QUERY_KEYS.lotProductionEntries(variables.lotId)
      });
    },
  });
}

export function useProductionSummary(lotId?: string) {
  return useQuery({
    queryKey: PRODUCTION_PLANNING_QUERY_KEYS.lotSummary(lotId!),
    queryFn: () => productionPlanningApi.getProductionSummary(lotId!),
    enabled: !!lotId,
    select: (data) => data.data?.data,
  });
}

export function useProductionDashboard(filters?: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: [...PRODUCTION_PLANNING_QUERY_KEYS.dashboard(), filters],
    queryFn: () => productionPlanningApi.getDashboardData(filters),
    select: (data) => data.data?.data,
  });
}

export function useGanttData(lotId?: string) {
  return useQuery({
    queryKey: PRODUCTION_PLANNING_QUERY_KEYS.gantt(lotId!),
    queryFn: () => productionPlanningApi.getGanttData(lotId!),
    enabled: !!lotId,
    select: (data) => data.data?.data,
  });
}