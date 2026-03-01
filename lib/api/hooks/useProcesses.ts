import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';
import { useAuth } from '@/lib/providers/auth';
import { toast } from 'sonner';

// ============================================================================
// TYPES
// ============================================================================

export interface Process {
  id: string;
  processName: string;
  processCategory: string;
  description?: string;
  standardTimeMinutes?: number;
  setupTimeMinutes?: number;
  cycleTimeMinutes?: number;
  machineRequired?: boolean;
  machineType?: string;
  laborRequired?: boolean;
  skillLevelRequired?: string;
  userId: string;
  organizationId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProcessListResponse {
  processes: Process[];
  count: number;
  page?: number;
  limit?: number;
}

export interface QueryProcessesParams {
  category?: string;
  search?: string;
  machineType?: string;
  page?: number;
  limit?: number;
}

export interface CreateProcessData {
  processName: string;
  processCategory: string;
  description?: string;
  standardTimeMinutes?: number;
  setupTimeMinutes?: number;
  cycleTimeMinutes?: number;
  machineRequired?: boolean;
  machineType?: string;
  laborRequired?: boolean;
  skillLevelRequired?: string;
}

export interface UpdateProcessData extends Partial<CreateProcessData> {}

export interface ColumnDefinition {
  name: string;
  type: string;
  label: string;
}

export interface ReferenceTable {
  id: string;
  processId: string;
  tableName: string;
  tableDescription?: string;
  columnDefinitions: ColumnDefinition[];
  displayOrder: number;
  isEditable: boolean;
  createdAt: string;
  updatedAt: string;
  rows?: TableRow[];
}

export interface TableRow {
  id: string;
  tableId: string;
  rowData: Record<string, any>;
  rowOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReferenceTableData {
  processId: string;
  tableName: string;
  tableDescription?: string;
  columnDefinitions: ColumnDefinition[];
  displayOrder?: number;
  isEditable?: boolean;
}

export interface UpdateReferenceTableData extends Partial<Omit<CreateReferenceTableData, 'processId'>> {}

export interface CreateTableRowData {
  tableId: string;
  rowData: Record<string, any>;
  rowOrder?: number;
}

export interface UpdateTableRowData {
  rowData?: Record<string, any>;
  rowOrder?: number;
}

export interface BulkUpdateTableRowsData {
  tableId: string;
  rows: Array<{
    row_data: Record<string, any>;
    row_order: number;
  }>;
}

// ============================================================================
// QUERY HOOKS
// ============================================================================

export function useProcesses(params?: QueryProcessesParams) {
  const { user, loading: authLoading } = useAuth();

  return useQuery({
    queryKey: ['processes', 'list', params],
    queryFn: async () => {
      const response = await apiClient.get<ProcessListResponse>('/processes', { params });
      return response;
    },
    enabled: !authLoading && !!user,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useProcess(id: string | undefined) {
  const { user, loading: authLoading } = useAuth();

  return useQuery({
    queryKey: ['processes', 'detail', id],
    queryFn: async () => {
      if (!id) throw new Error('Process ID is required');
      const response = await apiClient.get<Process>(`/processes/${id}`);
      return response;
    },
    enabled: !authLoading && !!user && !!id,
  });
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

export function useCreateProcess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateProcessData) => {
      const response = await apiClient.post<Process>('/processes', data);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['processes', 'list'] });
      toast.success('Process created successfully');
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to create process');
    },
  });
}

export function useUpdateProcess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateProcessData }) => {
      const response = await apiClient.put<Process>(`/processes/${id}`, data);
      return response;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['processes', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['processes', 'detail', variables.id] });
      toast.success('Process updated successfully');
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to update process');
    },
  });
}

export function useDeleteProcess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/processes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['processes', 'list'] });
      toast.success('Process deleted successfully');
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to delete process');
    },
  });
}

// ============================================================================
// REFERENCE TABLE QUERY HOOKS
// ============================================================================

export function useReferenceTables(processId: string | undefined) {
  const { user, loading: authLoading } = useAuth();

  return useQuery({
    queryKey: ['processes', processId, 'reference-tables'],
    queryFn: async () => {
      if (!processId) throw new Error('Process ID is required');
      const response = await apiClient.get<ReferenceTable[]>(`/processes/${processId}/reference-tables`);
      return response;
    },
    enabled: !authLoading && !!user && !!processId,
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}

export function useReferenceTable(tableId: string | undefined) {
  const { user, loading: authLoading } = useAuth();

  return useQuery({
    queryKey: ['reference-tables', tableId],
    queryFn: async () => {
      if (!tableId) throw new Error('Table ID is required');
      const response = await apiClient.get<ReferenceTable>(`/processes/reference-tables/${tableId}`);
      return response;
    },
    enabled: !authLoading && !!user && !!tableId,
    staleTime: 1000 * 60 * 2,
  });
}

// ============================================================================
// REFERENCE TABLE MUTATION HOOKS
// ============================================================================

export function useCreateReferenceTable() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateReferenceTableData) => {
      const response = await apiClient.post<ReferenceTable>(
        `/processes/${data.processId}/reference-tables`,
        data
      );
      return response;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['processes', variables.processId, 'reference-tables'] });
      toast.success('Reference table created successfully');
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to create reference table');
    },
  });
}

