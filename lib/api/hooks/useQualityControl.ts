import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '../client';

export interface QualityInspection {
  id: string;
  name: string;
  description?: string;
  type: string;
  status: 'planned' | 'in_progress' | 'completed' | 'approved' | 'rejected';
  project_id: string;
  bom_id?: string;
  inspector?: string;
  planned_date?: string;
  actual_start_date?: string;
  actual_end_date?: string;
  selected_items?: any[];
  quality_standards?: any;
  checklist?: any[];
  overall_result?: 'pass' | 'fail' | 'conditional';
  notes?: string;
  approved_by?: string;
  approved_at?: string;
  rejected_by?: string;
  rejected_at?: string;
  rejection_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateQualityInspectionRequest {
  name: string;
  description?: string;
  type: string;
  project_id: string;
  bom_id?: string;
  inspector?: string;
  planned_date?: string;
  selected_items?: any[];
  quality_standards?: any;
  checklist?: any[];
}

export interface InspectionResult {
  inspection_id: string;
  checklist_results: any[];
  overall_result: 'pass' | 'fail' | 'conditional';
  notes?: string;
  recommendations?: string;
  attachments?: any[];
}

export interface DetailedInspectionReport {
  inspectionId: string;
  balloonDrawing: {
    partName: string;
    material: string;
    surfaceTreatment?: string;
    drawingTitle: string;
    drawingSize: string;
    balloonAnnotations: Array<{
      id: string;
      number: number;
      x: number;
      y: number;
    }>;
  };
  finalInspectionReport: {
    companyName: string;
    revisionNumber?: string;
    inspectionDate: string;
    rawMaterial: string;
    inspectionBy: string;
    approvedBy?: string;
    generalRemarks?: string;
    status: 'draft' | 'release' | 'rejected';
  };
  inspectionTable: {
    samples: number; // 1-5
    measurements: Array<{
      id: string;
      slNo: number;
      specification: string;
      nominal: number;
      plusTolerance: number;
      minusTolerance: number;
      method: string;
      sampleValues: number[]; // Array of sample values (1-5)
      remarks?: string;
    }>;
  };
}

export interface QualityDashboardMetrics {
  totalInspections: number;
  completedInspections: number;
  passRate: number;
  nonConformances: number;
  avgInspectionTime: number;
  inspectionsThisMonth: number;
}

const QUERY_KEYS = {
  inspections: (projectId?: string, filters?: any) => ['quality-inspections', projectId, filters],
  inspection: (id: string) => ['quality-inspection', id],
  inspectionResults: (id: string) => ['quality-inspection-results', id],
  dashboard: (projectId: string) => ['quality-dashboard', projectId],
  metrics: (projectId: string) => ['quality-metrics', projectId],
} as const;

// Fetch all quality inspections
export function useQualityInspections(
  projectId?: string,
  filters?: { status?: string; type?: string; inspector?: string }
) {
  return useQuery({
    queryKey: QUERY_KEYS.inspections(projectId, filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (projectId) params.append('projectId', projectId);
      if (filters?.status) params.append('status', filters.status);
      if (filters?.type) params.append('type', filters.type);
      if (filters?.inspector) params.append('inspector', filters.inspector);

      const response = await apiClient.get<QualityInspection[]>(
        `/quality-control/inspections?${params.toString()}`
      );
      return response;
    },
    enabled: !!projectId,
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}

// Fetch single quality inspection
export function useQualityInspection(id: string) {
  return useQuery({
    queryKey: QUERY_KEYS.inspection(id),
    queryFn: async () => {
      const response = await apiClient.get<QualityInspection>(`/quality-control/inspections/${id}`);
      return response;
    },
    enabled: !!id,
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}

// Create quality inspection
export function useCreateQualityInspection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateQualityInspectionRequest) => {
      const response = await apiClient.post<QualityInspection>('/quality-control/inspections', data);
      return response;
    },
    onSuccess: (newInspection, variables) => {
      toast.success('Quality inspection created successfully');
      
      // Invalidate and refetch inspections list
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.inspections(variables.project_id),
      });
      
      // Invalidate dashboard metrics
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.dashboard(variables.project_id),
      });
    },
    onError: (error) => {
      console.error('Failed to create quality inspection:', error);
      toast.error('Failed to create quality inspection');
    },
  });
}

