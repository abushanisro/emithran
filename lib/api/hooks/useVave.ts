import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/lib/providers/auth';
import {
  vaveApi,
  VaveIdea,
  CreateVaveProject,
  UpdateVaveProject,
  CreateVaveBomItem,
  CreateVaveIdea,
  CreateVaveShouldCost,
} from '../vave';

// ─── Query Keys ───────────────────────────────────────────────────────────────

export const vaveKeys = {
  all: ['vave'] as const,
  projects: () => [...vaveKeys.all, 'projects'] as const,
  project: (id: string) => [...vaveKeys.all, 'project', id] as const,
  bom: (projectId: string) => [...vaveKeys.project(projectId), 'bom'] as const,
  ideas: (projectId: string) => [...vaveKeys.project(projectId), 'ideas'] as const,
  shouldCosts: (projectId: string) => [...vaveKeys.project(projectId), 'should-costs'] as const,
};

// ─── Query Hooks ──────────────────────────────────────────────────────────────

export function useVaveProjects() {
  const { user, loading: authLoading } = useAuth();

  return useQuery({
    queryKey: vaveKeys.projects(),
    queryFn: () => vaveApi.getProjects(),
    staleTime: 5 * 60 * 1000,
    enabled: !authLoading && !!user,
  });
}

export function useVaveProject(id: string | null) {
  const { user, loading: authLoading } = useAuth();

  return useQuery({
    queryKey: vaveKeys.project(id ?? ''),
    queryFn: () => vaveApi.getProject(id!),
    staleTime: 2 * 60 * 1000,
    enabled: !authLoading && !!user && !!id,
  });
}

export function useVaveBom(projectId: string | null) {
  const { user, loading: authLoading } = useAuth();

  return useQuery({
    queryKey: vaveKeys.bom(projectId ?? ''),
    queryFn: () => vaveApi.getBomItems(projectId!),
    staleTime: 2 * 60 * 1000,
    enabled: !authLoading && !!user && !!projectId,
  });
}

export function useVaveIdeas(projectId: string | null) {
  const { user, loading: authLoading } = useAuth();

  return useQuery({
    queryKey: vaveKeys.ideas(projectId ?? ''),
    queryFn: () => vaveApi.getIdeas(projectId!),
    staleTime: 2 * 60 * 1000,
    enabled: !authLoading && !!user && !!projectId,
  });
}

export function useVaveShouldCosts(projectId: string | null) {
  const { user, loading: authLoading } = useAuth();

  return useQuery({
    queryKey: vaveKeys.shouldCosts(projectId ?? ''),
    queryFn: () => vaveApi.getShouldCosts(projectId!),
    staleTime: 2 * 60 * 1000,
    enabled: !authLoading && !!user && !!projectId,
  });
}

// ─── Mutation Hooks ───────────────────────────────────────────────────────────

export function useCreateVaveProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateVaveProject) => vaveApi.createProject(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vaveKeys.projects() });
      toast.success('VAVE project created');
    },
    onError: () => {
      toast.error('Failed to create VAVE project');
    },
  });
}

export function useUpdateVaveProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateVaveProject }) =>
      vaveApi.updateProject(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: vaveKeys.projects() });
      queryClient.invalidateQueries({ queryKey: vaveKeys.project(id) });
      toast.success('Project updated');
    },
    onError: () => {
      toast.error('Failed to update project');
    },
  });
}

export function useDeleteVaveProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => vaveApi.deleteProject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vaveKeys.projects() });
      toast.success('Project deleted');
    },
    onError: () => {
      toast.error('Failed to delete project');
    },
  });
}

export function useBulkImportVaveBom(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (items: CreateVaveBomItem[]) => vaveApi.bulkImportBom(projectId, items),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: vaveKeys.bom(projectId) });
      toast.success(`Imported ${Array.isArray(data) ? data.length : 0} BOM items`);
    },
    onError: () => {
      toast.error('Failed to import BOM items');
    },
  });
}

export function useDeleteVaveBomItem(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (itemId: string) => vaveApi.deleteBomItem(projectId, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vaveKeys.bom(projectId) });
    },
    onError: () => {
      toast.error('Failed to delete BOM item');
    },
  });
}

export function useBulkCreateVaveIdeas(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ideas: CreateVaveIdea[]) => vaveApi.bulkCreateIdeas(projectId, ideas),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: vaveKeys.ideas(projectId) });
      toast.success(`${Array.isArray(data) ? data.length : 0} VAVE ideas generated and saved`);
    },
    onError: () => {
      toast.error('Failed to save generated ideas');
    },
  });
}

export function useUpdateVaveIdea(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ideaId, data }: { ideaId: string; data: Partial<CreateVaveIdea> }) =>
      vaveApi.updateIdea(projectId, ideaId, data),
    onMutate: async ({ ideaId, data }) => {
      await queryClient.cancelQueries({ queryKey: vaveKeys.ideas(projectId) });
      const prev = queryClient.getQueryData<VaveIdea[]>(vaveKeys.ideas(projectId));
      queryClient.setQueryData<VaveIdea[]>(vaveKeys.ideas(projectId), (old) =>
        (old ?? []).map((idea) => (idea.id === ideaId ? { ...idea, ...data } : idea)),
      );
      return { prev };
    },
    onError: (_, __, context) => {
      if (context?.prev) {
        queryClient.setQueryData(vaveKeys.ideas(projectId), context.prev);
      }
      toast.error('Failed to update idea');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: vaveKeys.ideas(projectId) });
    },
  });
}

export function useDeleteVaveIdea(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ideaId: string) => vaveApi.deleteIdea(projectId, ideaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vaveKeys.ideas(projectId) });
    },
    onError: () => {
      toast.error('Failed to delete idea');
    },
  });
}

export function useUpsertShouldCost(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateVaveShouldCost) => vaveApi.upsertShouldCost(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vaveKeys.shouldCosts(projectId) });
    },
    onError: () => {
      toast.error('Failed to save should cost');
    },
  });
}
