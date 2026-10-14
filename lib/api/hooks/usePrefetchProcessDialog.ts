'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { calculatorsApi } from '../calculators';
import { mhrApi } from '../mhr';
import { useAuth } from '@/lib/providers/auth';
import { calculatorKeys, PROCESS_DIALOG_CALCULATOR_QUERY } from './useCalculators';
import { mhrKeys, MHR_PICKER_STALE_MS } from './useMHR';

/**
 * Starts the reads the Edit Process Cost dialog needs the moment its page opens, so they are done (or
 * under way) by the time the engineer clicks Edit. The machine list for a location is about 1 MB and
 * takes seconds to read; fetched on click, the dialog sits empty until it arrives. The keys and stale
 * times are the dialog's own, so its hooks find the data already in the cache.
 */
export function usePrefetchProcessDialogData(location: string | undefined): void {
  const queryClient = useQueryClient();
  const { user, loading } = useAuth();
  useEffect(() => {
    if (loading || !user || !location) return;
    void queryClient.prefetchQuery({
      queryKey: mhrKeys.picker(location),
      queryFn: () => mhrApi.getPickerRows(location),
      staleTime: MHR_PICKER_STALE_MS,
    });
    void queryClient.prefetchQuery({
      queryKey: calculatorKeys.list(PROCESS_DIALOG_CALCULATOR_QUERY),
      queryFn: () => calculatorsApi.getAll(PROCESS_DIALOG_CALCULATOR_QUERY),
      staleTime: 30 * 60 * 1000,
    });
  }, [queryClient, user, loading, location]);
}
