'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { COUNTRY_DEFAULT_CURRENCY } from '@/lib/constants/materials';
import type { Currency, Country, MaterialShape, MaterialCategory } from '@/lib/constants/materials';

export interface MaterialFilterState {
  search: string;
  materialCategory?: MaterialCategory;
  country?: Country;
  currency?: Currency;
  shape?: MaterialShape;
  minCost?: number;
  maxCost?: number;
  year?: number;
  location?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface MaterialFilterOptions {
  availableLocations: string[];
  availableYears: number[];
  costRange: { min: number; max: number };
  densityRange: { min: number; max: number };
  temperatureRange: { min: number; max: number };
}

export interface UseMaterialFiltersProps {
  initialFilters?: Partial<MaterialFilterState>;
  onFiltersChange?: (filters: MaterialFilterState) => void;
  autoSyncCurrency?: boolean;
  debounceMs?: number;
}

export const useMaterialFilters = ({
  initialFilters = {},
  onFiltersChange,
  autoSyncCurrency = true,
  debounceMs = 300
}: UseMaterialFiltersProps = {}) => {
  // Default filter state
  const defaultFilters: MaterialFilterState = {
    search: '',
    year: new Date().getFullYear(),
    sortBy: 'material',
    sortOrder: 'asc',
    page: 1,
    limit: 50,
    ...initialFilters
  };

  const [filters, setFilters] = useState<MaterialFilterState>(defaultFilters);
  const [debouncedFilters, setDebouncedFilters] = useState<MaterialFilterState>(filters);

  // Auto-sync currency with country selection
  useEffect(() => {
    if (autoSyncCurrency && filters.country && !filters.currency) {
      const defaultCurrency = COUNTRY_DEFAULT_CURRENCY[filters.country];
      if (defaultCurrency) {
        setFilters(prev => ({ ...prev, currency: defaultCurrency }));
      }
    }
  }, [filters.country, autoSyncCurrency]);

  // Debounce filter changes for search and other frequent updates
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(filters);
      onFiltersChange?.(filters);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [filters, onFiltersChange, debounceMs]);

  // Update individual filter values
  const updateFilter = useCallback(<K extends keyof MaterialFilterState>(
    key: K,
    value: MaterialFilterState[K]
  ) => {
    setFilters(prev => {
      const newFilters = { ...prev, [key]: value };
      
      // Reset page when filters change (except pagination changes)
      if (key !== 'page' && key !== 'limit') {
        newFilters.page = 1;
      }
      
      return newFilters;
    });
  }, []);

  // Batch update multiple filters
  const updateFilters = useCallback((newFilters: Partial<MaterialFilterState>) => {
    setFilters(prev => ({
      ...prev,
      ...newFilters,
      page: newFilters.page ?? 1 // Reset page unless explicitly set
    }));
  }, []);

  // Clear all filters
  const clearFilters = useCallback(() => {
    const clearedFilters: MaterialFilterState = {
      ...defaultFilters,
      year: new Date().getFullYear(),
      ...(filters.sortBy !== undefined ? { sortBy: filters.sortBy } : {}),
      ...(filters.sortOrder !== undefined ? { sortOrder: filters.sortOrder } : {}),
    };
    setFilters(clearedFilters);
  }, [defaultFilters, filters.sortBy, filters.sortOrder]);

  // Clear specific filter
  const clearFilter = useCallback(<K extends keyof MaterialFilterState>(key: K) => {
    setFilters(prev => {
      const newFilters = { ...prev };
      delete newFilters[key];
      return { ...newFilters, page: 1 };
    });
  }, []);

  // Search-specific handlers
  const setSearch = useCallback((search: string) => {
    updateFilter('search', search);
  }, [updateFilter]);

  const setMaterialCategory = useCallback((category?: MaterialCategory) => {
    setFilters(prev => {
      const newFilters: MaterialFilterState = { ...prev, ...(category !== undefined ? { materialCategory: category } : {}), page: 1 };
      
      // Clear shape if it's incompatible with new category
      if (category && prev.shape) {
        // This would use shape-category validation logic
        // For now, we'll keep the shape
      }
      
      return newFilters;
    });
  }, []);

  const setCountry = useCallback((country?: Country) => {
    setFilters(prev => {
      const newFilters: MaterialFilterState = { ...prev, ...(country !== undefined ? { country } : {}), page: 1 };
      
      // Auto-update currency based on country
      if (autoSyncCurrency && country) {
        newFilters.currency = COUNTRY_DEFAULT_CURRENCY[country];
      }
      
      return newFilters;
    });
  }, [autoSyncCurrency]);

  const setCurrency = useCallback((currency?: Currency) => {
    updateFilter('currency', currency);
  }, [updateFilter]);

