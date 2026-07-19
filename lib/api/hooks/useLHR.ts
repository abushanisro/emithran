import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { lhrApi } from '../lhr';
import type { CreateLHRDto, UpdateLHRDto, BenchmarkLHREntry } from '../lhr';
import { toast } from 'sonner';
import { ApiError } from '../client';
import { useMemo } from 'react';

/**
 * Extract error message from ApiError or generic error
 */
const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
};

/**
 * Check if error is a conflict error (409)
 */
const isConflictError = (error: unknown): boolean => {
  return error instanceof ApiError && error.statusCode === 409;
};

export const useLHRBenchmark = (location?: string) => {
  return useQuery<BenchmarkLHREntry[]>({
    queryKey: ['lhr-benchmark', location ?? '__all__'],
    queryFn: () => lhrApi.getBenchmarkRates(location),
    staleTime: 10 * 60 * 1000,   // benchmark rates rarely change
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    throwOnError: false,
    select: (data) => data ?? [],
  });
};

export const useLHR = (search?: string) => {
  return useQuery({
    queryKey: ['lhr', search],
    queryFn: () => lhrApi.getAll(search),
    retry: false,
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    throwOnError: false,
    select: (data) => data ?? { records: [], total: 0 },
  });
};

export const useLHRById = (id: string | number) => {
  return useQuery({
    queryKey: ['lhr', id],
    queryFn: () => lhrApi.getById(id),
    enabled: !!id,
  });
};

export const useCreateLHR = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateLHRDto) => lhrApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lhr'] });
      toast.success('Labour entry created successfully');
    },
    onError: (error: unknown) => {
      const message = getErrorMessage(error, 'Failed to create labour entry');

      if (isConflictError(error)) {
        toast.error(message, {
          description: 'Please use a different labour code or update the existing entry.',
          duration: 5000,
        });
      } else {
        toast.error(message);
      }
    },
  });
};

export const useUpdateLHR = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string | number; data: UpdateLHRDto }) =>
      lhrApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lhr'] });
      toast.success('Labour entry updated successfully');
    },
    onError: (error: unknown) => {
      const message = getErrorMessage(error, 'Failed to update labour entry');

      if (isConflictError(error)) {
        toast.error(message, {
          description: 'Please use a different labour code.',
          duration: 5000,
        });
      } else {
        toast.error(message);
      }
    },
  });
};

export const useDeleteLHR = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string | number) => lhrApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lhr'] });
      toast.success('Labour entry deleted successfully');
    },
    onError: (error: unknown) => {
      const message = getErrorMessage(error, 'Failed to delete labour entry');
      toast.error(message);
    },
  });
};

export const useDeleteAllLHR = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => lhrApi.deleteAll(),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['lhr'] });
      toast.success(`Deleted ${result.deleted} LHR records`);
    },
    onError: () => toast.error('Failed to delete all LHR records'),
  });
};

export const useImportLHRFromExcel = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => lhrApi.importFromExcel(file),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['lhr'] });
      toast.success(`LHR: ${result.imported} imported, ${result.skipped} skipped`);
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Failed to import LHR records from Excel'));
    },
  });
};

export const useBulkCreateLHR = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateLHRDto[]) => lhrApi.bulkCreate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lhr'] });
      toast.success('Labour entries created successfully');
    },
    onError: (error: unknown) => {
      const message = getErrorMessage(error, 'Failed to create labour entries');

      if (isConflictError(error)) {
        toast.error(message, {
          description: 'One or more labour codes already exist. Please check your data.',
          duration: 5000,
        });
      } else {
        toast.error(message);
      }
    },
  });
};

export interface LHRStatistics {
  total: number;
  averageLHR: number;
  byType: { [key: string]: number };
}

export const useLHRStatistics = (search?: string) => {
  const { data: lhrData, ...queryResult } = useLHR(search);

  const statistics = useMemo((): LHRStatistics => {
    const records = lhrData?.records ?? [];
    if (records.length === 0) {
      return { total: lhrData?.total ?? 0, averageLHR: 0, byType: {} };
    }

    const totalLHR = records.reduce((sum, entry) => sum + entry.lhr, 0);
    const averageLHR = records.length > 0 ? totalLHR / records.length : 0;

    const byType = records.reduce((acc, entry) => {
      acc[entry.labourType] = (acc[entry.labourType] || 0) + 1;
      return acc;
    }, {} as { [key: string]: number });

    return { total: lhrData?.total ?? records.length, averageLHR, byType };
  }, [lhrData]);

  return {
    ...queryResult,
    data: statistics,
  };
};
