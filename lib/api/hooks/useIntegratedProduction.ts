import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../index';

// ============================================================================
// API FUNCTIONS
// ============================================================================

const getIntegratedDashboardData = async (lotId: string) => {
  const response = await apiClient.get(`/production-planning/lots/${lotId}/integrated-dashboard`);
  return response.data;
};

const getProductionMonitoring = async (lotId: string) => {
  const response = await apiClient.get(`/production-planning/lots/${lotId}/monitoring`);
  return response.data;
};

const getLotMaterials = async (lotId: string) => {
  const response = await apiClient.get(`/production-planning/lots/${lotId}/materials`);
  return response.data;
};

const getProductionAlerts = async (lotId: string) => {
  const response = await apiClient.get(`/production-planning/lots/${lotId}/alerts`);
  return response.data;
};

const updateMaterialStatus = async (materialId: string, updateData: any) => {
  const response = await apiClient.put(`/production-planning/materials/${materialId}/status`, updateData);
  return response.data;
};

const recordProductionMetrics = async (lotId: string, metricsData: any) => {
  const response = await apiClient.post(`/production-planning/lots/${lotId}/metrics`, metricsData);
  return response.data;
};

const resolveAlert = async (alertId: string, notes: string) => {
  const response = await apiClient.put(`/production-planning/alerts/${alertId}/resolve`, { notes });
  return response.data;
};

const initializeLotMaterials = async (lotId: string) => {
  const response = await apiClient.post(`/production-planning/lots/${lotId}/materials/initialize`);
  return response.data;
};

const getMaterialTrackingHistory = async (materialId: string) => {
  const response = await apiClient.get(`/production-planning/materials/${materialId}/tracking-history`);
  return response.data;
};

// ============================================================================
// REACT QUERY HOOKS
// ============================================================================

export const useIntegratedDashboard = (lotId: string) => {
  return useQuery({
    queryKey: ['integrated-dashboard', lotId],
    queryFn: () => getIntegratedDashboardData(lotId),
    enabled: !!lotId,
    staleTime: 5 * 60 * 1000,
  });
};

export const useProductionMonitoring = (lotId: string) => {
  return useQuery({
    queryKey: ['production-monitoring', lotId],
    queryFn: () => getProductionMonitoring(lotId),
    enabled: !!lotId,
    staleTime: 5 * 60 * 1000,
  });
};

export const useLotMaterials = (lotId: string) => {
  return useQuery({
    queryKey: ['lot-materials', lotId],
    queryFn: () => getLotMaterials(lotId),
    enabled: !!lotId,
    staleTime: 5 * 60 * 1000,
  });
};

export const useProductionAlerts = (lotId: string) => {
  return useQuery({
    queryKey: ['production-alerts', lotId],
    queryFn: () => getProductionAlerts(lotId),
    enabled: !!lotId,
    staleTime: 5 * 60 * 1000,
  });
};

export const useMaterialTrackingHistory = (materialId: string) => {
  return useQuery({
    queryKey: ['material-tracking', materialId],
    queryFn: () => getMaterialTrackingHistory(materialId),
    enabled: !!materialId,
  });
};

// ============================================================================
// MUTATION HOOKS
// ============================================================================

export const useUpdateMaterialStatus = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ materialId, updateData }: { materialId: string; updateData: any }) =>
      updateMaterialStatus(materialId, updateData),
    onSuccess: (data, variables) => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['lot-materials'] });
      queryClient.invalidateQueries({ queryKey: ['integrated-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['production-monitoring'] });
      queryClient.invalidateQueries({ queryKey: ['material-tracking', variables.materialId] });
    },
  });
};

export const useRecordProductionMetrics = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ lotId, metricsData }: { lotId: string; metricsData: any }) =>
      recordProductionMetrics(lotId, metricsData),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['production-monitoring', variables.lotId] });
      queryClient.invalidateQueries({ queryKey: ['integrated-dashboard', variables.lotId] });
    },
  });
};

export const useResolveAlert = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ alertId, notes }: { alertId: string; notes: string }) =>
      resolveAlert(alertId, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-alerts'] });
      queryClient.invalidateQueries({ queryKey: ['integrated-dashboard'] });
    },
  });
};

export const useInitializeLotMaterials = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (lotId: string) => initializeLotMaterials(lotId),
    onSuccess: (data, lotId) => {
      queryClient.invalidateQueries({ queryKey: ['lot-materials', lotId] });
      queryClient.invalidateQueries({ queryKey: ['integrated-dashboard', lotId] });
    },
  });
};

// ============================================================================
// UTILITY HOOKS
// ============================================================================

export const useRefreshDashboard = (lotId: string) => {
  const queryClient = useQueryClient();
  
  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['integrated-dashboard', lotId] });
    queryClient.invalidateQueries({ queryKey: ['production-monitoring', lotId] });
    queryClient.invalidateQueries({ queryKey: ['lot-materials', lotId] });
    queryClient.invalidateQueries({ queryKey: ['production-alerts', lotId] });
  };
  
  return { refreshAll };
};

// Real-time updates are handled through refetchInterval in individual queries
// This provides better performance and more granular control