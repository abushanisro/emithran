/**
 * Calculators API
 * Dynamic calculator system with database-connected fields and formulas
 */

import { apiClient } from './client';

// ========================================
// TYPES
// ========================================

export type CalculatorType = 'single' | 'multi_step' | 'dashboard';
export type FieldType = 'number' | 'text' | 'select' | 'database_lookup' | 'calculated' | 'multi_select' | 'const' | 'bom';
export type DataSource = 'lhr' | 'mhr' | 'raw_materials' | 'processes' | 'manual';
export type FormulaType = 'expression' | 'multi_step' | 'conditional';
export type DisplayFormat = 'number' | 'currency' | 'percentage';

export type Calculator = {
  id: string;
  userId: string;
  name: string;
  description?: string;
  calcCategory?: string;
  calculatorType: CalculatorType;
  isTemplate: boolean;
  isPublic: boolean;
  templateCategory?: string;
  displayConfig: Record<string, any>;
  associatedProcessId?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  fields?: CalculatorField[];
  formulas?: CalculatorFormula[];
};

export type CalculatorField = {
  id: string;
  calculatorId: string;
  fieldName: string;
  displayLabel: string;
  fieldType: FieldType;
  dataSource?: DataSource;
  sourceTable?: string;
  sourceField?: string;
  lookupConfig: Record<string, any>;
  defaultValue?: string;
  unit?: string;
  minValue?: number;
  maxValue?: number;
  isRequired: boolean;
  validationRules: Record<string, any>;
  inputConfig: Record<string, any>;
  displayOrder: number;
  fieldGroup?: string;
  createdAt: string;
  updatedAt: string;
};

export type CalculatorFormula = {
  id: string;
  calculatorId: string;
  formulaName: string;
  displayLabel: string;
  description?: string;
  formulaType: FormulaType;
  formulaExpression: string;
  visualFormula: Record<string, any>;
  dependsOnFields: string[];
  dependsOnFormulas: string[];
  outputUnit?: string;
  decimalPlaces: number;
  displayFormat: DisplayFormat;
  executionOrder: number;
  displayInResults: boolean;
  isPrimaryResult: boolean;
  resultGroup?: string;
  createdAt: string;
  updatedAt: string;
};

export type CalculatorExecution = {
  id: string;
  calculatorId: string;
  userId: string;
  executionName?: string;
  description?: string;
  inputValues: Record<string, any>;
  databaseReferences: Record<string, any>;
  calculationResults: Record<string, any>;
  executedAt: string;
  calculationDurationMs?: number;
  calculatorVersion: number;
  tags: string[];
  projectReference?: string;
  createdAt: string;
  updatedAt: string;
};

// Request Types
export type CreateCalculatorData = {
  name: string;
  description?: string;
  calcCategory?: string;
  calculatorType: CalculatorType;
  isTemplate?: boolean;
  isPublic?: boolean;
  templateCategory?: string;
  displayConfig?: Record<string, any>;
  fields?: CreateFieldData[];
  formulas?: CreateFormulaData[];
};

export type UpdateCalculatorData = Partial<CreateCalculatorData>;

export type CreateFieldData = {
  calculatorId?: string;
  fieldName: string;
  displayLabel: string;
  fieldType: FieldType;
  dataSource?: DataSource;
  sourceTable?: string;
  sourceField?: string;
  lookupConfig?: Record<string, any>;
  defaultValue?: string;
  unit?: string;
  minValue?: number;
  maxValue?: number;
  isRequired?: boolean;
  validationRules?: Record<string, any>;
  inputConfig?: Record<string, any>;
  displayOrder?: number;
  fieldGroup?: string;
};

export type UpdateFieldData = Partial<CreateFieldData>;

export type CreateFormulaData = {
  calculatorId?: string;
  formulaName: string;
  displayLabel: string;
  description?: string;
  formulaType?: FormulaType;
  formulaExpression: string;
  visualFormula?: Record<string, any>;
  dependsOnFields?: string[];
  dependsOnFormulas?: string[];
  outputUnit?: string;
  decimalPlaces?: number;
  displayFormat?: DisplayFormat;
  executionOrder?: number;
  displayInResults?: boolean;
  isPrimaryResult?: boolean;
  resultGroup?: string;
};