// Update quality inspection
export function useUpdateQualityInspection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CreateQualityInspectionRequest> }) => {
      const response = await apiClient.put<QualityInspection>(`/quality-control/inspections/${id}`, data);
      return response;
    },
    onSuccess: (updatedInspection) => {
      toast.success('Quality inspection updated successfully');
      
      // Update the specific inspection in cache
      queryClient.setQueryData(
        QUERY_KEYS.inspection(updatedInspection.id),
        updatedInspection
      );
      
      // Invalidate inspections list
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.inspections(updatedInspection.project_id),
      });
    },
    onError: (error) => {
      console.error('Failed to update quality inspection:', error);
      toast.error('Failed to update quality inspection');
    },
  });
}

// Submit inspection results
export function useSubmitInspectionResults() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ inspectionId, results }: { inspectionId: string; results: InspectionResult }) => {
      const response = await apiClient.post<any>(`/quality-control/inspections/${inspectionId}/results`, results);
      return response;
    },
    onSuccess: (_, variables) => {
      toast.success('Inspection results submitted successfully');
      
      // Invalidate inspection data
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.inspection(variables.inspectionId),
      });
      
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.inspectionResults(variables.inspectionId),
      });
      
      // Invalidate dashboard metrics
      const inspection = queryClient.getQueryData<QualityInspection>(
        QUERY_KEYS.inspection(variables.inspectionId)
      );
      if (inspection) {
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.dashboard(inspection.project_id),
        });
      }
    },
    onError: (error) => {
      console.error('Failed to submit inspection results:', error);
      toast.error('Failed to submit inspection results');
    },
  });
}

// Start inspection
export function useStartInspection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (inspectionId: string) => {
      const response = await apiClient.post<QualityInspection>(`/quality-control/inspections/${inspectionId}/start`);
      return response;
    },
    onSuccess: (updatedInspection) => {
      toast.success('Inspection started successfully');
      queryClient.setQueryData(QUERY_KEYS.inspection(updatedInspection.id), updatedInspection);
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.inspections(updatedInspection.project_id),
      });
    },
    onError: (error) => {
      console.error('Failed to start inspection:', error);
      toast.error('Failed to start inspection');
    },
  });
}

// Complete inspection
export function useCompleteInspection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      inspectionId, 
      data 
    }: { 
      inspectionId: string; 
      data: { notes?: string; finalResult: 'pass' | 'fail' | 'conditional' } 
    }) => {
      const response = await apiClient.post<QualityInspection>(
        `/quality-control/inspections/${inspectionId}/complete`,
        data
      );
      return response;
    },
    onSuccess: (updatedInspection) => {
      toast.success('Inspection completed successfully');
      queryClient.setQueryData(QUERY_KEYS.inspection(updatedInspection.id), updatedInspection);
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.inspections(updatedInspection.project_id),
      });
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.dashboard(updatedInspection.project_id),
      });
    },
    onError: (error) => {
      console.error('Failed to complete inspection:', error);
      toast.error('Failed to complete inspection');
    },
  });
}

// Fetch quality dashboard metrics
export function useQualityDashboard(projectId: string) {
  return useQuery({
    queryKey: QUERY_KEYS.dashboard(projectId),
    queryFn: async () => {
      const response = await apiClient.get<QualityDashboardMetrics>(
        `/quality-control/projects/${projectId}/dashboard`
      );
      return response;
    },
    enabled: !!projectId,
    staleTime: 1000 * 60 * 1, // 1 minute
  });
}

// Fetch quality metrics
export function useQualityMetrics(projectId: string, dateRange?: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: QUERY_KEYS.metrics(projectId),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateRange?.startDate) params.append('startDate', dateRange.startDate);
      if (dateRange?.endDate) params.append('endDate', dateRange.endDate);

      const response = await apiClient.get<any>(
        `/quality-control/projects/${projectId}/metrics?${params.toString()}`
      );
      return response;
    },
    enabled: !!projectId,
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}

// Save detailed inspection report (draft or final)
export function useSaveDetailedInspectionReport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (report: DetailedInspectionReport) => {
      const response = await apiClient.post<DetailedInspectionReport>(
        `/quality-control/inspections/${report.inspectionId}/detailed-report`,
        report
      );
      return response;
    },
    onSuccess: (savedReport) => {
      toast.success('Inspection report saved successfully');
      
      // Update the inspection query cache
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.inspection(savedReport.inspectionId),
      });
      
      // Invalidate inspections list
      queryClient.invalidateQueries({
        queryKey: ['quality-inspections'],
      });
    },
    onError: (error) => {
      console.error('Failed to save inspection report:', error);
      toast.error('Failed to save inspection report');
    },
  });
}

