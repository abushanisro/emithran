import { Injectable } from '@nestjs/common';
import { 
  RawMaterialFilters, 
  FilterResult, 
  FilterPagination, 
  FilterMetadata, 
  FilterGroup, 
  FilterOption 
} from '../types/filter.types';
import { 
  Currency, 
  Country,
  MaterialShape, 
  MaterialCategory,
  CURRENCY_LABELS,
  COUNTRY_LABELS,
  MATERIAL_SHAPE_LABELS,
  MATERIAL_CATEGORY_LABELS,
  SHAPE_CATEGORY_MAPPING,
  COUNTRY_DEFAULT_CURRENCY
} from '../constants/material-categories.constants';

@Injectable()
export class RawMaterialFilterService {
  
  /**
   * Validates filter parameters and returns validation errors if any
   */
  validateFilters(filters: RawMaterialFilters): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate cost range
    if (filters.minCost && filters.maxCost && filters.minCost > filters.maxCost) {
      errors.push('Minimum cost cannot be greater than maximum cost');
    }

    // Validate density range
    if (filters.minDensity && filters.maxDensity && filters.minDensity > filters.maxDensity) {
      errors.push('Minimum density cannot be greater than maximum density');
    }

    // Validate temperature range
    if (filters.minMeltingTemp && filters.maxMeltingTemp && filters.minMeltingTemp > filters.maxMeltingTemp) {
      errors.push('Minimum melting temperature cannot be greater than maximum melting temperature');
    }


