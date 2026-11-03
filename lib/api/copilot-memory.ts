import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiClient } from './client';

/** What the manufacturing copilot has saved for the signed-in user (backend copilot.controller.ts). */
const copilotMemoryApi = {
  list: () => apiClient.get<{ preferences: string[] }>('/copilot/memory'),
  /** Forget one saved preference, by its exact text. */
  remove: (preference: string) =>
    apiClient.delete<{ preferences: string[] }>('/copilot/memory/preferences', { params: { preference }, retry: false }),
  clear: () => apiClient.delete<unknown>('/copilot/memory', { retry: false }),
};

const KEY = ['copilot', 'memory'] as const;

export function useCopilotMemory() {
  return useQuery({ queryKey: KEY, queryFn: copilotMemoryApi.list });
}

export function useRemoveCopilotPreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (preference: string) => copilotMemoryApi.remove(preference),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not delete the preference'),
  });
}

export function useClearCopilotMemory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => copilotMemoryApi.clear(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not clear copilot memory'),
  });
}
