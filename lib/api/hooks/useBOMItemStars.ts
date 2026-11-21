import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiClient } from '../client';
import { useAuthEnabledWith } from './useAuthEnabled';

/** The signed-in person's starred items of one BOM (their own stars, as Gmail's): backend /bom-item-stars. */
export const bomItemStarKeys = {
  all: ['bom-item-stars'] as const,
  list: (bomId: string) => [...bomItemStarKeys.all, bomId] as const,
};

export function useStarredBOMItems(bomId: string | undefined) {
  return useQuery({
    queryKey: bomItemStarKeys.list(bomId ?? ''),
    queryFn: async () => {
      const res = await apiClient.get<{ bomItemIds: string[] }>(`/bom-item-stars?bomId=${encodeURIComponent(bomId ?? '')}`);
      return res.bomItemIds;
    },
    enabled: useAuthEnabledWith(!!bomId),
    staleTime: 5 * 60 * 1000,
  });
}

/** The starred ids after starring (each id once, the new one last) or unstarring one item. */
export function withStar(ids: readonly string[] | undefined, bomItemId: string, starred: boolean): string[] {
  const others = (ids ?? []).filter((id) => id !== bomItemId);
  return starred ? [...others, bomItemId] : others;
}

/** Star or unstar one item. The star changes at once; a failed call puts it back and says so. */
export function useToggleBOMItemStar(bomId: string) {
  const queryClient = useQueryClient();
  const key = bomItemStarKeys.list(bomId);
  return useMutation({
    mutationFn: ({ bomItemId, starred }: { bomItemId: string; starred: boolean }) =>
      starred ? apiClient.put(`/bom-item-stars/${bomItemId}`) : apiClient.delete(`/bom-item-stars/${bomItemId}`),
    onMutate: async ({ bomItemId, starred }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<string[]>(key);
      queryClient.setQueryData<string[]>(key, (ids) => withStar(ids, bomItemId, starred));
      return { previous };
    },
    onError: (_error, { starred }, context) => {
      queryClient.setQueryData(key, context?.previous);
      toast.error(starred ? 'Could not star the item' : 'Could not remove the star', { description: 'Please try again.' });
    },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: key }); },
  });
}
