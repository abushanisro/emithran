/**
 * React Query hooks for Calculators API
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { calculatorsApi } from '../calculators';
import { useAuth } from '@/lib/providers/auth';
import type {
  CreateCalculatorData,
  UpdateCalculatorData,
  CreateFieldData,
  UpdateFieldData,
  CreateFormulaData,
  UpdateFormulaData,
  ExecuteCalculatorData,
  SaveExecutionData,
  ValidateFormulaData,
  CalculatorQuery,
  ExecutionQuery,
  ResolveDatabaseFieldData,
  GetLookupOptionsData,
} from '../calculators';
import { ApiError } from '../client';
import { toast } from 'sonner';

export const calculatorKeys = {
  all: ['calculators'] as const,
  lists: () => [...calculatorKeys.all, 'list'] as const,
  list: (query?: CalculatorQuery) => [...calculatorKeys.lists(), query] as const,
  details: () => [...calculatorKeys.all, 'detail'] as const,
  detail: (id: string) => [...calculatorKeys.details(), id] as const,
  fields: (calculatorId: string) => [...calculatorKeys.detail(calculatorId), 'fields'] as const,
  formulas: (calculatorId: string) => [...calculatorKeys.detail(calculatorId), 'formulas'] as const,
  executions: () => [...calculatorKeys.all, 'executions'] as const,
  executionList: (query?: ExecutionQuery) => [...calculatorKeys.executions(), query] as const,
  execution: (id: string) => [...calculatorKeys.executions(), id] as const,
};

// ========================================
// CALCULATOR QUERIES
// ========================================

export function useCalculators(query?: CalculatorQuery, options?: { enabled?: boolean }) {
  const { user, loading: authLoading } = useAuth();

  return useQuery({
    queryKey: calculatorKeys.list(query),
    queryFn: () => calculatorsApi.getAll(query),
    staleTime: 30 * 60 * 1000, // 30 minutes - reference data
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    enabled: !authLoading && !!user && options?.enabled !== false,
  });
}

export function useCalculator(id: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: calculatorKeys.detail(id),
    queryFn: () => calculatorsApi.getById(id),
    enabled: options?.enabled !== false && !!id,
    staleTime: 1000 * 60 * 5,
    retry: (failureCount, error) => {
      const apiError = error as ApiError;
      if (apiError?.statusCode === 404 || apiError?.statusCode === 400) {
        return false;
      }
      return failureCount < 3;
    },
  });
}

export function useCalculatorFields(calculatorId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: calculatorKeys.fields(calculatorId),
    queryFn: () => calculatorsApi.getFields(calculatorId),
    enabled: options?.enabled !== false && !!calculatorId,
    staleTime: 1000 * 60 * 2,
  });
}

export function useCalculatorFormulas(calculatorId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: calculatorKeys.formulas(calculatorId),
    queryFn: () => calculatorsApi.getFormulas(calculatorId),
    enabled: options?.enabled !== false && !!calculatorId,
    staleTime: 1000 * 60 * 2,
  });
}

// ========================================
// CALCULATOR MUTATIONS
// ========================================

export function useCreateCalculator() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateCalculatorData) => calculatorsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: calculatorKeys.lists() });
      toast.success('Calculator created successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 400) {
        toast.error('Please check all calculator details are filled out correctly.');
      } else if (error.status === 409) {
        toast.error('A calculator with this name already exists.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to create calculators.');
      } else if (error.status === 422) {
        toast.error('Please ensure all calculator configuration is valid.');
      } else {
        toast.error('Unable to create calculator. Please try again or contact support.');
      }
    },
  });
}

export function useUpdateCalculator() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCalculatorData }) =>
      calculatorsApi.update(id, data),
    onSuccess: (updatedCalculator, variables) => {
      // Immediately update all list caches with the new data
      queryClient.setQueriesData(
        { queryKey: calculatorKeys.lists() },
        (oldData: any) => {
          if (!oldData) return oldData;
          return {
            ...oldData,
            calculators: oldData.calculators.map((calc: any) =>
              calc.id === variables.id ? updatedCalculator : calc
            ),
          };
        }
      );

      // Update detail cache
      queryClient.setQueryData(
        calculatorKeys.detail(variables.id),
        updatedCalculator
      );

      toast.success('Calculator updated successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 400) {
        toast.error('Please check that all calculator information is valid.');
      } else if (error.status === 404) {
        toast.error('This calculator no longer exists. It may have been deleted.');
      } else if (error.status === 409) {
        toast.error('Another user is editing this calculator. Please refresh and try again.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to edit this calculator.');
      } else {
        toast.error('Unable to save changes. Please try again or contact support.');
      }
    },
  });
}

export function useDeleteCalculator() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => calculatorsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: calculatorKeys.lists() });
      toast.success('Calculator deleted successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 404) {
        toast.error('This calculator has already been deleted.');
      } else if (error.status === 409) {
        toast.error('Cannot delete calculator because it is being used in active calculations.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to delete this calculator.');
      } else {
        toast.error('Unable to delete calculator. Please try again or contact support.');
      }
    },
  });
}

// ========================================
// FIELD MUTATIONS
// ========================================

export function useCreateField() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateFieldData) => calculatorsApi.createField(data),
    onMutate: async (newFieldData) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: calculatorKeys.detail(newFieldData.calculatorId!) });

      // Snapshot the previous value
      const previousCalculator = queryClient.getQueryData<any>(calculatorKeys.detail(newFieldData.calculatorId!));

      // Optimistically update to the new value
      if (previousCalculator) {
        queryClient.setQueryData(calculatorKeys.detail(newFieldData.calculatorId!), {
          ...previousCalculator,
          fields: [...(previousCalculator.fields || []), { ...newFieldData, id: 'optimistic' }],
        });
      }

      return { previousCalculator };
    },
    onSuccess: (savedField, variables) => {
      // Update cache with the real saved field (replaces optimistic one)
      queryClient.setQueryData(calculatorKeys.detail(variables.calculatorId!), (old: any) => {
        if (!old) return old;
        return {
          ...old,
          fields: (old.fields || []).map((f: any) => f.id === 'optimistic' ? savedField : f)
        };
      });
      toast.success('Field added successfully');
    },
    onError: (error: ApiError, variables, context) => {
      // Rollback to previous state
      if (context?.previousCalculator) {
        queryClient.setQueryData(calculatorKeys.detail(variables.calculatorId!), context.previousCalculator);
      }
      if (error.status === 400) {
        toast.error('Please check all field details are filled out correctly.');
      } else if (error.status === 404) {
        toast.error('This calculator no longer exists. Please refresh the page.');
      } else if (error.status === 409) {
        toast.error('A field with this name already exists in this calculator.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to add fields to this calculator.');
      } else if (error.status === 422) {
        toast.error('Please ensure field type and validation rules are correct.');
      } else {
        toast.error('Unable to add field. Please try again or contact support.');
      }
    },
    onSettled: (_, __, variables) => {
      // Always sync with server at the end
      if (variables.calculatorId) {
        queryClient.invalidateQueries({ queryKey: calculatorKeys.detail(variables.calculatorId!) });
      }
    },
  });
}

export function useUpdateField() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ calculatorId, fieldId, data }: { calculatorId: string; fieldId: string; data: UpdateFieldData }) =>
      calculatorsApi.updateField(calculatorId, fieldId, data),
    onMutate: async ({ calculatorId, fieldId, data }) => {
      await queryClient.cancelQueries({ queryKey: calculatorKeys.detail(calculatorId) });
      const previousCalculator = queryClient.getQueryData<any>(calculatorKeys.detail(calculatorId));

      if (previousCalculator) {
        queryClient.setQueryData(calculatorKeys.detail(calculatorId), {
          ...previousCalculator,
          fields: (previousCalculator.fields || []).map((f: any) =>
            f.id === fieldId ? { ...f, ...data } : f
          ),
        });
      }

      return { previousCalculator };
    },
    onSuccess: (updatedField, variables) => {
      // Precise cache update
      queryClient.setQueryData(calculatorKeys.detail(variables.calculatorId), (old: any) => {
        if (!old) return old;
        return {
          ...old,
          fields: (old.fields || []).map((f: any) => f.id === variables.fieldId ? updatedField : f)
        };
      });
      toast.success('Field updated successfully');
    },
    onError: (error: ApiError, variables, context) => {
      if (context?.previousCalculator) {
        queryClient.setQueryData(calculatorKeys.detail(variables.calculatorId), context.previousCalculator);
      }
      if (error.status === 400) {
        toast.error('Please check that all field information is valid.');
      } else if (error.status === 404) {
        toast.error('This field no longer exists. It may have been deleted.');
      } else if (error.status === 409) {
        toast.error('Another user is editing this field. Please refresh and try again.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to edit this field.');
      } else if (error.status === 422) {
        toast.error('Please ensure field type and validation rules are correct.');
      } else {
        toast.error('Unable to update field. Please try again or contact support.');
      }
    },
    onSettled: (_, __, variables) => {
      queryClient.invalidateQueries({ queryKey: calculatorKeys.detail(variables.calculatorId) });
    },
  });
}

export function useDeleteField() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ calculatorId, fieldId }: { calculatorId: string; fieldId: string }) =>
      calculatorsApi.deleteField(calculatorId, fieldId),
    onMutate: async ({ calculatorId, fieldId }) => {
      await queryClient.cancelQueries({ queryKey: calculatorKeys.detail(calculatorId) });
      const previousCalculator = queryClient.getQueryData<any>(calculatorKeys.detail(calculatorId));

      if (previousCalculator) {
        queryClient.setQueryData(calculatorKeys.detail(calculatorId), {
          ...previousCalculator,
          fields: (previousCalculator.fields || []).filter((f: any) => f.id !== fieldId),
        });
      }

      return { previousCalculator };
    },
    onSuccess: () => {
      toast.success('Field deleted successfully');
    },
    onError: (error: ApiError, variables, context) => {
      if (context?.previousCalculator) {
        queryClient.setQueryData(calculatorKeys.detail(variables.calculatorId!), context.previousCalculator);
      }
      if (error.status === 404) {
        toast.error('This field has already been deleted.');
      } else if (error.status === 409) {
        toast.error('Cannot delete field because it is being used in formulas.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to delete this field.');
      } else {
        toast.error('Unable to delete field. Please try again or contact support.');
      }
    },
    onSettled: (_, __, variables) => {
      queryClient.invalidateQueries({ queryKey: calculatorKeys.detail(variables.calculatorId!) });
    },
  });
}

// ========================================
// FORMULA MUTATIONS
// ========================================

export function useCreateFormula() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateFormulaData) => calculatorsApi.createFormula(data),
    onMutate: async ({ calculatorId, ...data }) => {
      await queryClient.cancelQueries({ queryKey: calculatorKeys.detail(calculatorId!) });
      const previousCalculator = queryClient.getQueryData<any>(calculatorKeys.detail(calculatorId!));

      if (previousCalculator) {
        queryClient.setQueryData(calculatorKeys.detail(calculatorId!), {
          ...previousCalculator,
          formulas: (previousCalculator.formulas || []).map((f: any) =>
            f.id === 'temp' ? { ...f, ...data } : f
          ),
        });
      }

      return { previousCalculator };
    },
    onSuccess: (savedFormula, variables) => {
      queryClient.setQueryData(calculatorKeys.detail(variables.calculatorId!), (old: any) => {
        if (!old) return old;
        return {
          ...old,
          formulas: [...(old.formulas || []), savedFormula]
        };
      });
      toast.success('Formula added successfully');
    },
    onError: (error: ApiError, variables, context) => {
      if (context?.previousCalculator) {
        queryClient.setQueryData(calculatorKeys.detail(variables.calculatorId!), context.previousCalculator);
      }
      if (error.status === 400) {
        toast.error('Please check the formula syntax and field references.');
      } else if (error.status === 404) {
        toast.error('This calculator no longer exists. Please refresh the page.');
      } else if (error.status === 409) {
        toast.error('A formula with this name already exists in this calculator.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to add formulas to this calculator.');
      } else if (error.status === 422) {
        toast.error('Formula contains invalid syntax or field references.');
      } else {
        toast.error('Unable to add formula. Please try again or contact support.');
      }
    },
    onSettled: (_, __, variables) => {
      if (variables.calculatorId) {
        queryClient.invalidateQueries({ queryKey: calculatorKeys.detail(variables.calculatorId!) });
      }
    },
  });
}

export function useUpdateFormula() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ calculatorId, formulaId, data }: { calculatorId: string; formulaId: string; data: UpdateFormulaData }) =>
      calculatorsApi.updateFormula(calculatorId, formulaId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: calculatorKeys.formulas(variables.calculatorId) });
      queryClient.invalidateQueries({ queryKey: calculatorKeys.detail(variables.calculatorId) });
      toast.success('Formula updated successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 400) {
        toast.error('Please check the formula syntax and field references.');
      } else if (error.status === 404) {
        toast.error('This formula no longer exists. It may have been deleted.');
      } else if (error.status === 409) {
        toast.error('Another user is editing this formula. Please refresh and try again.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to edit this formula.');
      } else if (error.status === 422) {
        toast.error('Formula contains invalid syntax or field references.');
      } else {
        toast.error('Unable to update formula. Please try again or contact support.');
      }
    },
  });
}

export function useDeleteFormula() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ calculatorId, formulaId }: { calculatorId: string; formulaId: string }) =>
      calculatorsApi.deleteFormula(calculatorId, formulaId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: calculatorKeys.formulas(variables.calculatorId) });
      queryClient.invalidateQueries({ queryKey: calculatorKeys.detail(variables.calculatorId) });
      toast.success('Formula deleted successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 404) {
        toast.error('This formula has already been deleted.');
      } else if (error.status === 409) {
        toast.error('Cannot delete formula because it is being referenced by other formulas.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to delete this formula.');
      } else {
        toast.error('Unable to delete formula. Please try again or contact support.');
      }
    },
  });
}

export function useValidateFormula() {
  return useMutation({
    mutationFn: (data: ValidateFormulaData) => calculatorsApi.validateFormula(data),
  });
}

// ========================================
// EXECUTION QUERIES & MUTATIONS
// ========================================

export function useExecuteCalculator() {
  return useMutation({
    mutationFn: (data: ExecuteCalculatorData) => calculatorsApi.execute(data),
    onError: (error: ApiError) => {
      if (error.status === 400) {
        toast.error('Please check that all required fields have valid values.');
      } else if (error.status === 404) {
        toast.error('This calculator no longer exists.');
      } else if (error.status === 422) {
        toast.error('Calculation failed due to invalid data or formula errors.');
      } else if (error.status === 500) {
        toast.error('Calculation failed due to a server error. Please try again.');
      } else {
        toast.error('Unable to execute calculator. Please try again or contact support.');
      }
    },
  });
}

export function useSaveExecution() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: SaveExecutionData) => calculatorsApi.saveExecution(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: calculatorKeys.executions() });
      toast.success('Execution saved successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 400) {
        toast.error('Please ensure all execution data is valid before saving.');
      } else if (error.status === 404) {
        toast.error('This calculator no longer exists.');
      } else if (error.status === 409) {
        toast.error('An execution with this name already exists.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to save calculator executions.');
      } else {
        toast.error('Unable to save execution. Please try again or contact support.');
      }
    },
  });
}

export function useExecutions(query?: ExecutionQuery, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: calculatorKeys.executionList(query),
    queryFn: () => calculatorsApi.getExecutions(query),
    staleTime: 1000 * 60 * 5,
    enabled: options?.enabled !== false,
  });
}

export function useExecution(executionId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: calculatorKeys.execution(executionId),
    queryFn: () => calculatorsApi.getExecution(executionId),
    enabled: options?.enabled !== false && !!executionId,
    staleTime: 1000 * 60 * 10,
  });
}

// ========================================
// DATABASE LOOKUP QUERIES
// ========================================

export function useResolveDatabaseField() {
  return useMutation({
    mutationFn: (data: ResolveDatabaseFieldData) => calculatorsApi.resolveDatabaseField(data),
    onError: (error: ApiError) => {
      if (error.status === 400) {
        toast.error('Please check the database field configuration.');
      } else if (error.status === 404) {
        toast.error('Database table or field not found.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to access this database.');
      } else if (error.status === 500) {
        toast.error('Database connection error. Please try again.');
      } else {
        toast.error('Unable to resolve database field. Please try again or contact support.');
      }
    },
  });
}

export function useDatabaseLookupOptions(data: GetLookupOptionsData, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['database-lookup', data.dataSource, data.search, data.limit],
    queryFn: () => calculatorsApi.getLookupOptions(data),
    enabled: options?.enabled !== false && !!data.dataSource,
    staleTime: 1000 * 60 * 5,
  });
}