// Approve quality inspection
export function useApproveQualityInspection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (inspectionId: string) => {
      const response = await apiClient.post<QualityInspection>(`/quality-control/inspections/${inspectionId}/approve`, {});
      return response;
    },
    onSuccess: (updatedInspection) => {
      toast.success('Quality inspection approved successfully');
      
      // Update the specific inspection in cache
      queryClient.setQueryData(
        QUERY_KEYS.inspection(updatedInspection.id),
        updatedInspection
      );
      
      // Invalidate inspections list
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.inspections(updatedInspection.project_id),
      });
      
      // Invalidate dashboard metrics
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.dashboard(updatedInspection.project_id),
      });
    },
    onError: (error) => {
      console.error('Failed to approve quality inspection:', error);
      toast.error('Failed to approve quality inspection');
    },
  });
}

// Reject quality inspection
export function useRejectQualityInspection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ inspectionId, reason }: { inspectionId: string; reason?: string }) => {
      const response = await apiClient.post<QualityInspection>(`/quality-control/inspections/${inspectionId}/reject`, { 
        rejectionReason: reason, 
        correctiveAction: '' 
      });
      return response;
    },
    onSuccess: (updatedInspection) => {
      toast.success('Quality inspection rejected');
      
      // Update the specific inspection in cache
      queryClient.setQueryData(
        QUERY_KEYS.inspection(updatedInspection.id),
        updatedInspection
      );
      
      // Invalidate inspections list
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.inspections(updatedInspection.project_id),
      });
      
      // Invalidate dashboard metrics
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.dashboard(updatedInspection.project_id),
      });
    },
    onError: (error) => {
      console.error('Failed to reject quality inspection:', error);
      toast.error('Failed to reject quality inspection');
    },
  });
}

// Delete quality inspection
export function useDeleteQualityInspection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (inspectionId: string) => {
      const response = await apiClient.delete(`/quality-control/inspections/${inspectionId}`);
      return response;
    },
    onSuccess: (_, inspectionId) => {
      toast.success('Quality inspection deleted successfully');
      
      // Invalidate all inspections queries to refresh the list
      queryClient.invalidateQueries({
        queryKey: ['quality-inspections'],
      });
      
      // Invalidate dashboard metrics
      queryClient.invalidateQueries({
        queryKey: ['quality-dashboard'],
      });
      
      // Remove the specific inspection from cache
      queryClient.removeQueries({
        queryKey: ['quality-inspection', inspectionId],
      });
    },
    onError: (error) => {
      console.error('Failed to delete quality inspection:', error);
      toast.error('Failed to delete quality inspection');
    },
  });
}

// Load detailed inspection report
export function useDetailedInspectionReport(inspectionId: string) {
  return useQuery({
    queryKey: ['detailed-inspection-report', inspectionId],
    queryFn: async () => {
      console.log(`🔍 Loading detailed inspection report for: ${inspectionId}`);
      
      try {
        const response = await apiClient.get<DetailedInspectionReport>(
          `/quality-control/inspections/${inspectionId}/detailed-report`
        );
        console.log(`✅ Report loaded successfully:`, response);
        return response;
      } catch (error: any) {
        console.log(`❌ Report loading error for ${inspectionId}:`, error);
        console.log(`Error statusCode: ${error.statusCode}, Error status: ${error.status}, Error code: ${error.code}`);
        
        // If report doesn't exist (404), return null instead of throwing error
        // Check both statusCode (from ApiError) and status (legacy/other sources)
        if (error.statusCode === 404 || error.status === 404 || error.message?.includes('not found')) {
          console.log(`✅ Handling 404 - returning null for non-existent report`);
          return null;
        }
        
        // Re-throw other errors
        console.log(`❌ Re-throwing error:`, error);
        throw error;
      }
    },
    enabled: !!inspectionId,
    staleTime: 1000 * 60 * 2, // 2 minutes
    retry: (failureCount, error: any) => {
      // Don't retry on 404 errors - check both statusCode and status
      if (error.statusCode === 404 || error.status === 404) return false;
      return failureCount < 3;
    },
  });
}