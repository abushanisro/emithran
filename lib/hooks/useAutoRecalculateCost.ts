/**
 * Auto-recalculate BOM costs hook
 *
 * Automatically triggers cost recalculation when cost components are added/updated
 * Used across all cost sections (Raw Materials, Process, Packaging, Child Parts, Procured Parts)
 */

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { toast } from 'sonner';

interface UseAutoRecalculateCostOptions {
  bomId: string;
  bomItemId?: string;
  enabled?: boolean;
}

export function useAutoRecalculateCost(options: UseAutoRecalculateCostOptions) {
  const { bomId, bomItemId, enabled = true } = options;
  const queryClient = useQueryClient();

  /**
   * Recalculate the BOM's costs on the server (POST /boms/:id/cost-recalculations) after a cost component is saved, then refresh
   * every cost view. The views refresh whether or not the recalculation succeeds: a failed one must not leave stale numbers on screen.
   */
  const triggerRecalculation = useCallback(async () => {
    if (!enabled || !bomId) return;

    let recalculated = false;
    try {
      await apiClient.post(`/boms/${bomId}/cost-recalculations`);
      recalculated = true;
    } catch {
      // Silent: it must not interrupt the user's work, and the next load recalculates.
    }

    queryClient.invalidateQueries({ queryKey: ['bom-item-cost'] });
    queryClient.invalidateQueries({ queryKey: ['bom-cost-report'] });
    queryClient.invalidateQueries({ queryKey: ['bom-cost-summary'] });
    queryClient.invalidateQueries({ queryKey: ['bom-item-cost-hierarchy'] });
    if (bomItemId) queryClient.invalidateQueries({ queryKey: ['bom-item-cost', bomItemId] });

    if (recalculated) toast.success('Costs updated', { duration: 2000, description: 'BOM costs have been recalculated' });
  }, [bomId, bomItemId, enabled, queryClient]);

  return { triggerRecalculation };
}
