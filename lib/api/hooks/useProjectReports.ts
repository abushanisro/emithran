import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  projectReportsApi,
  BalloonDiagram,
  InspectionReport,
  CompleteProjectReport,
  CreateBalloonDiagramRequest,
  UpdateBalloonDiagramRequest,
  DiagramAnnotationRequest,
} from '../project-reports';

const QUERY_KEYS = {
  balloonDiagrams: (projectId: string) => ['balloon-diagrams', projectId],
  balloonDiagram: (id: string) => ['balloon-diagram', id],
  inspectionReport: (projectId: string, options?: any) => ['inspection-report', projectId, options],
  completeReport: (projectId: string) => ['complete-report', projectId],
} as const;

export function useBalloonDiagrams(projectId: string) {
  return useQuery({
    queryKey: QUERY_KEYS.balloonDiagrams(projectId),
    queryFn: () => projectReportsApi.getBalloonDiagrams(projectId),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useBalloonDiagram(id: string) {
  return useQuery({
    queryKey: QUERY_KEYS.balloonDiagram(id),
    queryFn: () => projectReportsApi.getBalloonDiagram(id),
    enabled: !!id,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useCreateBalloonDiagram() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateBalloonDiagramRequest) =>
      projectReportsApi.createBalloonDiagram(data),
    onSuccess: (newDiagram, variables) => {
      toast.success('Balloon diagram created successfully');
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.balloonDiagrams(variables.project_id),
      });
    },
    onError: (error) => {
      console.error('Failed to create balloon diagram:', error);
      toast.error('Failed to create balloon diagram');
    },
  });
}

export function useUpdateBalloonDiagram() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateBalloonDiagramRequest }) =>
      projectReportsApi.updateBalloonDiagram(id, data),
    onSuccess: (updatedDiagram) => {
      toast.success('Balloon diagram updated successfully');
      queryClient.setQueryData(
        QUERY_KEYS.balloonDiagram(updatedDiagram.id),
        updatedDiagram
      );
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.balloonDiagrams(updatedDiagram.project_id),
      });
    },
    onError: (error) => {
      console.error('Failed to update balloon diagram:', error);
      toast.error('Failed to update balloon diagram');
    },
  });
}

export function useDeleteBalloonDiagram() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => projectReportsApi.deleteBalloonDiagram(id),
    onSuccess: (_, id) => {
      toast.success('Balloon diagram deleted successfully');
      queryClient.removeQueries({ queryKey: QUERY_KEYS.balloonDiagram(id) });
      queryClient.invalidateQueries({ queryKey: ['balloon-diagrams'] });
    },
    onError: (error) => {
      console.error('Failed to delete balloon diagram:', error);
      toast.error('Failed to delete balloon diagram');
    },
  });
}

export function useAddAnnotation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ diagramId, data }: { diagramId: string; data: DiagramAnnotationRequest }) =>
      projectReportsApi.addAnnotation(diagramId, data),
    onSuccess: (_, variables) => {
      toast.success('Annotation added successfully');
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.balloonDiagram(variables.diagramId),
      });
    },
    onError: (error) => {
      console.error('Failed to add annotation:', error);
      toast.error('Failed to add annotation');
    },
  });
}

export function useUpdateAnnotation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ 
      diagramId, 
      annotationId, 
      data 
    }: { 
      diagramId: string; 
      annotationId: string; 
      data: DiagramAnnotationRequest 
    }) => projectReportsApi.updateAnnotation(diagramId, annotationId, data),
    onSuccess: (_, variables) => {
      toast.success('Annotation updated successfully');
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.balloonDiagram(variables.diagramId),
      });
    },
    onError: (error) => {
      console.error('Failed to update annotation:', error);
      toast.error('Failed to update annotation');
    },
  });
}

export function useDeleteAnnotation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ diagramId, annotationId }: { diagramId: string; annotationId: string }) =>
      projectReportsApi.deleteAnnotation(diagramId, annotationId),
    onSuccess: (_, variables) => {
      toast.success('Annotation deleted successfully');
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.balloonDiagram(variables.diagramId),
      });
    },
    onError: (error) => {
      console.error('Failed to delete annotation:', error);
      toast.error('Failed to delete annotation');
    },
  });
}

export function useInspectionReport(
  projectId: string,
  options?: { partName?: string; drawingNumber?: string }
) {
  return useQuery({
    queryKey: QUERY_KEYS.inspectionReport(projectId, options),
    queryFn: () => projectReportsApi.generateInspectionReport(projectId, options),
    enabled: !!projectId,
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}

export function useCompleteReport(projectId: string) {
  return useQuery({
    queryKey: QUERY_KEYS.completeReport(projectId),
    queryFn: () => projectReportsApi.generateCompleteReport(projectId),
    enabled: !!projectId,
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}