  const setShape = useCallback((shape?: MaterialShape) => {
    updateFilter('shape', shape);
  }, [updateFilter]);

  const setCostRange = useCallback((minCost?: number, maxCost?: number) => {
    setFilters(prev => ({
      ...prev,
      ...(minCost !== undefined && !isNaN(minCost) ? { minCost } : {}),
      ...(maxCost !== undefined && !isNaN(maxCost) ? { maxCost } : {}),
      page: 1
    }));
  }, []);

  const setYear = useCallback((year?: number) => {
    updateFilter('year', year);
  }, [updateFilter]);

  const setLocation = useCallback((location?: string) => {
    updateFilter('location', location);
  }, [updateFilter]);

  const setSorting = useCallback((sortBy: string, sortOrder?: 'asc' | 'desc') => {
    setFilters(prev => ({
      ...prev,
      sortBy,
      sortOrder: sortOrder || (prev.sortBy === sortBy && prev.sortOrder === 'asc' ? 'desc' : 'asc')
    }));
  }, []);

  const setPagination = useCallback((page: number, limit?: number) => {
    setFilters(prev => ({
      ...prev,
      page,
      ...(limit && { limit })
    }));
  }, []);

  // Computed values
  const appliedFiltersCount = useMemo(() => {
    let count = 0;
    if (filters.search) count++;
    if (filters.materialCategory) count++;
    if (filters.country) count++;
    if (filters.currency) count++;
    if (filters.shape) count++;
    if (filters.minCost !== undefined || filters.maxCost !== undefined) count++;
    if (filters.year && filters.year !== new Date().getFullYear()) count++;
    if (filters.location) count++;
    return count;
  }, [filters]);

  const hasFilters = useMemo(() => appliedFiltersCount > 0, [appliedFiltersCount]);

  // Generate query object for API calls
  const queryFilters = useMemo(() => {
    const query: Record<string, any> = {};
    
    Object.entries(debouncedFilters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        // Ensure numeric fields are properly typed
        if (key === 'page' || key === 'limit' || key === 'year') {
          const numValue = Math.round(Number(value));
          if (!isNaN(numValue) && numValue > 0) {
            query[key] = numValue;
          }
        } else if (key === 'minCost' || key === 'maxCost' || key === 'minDensity' || key === 'maxDensity' || key === 'minMeltingTemp' || key === 'maxMeltingTemp') {
          const numValue = Number(value);
          if (!isNaN(numValue) && numValue >= 0) {
            query[key] = numValue;
          }
        } else {
          query[key] = value;
        }
      }
    });
    
    // Ensure we always have valid pagination values
    if (!query.page) query.page = 1;
    if (!query.limit) query.limit = 50;
    
    // Debug logging in development
    if (process.env.NODE_ENV === 'development') {
      console.log('Query filters being sent:', query);
    }
    
    return query;
  }, [debouncedFilters]);

  // Generate filter summary for UI
  const filterSummary = useMemo(() => {
    const summary: string[] = [];
    
    if (filters.search) {
      summary.push(`Search: "${filters.search}"`);
    }
    
    if (filters.materialCategory) {
      summary.push(`Category: ${filters.materialCategory}`);
    }
    
    if (filters.country) {
      summary.push(`Country: ${filters.country}`);
    }
    
    if (filters.shape) {
      summary.push(`Shape: ${filters.shape}`);
    }
    
    if (filters.minCost !== undefined || filters.maxCost !== undefined) {
      const min = filters.minCost ?? 0;
      const max = filters.maxCost ?? '∞';
      summary.push(`Cost: ${min} - ${max}`);
    }
    
    return summary;
  }, [filters]);

  // Validation
  const isValid = useMemo(() => {
    if (filters.minCost && filters.maxCost && filters.minCost > filters.maxCost) {
      return false;
    }
    
    return true;
  }, [filters.minCost, filters.maxCost]);

  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    
    if (filters.minCost && filters.maxCost && filters.minCost > filters.maxCost) {
      errors.push('Minimum cost cannot be greater than maximum cost');
    }
    
    return errors;
  }, [filters.minCost, filters.maxCost]);

  return {
    // State
    filters,
    debouncedFilters,
    
    // Computed values
    appliedFiltersCount,
    hasFilters,
    queryFilters,
    filterSummary,
    isValid,
    validationErrors,
    
    // Update methods
    updateFilter,
    updateFilters,
    clearFilters,
    clearFilter,
    
    // Specific field setters
    setSearch,
    setMaterialCategory,
    setCountry,
    setCurrency,
    setShape,
    setCostRange,
    setYear,
    setLocation,
    setSorting,
    setPagination
  };
};