/**
 * React Query hooks for MHR API
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mhrApi } from '../mhr';
import type {
  CreateMHRData,
  UpdateMHRData,
  MHRQuery,
  MHRBenchmarkEntry,
  MHRListResponse,
  MHRRecord,
  MHRReferenceDetail,
} from '../mhr';
import { ApiError } from '../client';
import { toast } from 'sonner';

export const mhrKeys = {
  all: ['mhr'] as const,
  lists: () => [...mhrKeys.all, 'list'] as const,
  list: (query?: MHRQuery) => [...mhrKeys.lists(), query] as const,
  details: () => [...mhrKeys.all, 'detail'] as const,
  detail: (id: string) => [...mhrKeys.details(), id] as const,
};

export function useMHRRecords(query?: MHRQuery, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: mhrKeys.list(query),
    queryFn: () => mhrApi.getAll(query),
    staleTime: 1000 * 60 * 5, // 5 minutes
    enabled: options?.enabled !== false,
    retry: false, // 2026 Best Practice: Fail fast for list queries
    refetchOnWindowFocus: false,
    // This list is filtered by machineClass, which changes per operation the
    // process-cost dialog is opened for (e.g. 'tapping', 'deburring',
    // 'press_brake') — each distinct value is its own cache entry. Admins add/
    // edit mhr_records out-of-band (HR Rates page, migrations) at any time, so
    // whichever machine classes were queried BEFORE such a change permanently
    // cache an empty/stale result for the rest of the browser tab's life —
    // nothing else in this hook's config (staleTime elapsing alone, window
    // refocus, dialog close/reopen without a real unmount) ever forces a
    // re-fetch of an already-cached key. Force one fresh network fetch every
    // time a component newly observes this query (e.g. every dialog open)
    // instead, so a machine that was just added is never masked by a stale
    // "no machines for this class" result from earlier in the session.
    refetchOnMount: 'always',
    throwOnError: false, // Graceful error handling
  });
}

export function useMHRRecord(id: string, options?: { enabled?: boolean; retry?: boolean }) {
  return useQuery({
    queryKey: mhrKeys.detail(id),
    queryFn: () => mhrApi.getById(id),
    enabled: options?.enabled !== false && !!id,
    staleTime: 1000 * 60 * 5,
    // Same fix as every other MHR distinct-value/detail hook this session:
    // without this, reopening the Edit dialog for a machine already cached
    // from an earlier open in this tab serves the stale cached row instead
    // of re-fetching — invisible for fields that haven't changed, but any
    // newly-added/changed column (e.g. calculated_mhr_usd_hr) silently
    // doesn't show up until staleTime (5 min) elapses.
    refetchOnMount: 'always',
    retry: (failureCount, error) => {
      if (options?.retry === false) return false;
      const apiError = error as ApiError;
      if (apiError?.statusCode === 404 || apiError?.statusCode === 400) {
        return false;
      }
      return failureCount < 3;
    },
    refetchOnWindowFocus: (query) => {
      return query.state.status !== 'error';
    },
  });
}

// Replaces the "paste raw JSON yourself" free-text field — enabled only when
// editing an existing record (a brand-new record has no id to join against yet).
export function useMHRReferenceDetail(id: string | undefined | null, options?: { enabled?: boolean }) {
  return useQuery<MHRReferenceDetail>({
    queryKey: [...mhrKeys.all, 'reference-detail', id ?? '__none__'],
    queryFn: () => mhrApi.getReferenceDetail(id as string),
    enabled: !!id && options?.enabled !== false,
    staleTime: 1000 * 60 * 30,
    retry: false,
    refetchOnWindowFocus: false,
    throwOnError: false,
  });
}

export function useMHRBenchmark(
  location?: string,
  machineClass?: string,
  options?: { enabled?: boolean },
): { data: MHRBenchmarkEntry[]; isLoading: boolean; error: unknown } {
  const query = useQuery({
    queryKey: [...mhrKeys.all, 'benchmark', location ?? '__all__', machineClass ?? '__all__'],
    queryFn: () => mhrApi.getBenchmarkRates(location, undefined, machineClass),
    staleTime: 1000 * 60 * 30, // benchmark data changes rarely — 30 min cache
    retry: false,
    refetchOnWindowFocus: false,
    throwOnError: false,
    enabled: options?.enabled !== false,
  });
  return {
    data: (query.data ?? []) as MHRBenchmarkEntry[],
    isLoading: query.isLoading,
    error: query.error,
  };
}

// refetchOnMount: 'always' on these distinct-value lookups matches
// useProcessCalculatorMappings' fix for the same confirmed-live bug: whichever
// result a given query key got BEFORE a transient backend outage (the API
// server can crash mid-session and restart) is otherwise cached for the rest
// of the browser tab's life, silently leaving a dropdown (e.g. Category)
// empty even once the backend is healthy again.
export function useMHRCategories(processGroup?: string) {
  return useQuery({
    queryKey: [...mhrKeys.all, 'categories', processGroup ?? null],
    queryFn: () => mhrApi.getCategories(processGroup),
    staleTime: 1000 * 60 * 5,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    throwOnError: false,
  });
}

export function useMHRLocations() {
  return useQuery({
    queryKey: [...mhrKeys.all, 'locations'],
    queryFn: () => mhrApi.getLocations(),
    staleTime: 1000 * 60 * 5,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    throwOnError: false,
    select: (data) => data ?? [],
  });
}

export function useMHRManufacturerCountries() {
  return useQuery({
    queryKey: [...mhrKeys.all, 'manufacturer-countries'],
    queryFn: () => mhrApi.getManufacturerCountries(),
    staleTime: 1000 * 60 * 5,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    throwOnError: false,
  });
}

export function useMHRCurrencies() {
  return useQuery({
    queryKey: [...mhrKeys.all, 'currencies'],
    queryFn: () => mhrApi.getCurrencies(),
    staleTime: 1000 * 60 * 5,
    retry: false,
    refetchOnWindowFocus: false,
    throwOnError: false,
    select: (data) => data ?? [],
  });
}

export function useCreateMHR() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateMHRData) => mhrApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mhrKeys.lists() });
      toast.success('MHR record created successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 400) {
        toast.error('Please check all MHR record details are filled out correctly.');
      } else if (error.status === 409) {
        toast.error('An MHR record with this identifier already exists.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to create MHR records.');
      } else if (error.status === 422) {
        toast.error('Please ensure all rates and time values are valid.');
      } else {
        toast.error('Unable to create MHR record. Please try again or contact support.');
      }
    },
  });
}

type UpdateMHRVariables = {
  id: string;
  data: UpdateMHRData;
  // Set by the Excel-like grid's inline cell editors — a toast per keystroke
  // commit would be unusable at spreadsheet editing speed. Dialog-driven
  // edits (MHRFormDialog) never pass this, so their existing toast behavior
  // is unchanged.
  silent?: boolean;
};

type UpdateMHRContext = {
  previousLists: Array<[readonly unknown[], MHRListResponse | undefined]>;
  previousDetail: MHRRecord | undefined;
};

export function useUpdateMHR() {
  const queryClient = useQueryClient();

  return useMutation<MHRRecord, ApiError, UpdateMHRVariables, UpdateMHRContext>({
    mutationFn: ({ id, data }) => mhrApi.update(id, data),
    // Optimistic update: the grid's inline editors need instant feedback
    // (real spreadsheet behaviour) rather than waiting on a network round
    // trip + invalidate. Patches every cached list matching this record's id
    // plus the detail cache; onSettled reconciles with the server's
    // recalculated fields (source tiers, `calculations`, etc.) shortly after.
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: mhrKeys.lists() });
      await queryClient.cancelQueries({ queryKey: mhrKeys.detail(id) });

      const previousLists = queryClient.getQueriesData<MHRListResponse>({ queryKey: mhrKeys.lists() });
      const previousDetail = queryClient.getQueryData<MHRRecord>(mhrKeys.detail(id));

      queryClient.setQueriesData<MHRListResponse | undefined>({ queryKey: mhrKeys.lists() }, (old) => {
        if (!old) return old;
        return {
          ...old,
          records: old.records.map((r) => (r.id === id ? { ...r, ...data } : r)),
        };
      });
      if (previousDetail) {
        queryClient.setQueryData<MHRRecord>(mhrKeys.detail(id), { ...previousDetail, ...data });
      }

      return { previousLists, previousDetail };
    },
    onError: (error, variables, context) => {
      // Roll back to the pre-edit snapshot — an inline edit that fails must
      // visibly revert, never silently keep a value the server rejected.
      context?.previousLists.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
      if (context?.previousDetail) {
        queryClient.setQueryData(mhrKeys.detail(variables.id), context.previousDetail);
      }
      if (variables.silent) {
        toast.error('Change reverted — could not save to the server.');
        return;
      }
      if (error.status === 400) {
        toast.error('Please check that all MHR record information is valid.');
      } else if (error.status === 404) {
        toast.error('This MHR record no longer exists. It may have been deleted.');
      } else if (error.status === 409) {
        toast.error('Another user is editing this MHR record. Please refresh and try again.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to edit this MHR record.');
      } else if (error.status === 422) {
        toast.error('Please ensure all rates and time values are valid.');
      } else {
        toast.error('Unable to update MHR record. Please try again or contact support.');
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: mhrKeys.lists() });
      queryClient.invalidateQueries({ queryKey: mhrKeys.detail(variables.id) });
    },
    onSuccess: (_data, variables) => {
      if (!variables.silent) toast.success('MHR record updated successfully');
    },
  });
}

export function useDeleteMHR() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => mhrApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mhrKeys.lists() });
      toast.success('MHR record deleted successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 404) {
        toast.error('This MHR record has already been deleted.');
      } else if (error.status === 409) {
        toast.error('Cannot delete MHR record because it is being used in process calculations.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to delete this MHR record.');
      } else {
        toast.error('Unable to delete MHR record. Please try again or contact support.');
      }
    },
  });
}

export function useDeleteAllMHR() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => mhrApi.deleteAll(),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: mhrKeys.lists() });
      toast.success(`Deleted ${result.deleted} MHR records`);
    },
    onError: () => toast.error('Failed to delete all MHR records'),
  });
}

export function useImportMHRFromExcel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => mhrApi.importFromExcel(file),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: mhrKeys.lists() });
      if (result.imported > 0) {
        toast.success(`MHR: ${result.imported} imported, ${result.skipped} skipped`);
      } else if (result.errors?.length) {
        toast.error(`Import failed: ${result.errors[0]}`);
      } else if (result.skipped > 0) {
        toast.info(`MHR: all ${result.skipped} records already exist — nothing new imported`);
      } else {
        toast.warning('MHR: 0 records imported — file may be empty or format not recognised');
      }
    },
    onError: () => {
      toast.error('Failed to import MHR records from Excel');
    },
  });
}
