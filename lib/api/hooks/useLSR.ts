import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { lsrApi, CreateLSRDto, UpdateLSRDto } from '../lsr';
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

export const useLSR = (search?: string) => {
  return useQuery({
    queryKey: ['lsr', search],
    queryFn: () => lsrApi.getAll(search),
    retry: false, // 2026 Best Practice: Fail fast for background data
    staleTime: 30 * 60 * 1000, // 30 minutes - reference data changes slowly
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    // Graceful error handling - don't throw errors to ErrorBoundary
    throwOnError: false,
    // Return empty array on error for graceful degradation
    select: (data) => data ?? [],
  });
};

export const useLSRById = (id: string | number) => {
  return useQuery({
    queryKey: ['lsr', id],
    queryFn: () => lsrApi.getById(id),
    enabled: !!id,
  });
};

export const useCreateLSR = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateLSRDto) => lsrApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lsr'] });
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

export const useUpdateLSR = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string | number; data: UpdateLSRDto }) =>
      lsrApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lsr'] });
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

export const useDeleteLSR = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string | number) => lsrApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lsr'] });
      toast.success('Labour entry deleted successfully');
    },
    onError: (error: unknown) => {
      const message = getErrorMessage(error, 'Failed to delete labour entry');
      toast.error(message);
    },
  });
};

export const useImportLSRFromExcel = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => lsrApi.importFromExcel(file),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['lsr'] });
      toast.success(`LHR: ${result.imported} imported, ${result.skipped} skipped`);
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Failed to import LHR records from Excel'));
    },
  });
};

export const useBulkCreateLSR = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateLSRDto[]) => lsrApi.bulkCreate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lsr'] });
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

export interface LSRStatistics {
  total: number;
  averageLHR: number;
  byType: { [key: string]: number };
}

export const useLSRStatistics = (search?: string) => {
  const { data: lsrData, ...queryResult } = useLSR(search);

  const statistics = useMemo((): LSRStatistics => {
    if (!lsrData || lsrData.length === 0) {
      return {
        total: 0,
        averageLHR: 0,
        byType: {},
      };
    }

    const total = lsrData.length;
    const totalLHR = lsrData.reduce((sum, entry) => sum + entry.lhr, 0);
    const averageLHR = total > 0 ? totalLHR / total : 0;

    const byType = lsrData.reduce((acc, entry) => {
      acc[entry.labourType] = (acc[entry.labourType] || 0) + 1;
      return acc;
    }, {} as { [key: string]: number });

    return {
      total,
      averageLHR,
      byType,
    };
  }, [lsrData]);

  return {
    ...queryResult,
    data: statistics,
  };
};