export type UpdateFormulaData = Partial<CreateFormulaData>;

export type ExecuteCalculatorData = {
  calculatorId: string;
  inputValues: Record<string, any>;
  databaseReferences?: Record<string, any>;
};

export type SaveExecutionData = {
  calculatorId: string;
  executionName?: string;
  description?: string;
  inputValues: Record<string, any>;
  databaseReferences?: Record<string, any>;
  calculationResults: Record<string, any>;
  calculationDurationMs?: number;
  tags?: string[];
  projectReference?: string;
};

export type ValidateFormulaData = {
  formulaExpression: string;
  availableFields?: string[];
  availableFormulas?: string[];
};

export type ResolveDatabaseFieldData = {
  dataSource: DataSource;
  recordId: string;
  fieldName: string;
};

export type GetLookupOptionsData = {
  dataSource: DataSource;
  search?: string;
  limit?: number;
};

// Query Types
export type CalculatorQuery = {
  search?: string;
  calcCategory?: string;
  calculatorType?: CalculatorType;
  isTemplate?: boolean;
  isPublic?: boolean;
  page?: number;
  limit?: number;
};

export type ExecutionQuery = {
  calculatorId?: string;
  search?: string;
  tags?: string[];
  projectReference?: string;
  page?: number;
  limit?: number;
};

// Response Types
export type CalculatorListResponse = {
  calculators: Calculator[];
  total: number;
  page: number;
  limit: number;
};

export type ExecutionListResponse = {
  executions: CalculatorExecution[];
  total: number;
  page: number;
  limit: number;
};

export type ExecutionResult = {
  success: boolean;
  results: Record<string, any>;
  durationMs: number;
  error?: string;
};

export type FormulaValidationResult = {
  isValid: boolean;
  error?: string;
  ast?: any;
  detectedFields?: string[];
  detectedFormulas?: string[];
};

export type LookupRecord = {
  id: string;
  displayLabel: string;
  metadata?: Record<string, any>;
};

// ========================================
// API CLIENT
// ========================================

