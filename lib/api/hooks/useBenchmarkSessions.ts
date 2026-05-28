import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/lib/providers/auth';
import {
  benchmarkSessionsApi,
  BenchmarkSession,
  CreateBenchmarkSession,
  UpdateBenchmarkSession,
} from '../benchmark-sessions';

// ─── Query Keys ───────────────────────────────────────────────────────────────

export const benchmarkKeys = {
  all: ['benchmark-sessions'] as const,
  sessions: () => [...benchmarkKeys.all, 'sessions'] as const,
  session: (id: string) => [...benchmarkKeys.all, 'session', id] as const,
};

// ─── Query Hooks ──────────────────────────────────────────────────────────────

export function useBenchmarkSessions() {
  const { user, loading: authLoading } = useAuth();

  return useQuery({
    queryKey: benchmarkKeys.sessions(),
    queryFn: () => benchmarkSessionsApi.getSessions(),
    staleTime: 5 * 60 * 1000,
    enabled: !authLoading && !!user,
  });
}

export function useBenchmarkSession(id: string | null) {
  const { user, loading: authLoading } = useAuth();

  return useQuery({
    queryKey: benchmarkKeys.session(id ?? ''),
    queryFn: () => benchmarkSessionsApi.getSession(id!),
    staleTime: 2 * 60 * 1000,
    enabled: !authLoading && !!user && !!id,
  });
}

// ─── Mutation Hooks ───────────────────────────────────────────────────────────

export function useCreateBenchmarkSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateBenchmarkSession) =>
      benchmarkSessionsApi.createSession(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: benchmarkKeys.sessions() });
      toast.success('Benchmark session created');
    },
    onError: () => {
      toast.error('Failed to create benchmark session');
    },
  });
}

export function useUpdateBenchmarkSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateBenchmarkSession }) =>
      benchmarkSessionsApi.updateSession(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: benchmarkKeys.sessions() });
      queryClient.invalidateQueries({ queryKey: benchmarkKeys.session(id) });
      toast.success('Session updated');
    },
    onError: () => {
      toast.error('Failed to update session');
    },
  });
}

export function useDeleteBenchmarkSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => benchmarkSessionsApi.deleteSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: benchmarkKeys.sessions() });
      toast.success('Session deleted');
    },
    onError: () => {
      toast.error('Failed to delete session');
    },
  });
}