export function useUpdateReferenceTable() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ tableId, data }: { tableId: string; data: UpdateReferenceTableData }) => {
      const response = await apiClient.put<ReferenceTable>(
        `/processes/reference-tables/${tableId}`,
        data
      );
      return response;
    },
    onSuccess: (updatedTable, variables) => {
      queryClient.setQueryData(['reference-tables', variables.tableId], updatedTable);
      queryClient.invalidateQueries({ queryKey: ['processes'] });
      toast.success('Reference table updated successfully');
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to update reference table');
    },
  });
}

export function useDeleteReferenceTable() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tableId: string) => {
      await apiClient.delete(`/processes/reference-tables/${tableId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['processes'] });
      toast.success('Reference table deleted successfully');
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to delete reference table');
    },
  });
}

// ============================================================================
// TABLE ROW MUTATION HOOKS
// ============================================================================

export function useCreateTableRow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateTableRowData) => {
      const response = await apiClient.post<TableRow>(
        `/processes/reference-tables/${data.tableId}/rows`,
        data
      );
      return response;
    },
    onSuccess: (_, variables) => {
      // Invalidate both cache patterns to ensure data refresh
      queryClient.invalidateQueries({ queryKey: ['reference-tables', variables.tableId] });
      queryClient.invalidateQueries({ queryKey: ['processes'] });
      toast.success('Row added successfully');
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to add row');
    },
  });
}

export function useUpdateTableRow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ rowId, data }: { rowId: string; tableId: string; data: UpdateTableRowData }) => {
      const response = await apiClient.put<TableRow>(
        `/processes/reference-tables/rows/${rowId}`,
        data
      );
      return response;
    },
    onSuccess: (_, variables) => {
      // Invalidate both cache patterns to ensure data refresh
      if (variables.tableId) {
        queryClient.invalidateQueries({ queryKey: ['reference-tables', variables.tableId] });
      }
      queryClient.invalidateQueries({ queryKey: ['processes'] });
      toast.success('Row updated successfully');
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to update row');
    },
  });
}

export function useDeleteTableRow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ rowId }: { rowId: string; tableId: string }) => {
      await apiClient.delete(`/processes/reference-tables/rows/${rowId}`);
    },
    onSuccess: (_, variables) => {
      // Invalidate both cache patterns to ensure data refresh
      queryClient.invalidateQueries({ queryKey: ['reference-tables', variables.tableId] });
      queryClient.invalidateQueries({ queryKey: ['processes'] });
      toast.success('Row deleted successfully');
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to delete row');
    },
  });
}

export function useBulkUpdateTableRows() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: BulkUpdateTableRowsData) => {
      const response = await apiClient.post<TableRow[]>(
        `/processes/reference-tables/${data.tableId}/rows/bulk`,
        data
      );
      return response;
    },
    onSuccess: (_, variables) => {
      // Invalidate both cache patterns to ensure data refresh
      queryClient.invalidateQueries({ queryKey: ['reference-tables', variables.tableId] });
      queryClient.invalidateQueries({ queryKey: ['processes'] }); // This will catch all process-related queries
      toast.success('Table rows updated successfully');
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to update table rows');
    },
  });
}

// ============================================================================
// VENDOR PROCESS CAPABILITIES (OEM-Standard Sourcing)
// ============================================================================

export interface VendorProcessCapability {
  vendorId: string;
  vendorName: string;
  vendorCode: string;
  equipmentAvailable: string[];
  capacityPerMonth: number;
  leadTimeDays: number;
  certifications: string[];
}

/**
 * Get vendors capable of performing a specific manufacturing process
 * OEM-Standard: Filters vendors by process capability for supplier evaluation
 *
 * Behavior:
 * - Returns empty array if processId is undefined
 * - Disabled until processId is provided
 * - Auto-refetches when processId changes
 *
 * Usage:
 * const { data: vendors } = useVendorsByProcess(selectedProcessId);
 */
export function useVendorsByProcess(processId: string | undefined) {
  const { user, loading: authLoading } = useAuth();

  return useQuery({
    queryKey: ['processes', 'vendors-by-process', processId],
    queryFn: async () => {
      if (!processId) return [];
      const response = await apiClient.get<VendorProcessCapability[]>(
        `/processes/vendors-by-process/${processId}`
      );
      return response;
    },
    enabled: !authLoading && !!user && !!processId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
