/**
 * Processes API
 * Manufacturing processes with reference tables
 */

import { apiClient } from './client';

// ========================================
// TYPES
// ========================================

export type Process = {
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
  createdAt: string;
  updatedAt: string;
};

export type ColumnDefinition = {
  name: string;
  type: string;
  label: string;
};

export type ReferenceTable = {
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
};

export type TableRow = {
  id: string;
  tableId: string;
  rowData: Record<string, any>;
  rowOrder: number;
  createdAt: string;
  updatedAt: string;
};

// Request Types
export type CreateProcessData = {
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
};

export type UpdateProcessData = Partial<CreateProcessData>;

export type CreateReferenceTableData = {
  processId: string;
  tableName: string;
  tableDescription?: string;
  columnDefinitions: ColumnDefinition[];
  displayOrder?: number;
  isEditable?: boolean;
};

export type UpdateReferenceTableData = Partial<Omit<CreateReferenceTableData, 'processId'>>;

export type CreateTableRowData = {
  tableId: string;
  rowData: Record<string, any>;
  rowOrder?: number;
};

export type UpdateTableRowData = {
  rowData?: Record<string, any>;
  rowOrder?: number;
};

export type BulkUpdateTableRowsData = {
  tableId: string;
  rows: Array<{
    row_data: Record<string, any>;
    row_order: number;
  }>;
};

// Query Types
export type ProcessQuery = {
  category?: string;
  search?: string;
  machineType?: string;
  page?: number;
  limit?: number;
};

// Response Types
export type ProcessListResponse = {
  processes: Process[];
  count: number;
  page: number;
  limit: number;
};

// ========================================
// API CLIENT
// ========================================

export const processesApi = {
  // Process CRUD
  getAll: async (query?: ProcessQuery): Promise<ProcessListResponse> => {
    const params = new URLSearchParams();
    if (query?.category) params.append('category', query.category);
    if (query?.search) params.append('search', query.search);
    if (query?.machineType) params.append('machineType', query.machineType);
    if (query?.page) params.append('page', query.page.toString());
    if (query?.limit) params.append('limit', query.limit.toString());

    const queryString = params.toString();
    return apiClient.get<ProcessListResponse>(
      `/processes${queryString ? `?${queryString}` : ''}`,
    );
  },

  getById: async (id: string): Promise<Process> => {
    return apiClient.get<Process>(`/processes/${id}`);
  },

  create: async (data: CreateProcessData): Promise<Process> => {
    return apiClient.post<Process>('/processes', data);
  },

  update: async (id: string, data: UpdateProcessData): Promise<Process> => {
    return apiClient.put<Process>(`/processes/${id}`, data);
  },

  delete: async (id: string): Promise<void> => {
    return apiClient.delete(`/processes/${id}`);
  },

  // Reference Tables
  getReferenceTables: async (processId: string): Promise<ReferenceTable[]> => {
    return apiClient.get<ReferenceTable[]>(`/processes/${processId}/reference-tables`);
  },

  getReferenceTable: async (tableId: string): Promise<ReferenceTable> => {
    return apiClient.get<ReferenceTable>(`/processes/reference-tables/${tableId}`);
  },

  // Live sm_lookup_* cost-engine table, by name — used by a calculator
  // popup's "eye" button (any lookup-backed input) to show the real table a
  // value came from. Same shape as a ReferenceTable (columnDefinitions/rows)
  // so callers reuse the identical viewer UI, not a second rendering path.
  getSmLookupTableByName: async (table: string): Promise<ReferenceTable> => {
    return apiClient.get<ReferenceTable>(`/processes/sm-lookup-tables/by-name/${encodeURIComponent(table)}`);
  },

  createReferenceTable: async (data: CreateReferenceTableData): Promise<ReferenceTable> => {
    const { processId, ...tableData } = data;
    return apiClient.post<ReferenceTable>(`/processes/${processId}/reference-tables`, tableData);
  },

  updateReferenceTable: async (tableId: string, data: UpdateReferenceTableData): Promise<ReferenceTable> => {
    return apiClient.put<ReferenceTable>(`/processes/reference-tables/${tableId}`, data);
  },

  deleteReferenceTable: async (tableId: string): Promise<void> => {
    return apiClient.delete(`/processes/reference-tables/${tableId}`);
  },

  // Table Rows
  createTableRow: async (data: CreateTableRowData): Promise<TableRow> => {
    const { tableId, ...rowData } = data;
    return apiClient.post<TableRow>(`/processes/reference-tables/${tableId}/rows`, rowData);
  },

  updateTableRow: async (rowId: string, data: UpdateTableRowData): Promise<TableRow> => {
    return apiClient.put<TableRow>(`/processes/reference-tables/rows/${rowId}`, data);
  },

  deleteTableRow: async (rowId: string): Promise<void> => {
    return apiClient.delete(`/processes/reference-tables/rows/${rowId}`);
  },

  bulkUpdateTableRows: async (data: BulkUpdateTableRowsData): Promise<TableRow[]> => {
    const { tableId, ...bulkData } = data;
    return apiClient.post<TableRow[]>(`/processes/reference-tables/${tableId}/rows/bulk`, bulkData);
  },
};
