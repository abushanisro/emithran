import { Currency, Country, MaterialShape, MaterialCategory } from '../constants/material-categories.constants';

export interface RawMaterialFilters {
  search?: string;
  materialGroup?: string;
  material?: string;
  materialCategory?: MaterialCategory;
  location?: string;
  country?: Country;
  year?: number;
  currency?: Currency;
  shape?: MaterialShape;
  minCost?: number;
  maxCost?: number;
  minDensity?: number;
  maxDensity?: number;
  minMeltingTemp?: number;
  maxMeltingTemp?: number;
  regrinding?: 'Yes' | 'No';
  stockForm?: string;
  application?: string;
}

export interface FilterPagination {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface FilterResult<T> {
  data: T[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  filters: RawMaterialFilters;
  appliedFiltersCount: number;
}

export interface FilterOption<T = string> {
  value: T;
  label: string;
  count?: number;
  disabled?: boolean;
}

export interface FilterGroup {
  key: keyof RawMaterialFilters;
  label: string;
  type: 'select' | 'multiselect' | 'range' | 'search' | 'toggle';
  options?: FilterOption[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  description?: string;
}

export interface FilterMetadata {
  groups: FilterGroup[];
  availableShapes: FilterOption<MaterialShape>[];
  availableCountries: FilterOption<Country>[];
  availableCurrencies: FilterOption<Currency>[];
  costRange: { min: number; max: number };
  densityRange: { min: number; max: number };
  temperatureRange: { min: number; max: number };
}

export interface FilterValidationError {
  field: string;
  message: string;
  value?: any;
}

export interface FilterState {
  filters: RawMaterialFilters;
  pagination: FilterPagination;
  isLoading: boolean;
  errors: FilterValidationError[];
  metadata?: FilterMetadata;
}