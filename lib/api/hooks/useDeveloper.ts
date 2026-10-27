import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { developerApi, type CreateApiKeyData } from '../developer';
import { toast } from 'sonner';

export const developerKeys = {
  apiKeys: ['developer', 'api-keys'] as const,
};

export function useApiKeys() {
  return useQuery({
    queryKey: developerKeys.apiKeys,
    queryFn: () => developerApi.listApiKeys(),
    staleTime: 1000 * 60,
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateApiKeyData) => developerApi.createApiKey(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: developerKeys.apiKeys });
    },
    onError: () => {
      toast.error('Failed to create API key');
    },
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => developerApi.revokeApiKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: developerKeys.apiKeys });
      toast.success('API key revoked');
    },
    onError: () => {
      toast.error('Failed to revoke API key');
    },
  });
}