export const calculatorsApi = {
  // Calculator CRUD
  getAll: async (query?: CalculatorQuery): Promise<CalculatorListResponse> => {
    const params = new URLSearchParams();
    if (query?.search) params.append('search', query.search);
    if (query?.calcCategory) params.append('calcCategory', query.calcCategory);
    if (query?.calculatorType) params.append('calculatorType', query.calculatorType);
    if (query?.isTemplate !== undefined) params.append('isTemplate', query.isTemplate.toString());
    if (query?.isPublic !== undefined) params.append('isPublic', query.isPublic.toString());
    if (query?.page) params.append('page', query.page.toString());
    if (query?.limit) params.append('limit', query.limit.toString());

    const queryString = params.toString();
    return apiClient.get<CalculatorListResponse>(
      `/calculators${queryString ? `?${queryString}` : ''}`,
    ) as Promise<CalculatorListResponse>;
  },

  getById: async (id: string): Promise<Calculator> => {
    return apiClient.get<Calculator>(`/calculators/${id}`) as Promise<Calculator>;
  },

  create: async (data: CreateCalculatorData): Promise<Calculator> => {
    return apiClient.post<Calculator>('/calculators', data) as Promise<Calculator>;
  },

  update: async (id: string, data: UpdateCalculatorData): Promise<Calculator> => {
    return apiClient.put<Calculator>(`/calculators/${id}`, data) as Promise<Calculator>;
  },

  delete: async (id: string): Promise<void> => {
    return apiClient.delete<void>(`/calculators/${id}`) as Promise<void>;
  },

  // Field operations
  getFields: async (calculatorId: string): Promise<CalculatorField[]> => {
    return apiClient.get<CalculatorField[]>(`/calculators/${calculatorId}/fields`) as Promise<CalculatorField[]>;
  },

  createField: async (data: CreateFieldData): Promise<CalculatorField> => {
    const { calculatorId, ...fieldData } = data;
    return apiClient.post<CalculatorField>(`/calculators/${calculatorId}/fields`, fieldData) as Promise<CalculatorField>;
  },

  updateField: async (calculatorId: string, fieldId: string, data: UpdateFieldData): Promise<CalculatorField> => {
    return apiClient.put<CalculatorField>(`/calculators/${calculatorId}/fields/${fieldId}`, data) as Promise<CalculatorField>;
  },

  deleteField: async (calculatorId: string, fieldId: string): Promise<void> => {
    return apiClient.delete<void>(`/calculators/${calculatorId}/fields/${fieldId}`) as Promise<void>;
  },

  // Formula operations
  getFormulas: async (calculatorId: string): Promise<CalculatorFormula[]> => {
    return apiClient.get<CalculatorFormula[]>(`/calculators/${calculatorId}/formulas`) as Promise<CalculatorFormula[]>;
  },

  createFormula: async (data: CreateFormulaData): Promise<CalculatorFormula> => {
    const { calculatorId, ...formulaData } = data;
    return apiClient.post<CalculatorFormula>(`/calculators/${calculatorId}/formulas`, formulaData) as Promise<CalculatorFormula>;
  },

  updateFormula: async (calculatorId: string, formulaId: string, data: UpdateFormulaData): Promise<CalculatorFormula> => {
    return apiClient.put<CalculatorFormula>(`/calculators/${calculatorId}/formulas/${formulaId}`, data) as Promise<CalculatorFormula>;
  },

  deleteFormula: async (calculatorId: string, formulaId: string): Promise<void> => {
    return apiClient.delete<void>(`/calculators/${calculatorId}/formulas/${formulaId}`) as Promise<void>;
  },

  validateFormula: async (data: ValidateFormulaData): Promise<FormulaValidationResult> => {
    return apiClient.post<FormulaValidationResult>('/calculators/formulas/validate', data) as Promise<FormulaValidationResult>;
  },

  // Execution
  execute: async (data: ExecuteCalculatorData): Promise<ExecutionResult> => {
    const { calculatorId, ...executeData } = data;
    return apiClient.post<ExecutionResult>(`/calculators/${calculatorId}/execute`, executeData) as Promise<ExecutionResult>;
  },

  saveExecution: async (data: SaveExecutionData): Promise<CalculatorExecution> => {
    return apiClient.post<CalculatorExecution>('/calculators/executions', data) as Promise<CalculatorExecution>;
  },

  getExecutions: async (query?: ExecutionQuery): Promise<ExecutionListResponse> => {
    const params = new URLSearchParams();
    if (query?.calculatorId) params.append('calculatorId', query.calculatorId);
    if (query?.search) params.append('search', query.search);
    if (query?.projectReference) params.append('projectReference', query.projectReference);
    if (query?.page) params.append('page', query.page.toString());
    if (query?.limit) params.append('limit', query.limit.toString());

    const queryString = params.toString();
    return apiClient.get<ExecutionListResponse>(
      `/calculators/executions${queryString ? `?${queryString}` : ''}`,
    ) as Promise<ExecutionListResponse>;
  },

  getExecution: async (executionId: string): Promise<CalculatorExecution> => {
    return apiClient.get<CalculatorExecution>(`/calculators/executions/${executionId}`) as Promise<CalculatorExecution>;
  },

  // Database lookups
  resolveDatabaseField: async (data: ResolveDatabaseFieldData): Promise<{ value: number }> => {
    return apiClient.post<{ value: number }>('/calculators/resolve-field', data) as Promise<{ value: number }>;
  },

  getLookupOptions: async (data: GetLookupOptionsData): Promise<LookupRecord[]> => {
    return apiClient.post<LookupRecord[]>('/calculators/lookup', data) as Promise<LookupRecord[]>;
  },
};