    // Validate shape-category compatibility
    if (filters.shape && filters.materialCategory) {
      const compatibleCategories = SHAPE_CATEGORY_MAPPING[filters.shape];
      if (!compatibleCategories.includes(filters.materialCategory)) {
        errors.push(`Shape ${filters.shape} is not compatible with material category ${filters.materialCategory}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }


  /**
   * Filters shapes based on selected material category
   */
  getShapesForCategory(category?: MaterialCategory): FilterOption<MaterialShape>[] {
    if (!category) {
      return Object.entries(MATERIAL_SHAPE_LABELS).map(([value, label]) => ({
        value: value as MaterialShape,
        label
      }));
    }

    return Object.entries(SHAPE_CATEGORY_MAPPING)
      .filter(([_, categories]) => categories.includes(category))
      .map(([shape, _]) => ({
        value: shape as MaterialShape,
        label: MATERIAL_SHAPE_LABELS[shape as MaterialShape]
      }));
  }

  /**
   * Builds optimized database query conditions from filters
   */
  buildQueryConditions(filters: RawMaterialFilters): Record<string, any> {
    const conditions: Record<string, any> = {};

    // Text search across multiple fields
    if (filters.search) {
      conditions.or = [
        { materialGroup: { ilike: `%${filters.search}%` } },
        { material: { ilike: `%${filters.search}%` } },
        { materialGrade: { ilike: `%${filters.search}%` } },
        { application: { ilike: `%${filters.search}%` } }
      ];
    }

    // Exact matches
    if (filters.materialGroup) conditions.materialGroup = filters.materialGroup;
    if (filters.material) conditions.material = filters.material;
    if (filters.location) conditions.location = filters.location;
    if (filters.currency) conditions.currency = filters.currency;
    if (filters.shape) conditions.shape = filters.shape;
    if (filters.regrinding) conditions.regrinding = filters.regrinding;
    if (filters.stockForm) conditions.stockForm = filters.stockForm;

    // Range filters
    if (filters.minCost || filters.maxCost) {
      conditions.unitCost = {};
      if (filters.minCost) conditions.unitCost.gte = filters.minCost;
      if (filters.maxCost) conditions.unitCost.lte = filters.maxCost;
    }

    if (filters.minDensity || filters.maxDensity) {
      conditions.densityKgM3 = {};
      if (filters.minDensity) conditions.densityKgM3.gte = filters.minDensity;
      if (filters.maxDensity) conditions.densityKgM3.lte = filters.maxDensity;
    }

    if (filters.minMeltingTemp || filters.maxMeltingTemp) {
      conditions.meltingTempC = {};
      if (filters.minMeltingTemp) conditions.meltingTempC.gte = filters.minMeltingTemp;
      if (filters.maxMeltingTemp) conditions.meltingTempC.lte = filters.maxMeltingTemp;
    }

    return conditions;
  }

  /**
   * Generates filter metadata including options and ranges
   */
  generateFilterMetadata(): FilterMetadata {
    const filterGroups: FilterGroup[] = [
      {
        key: 'search',
        label: 'Search Materials',
        type: 'search',
        placeholder: 'Search by name, abbreviation, or application...',
        description: 'Search across material names, abbreviations, and applications'
      },
      {
        key: 'materialCategory',
        label: 'Material Category',
        type: 'select',
        options: Object.entries(MATERIAL_CATEGORY_LABELS).map(([value, label]) => ({
          value,
          label
        }))
      },
      {
        key: 'currency',
        label: 'Currency',
        type: 'select',
        options: Object.entries(CURRENCY_LABELS).map(([value, label]) => ({
          value,
          label
        }))
      },
      {
        key: 'shape',
        label: 'Material Shape',
        type: 'select',
        options: Object.entries(MATERIAL_SHAPE_LABELS).map(([value, label]) => ({
          value,
          label
        }))
      },
      {
        key: 'minCost',
        label: 'Cost Range',
        type: 'range',
        min: 0,
        max: 10000,
        step: 0.01,
        description: 'Filter by unit cost range'
      },
      {
        key: 'regrinding',
        label: 'Regrinding Available',
        type: 'toggle',
        options: [
          { value: 'Yes', label: 'Yes' },
          { value: 'No', label: 'No' }
        ]
      },
    ];

    return {
      groups: filterGroups,
      availableShapes: Object.entries(MATERIAL_SHAPE_LABELS).map(([value, label]) => ({
        value: value as MaterialShape,
        label
      })),
      availableCountries: Object.entries(COUNTRY_LABELS).map(([value, label]) => ({
        value: value as Country,
        label
      })),
      availableCurrencies: Object.entries(CURRENCY_LABELS).map(([value, label]) => ({
        value: value as Currency,
        label
      })),
      costRange: { min: 0, max: 10000 },
      densityRange: { min: 0, max: 20000 },
      temperatureRange: { min: 0, max: 3000 }
    };
  }

  /**
   * Applies smart defaults based on user context or previous selections
   */
  applySmartDefaults(filters: RawMaterialFilters, userContext?: any): RawMaterialFilters {
    const smartFilters = { ...filters };

    // Default to INR currency
    if (!smartFilters.currency) {
      smartFilters.currency = Currency.INR;
    }

    return smartFilters;
  }

  /**
   * Counts applied filters for UI feedback
   */
  getAppliedFiltersCount(filters: RawMaterialFilters): number {
    return Object.entries(filters)
      .filter(([key, value]) => 
        value !== undefined && 
        value !== null && 
        value !== '' &&
        // Exclude pagination and sorting from count
        !['sortBy', 'sortOrder'].includes(key)
      ).length;
  }

  /**
   * Generates human-readable filter summary
   */
  getFilterSummary(filters: RawMaterialFilters): string[] {
    const summary: string[] = [];

    if (filters.search) {
      summary.push(`Search: "${filters.search}"`);
    }

    if (filters.country) {
      summary.push(`Country: ${COUNTRY_LABELS[filters.country]}`);
    }

    if (filters.materialCategory) {
      summary.push(`Category: ${MATERIAL_CATEGORY_LABELS[filters.materialCategory]}`);
    }

    if (filters.shape) {
      summary.push(`Shape: ${MATERIAL_SHAPE_LABELS[filters.shape]}`);
    }

    if (filters.currency) {
      summary.push(`Currency: ${CURRENCY_LABELS[filters.currency]}`);
    }

    if (filters.minCost || filters.maxCost) {
      const minCost = filters.minCost || 0;
      const maxCost = filters.maxCost || '∞';
      summary.push(`Cost: ${minCost} - ${maxCost}`);
    }

    if (filters.regrinding) {
      summary.push(`Regrinding: ${filters.regrinding}`);
    }

    if (filters.year) {
      summary.push(`Year: ${filters.year}`);
    }

    return summary;
  }

  /**
   * Optimizes filter query for performance
   */
  optimizeFiltersForQuery(filters: RawMaterialFilters): RawMaterialFilters {
    const optimized = { ...filters };

    // Remove empty or default values to reduce query complexity
    Object.keys(optimized).forEach(key => {
      const value = optimized[key as keyof RawMaterialFilters];
      if (value === undefined || value === null || value === '') {
        delete optimized[key as keyof RawMaterialFilters];
      }
    });

    return optimized;
  }
}