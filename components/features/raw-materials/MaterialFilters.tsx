'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Slider } from '@/components/ui/slider';
import { 
  Search, 
  Filter, 
  MapPin, 
  DollarSign, 
  Shapes, 
  Calendar,
  ChevronDown,
  X,
  RotateCcw
} from 'lucide-react';

import {
  CURRENCY_LABELS,
  COUNTRY_LABELS,
  MATERIAL_SHAPE_LABELS,
  MATERIAL_CATEGORY_LABELS,
  Currency,
  Country,
  MaterialShape,
  MaterialCategory
} from '@/lib/constants/materials';

export interface MaterialFiltersProps {
  // Filter state
  search: string;
  materialCategory?: MaterialCategory;
  country?: Country;
  currency?: Currency;
  shape?: MaterialShape;
  minCost?: number;
  maxCost?: number;
  year?: number;
  location?: string;
  
  // Filter options (from API)
  availableLocations?: string[];
  availableYears?: number[];
  costRange?: { min: number; max: number };
  
  // Event handlers
  onSearchChange: (value: string) => void;
  onMaterialCategoryChange: (value?: MaterialCategory) => void;
  onCountryChange: (value?: Country) => void;
  onCurrencyChange: (value?: Currency) => void;
  onShapeChange: (value?: MaterialShape) => void;
  onCostRangeChange: (min?: number, max?: number) => void;
  onYearChange: (value?: number) => void;
  onLocationChange: (value?: string) => void;
  onClearFilters: () => void;
  
  // UI configuration
  compact?: boolean;
  showAdvanced?: boolean;
}

export const MaterialFilters: React.FC<MaterialFiltersProps> = ({
  search,
  materialCategory,
  country,
  currency,
  shape,
  minCost,
  maxCost,
  year,
  location,
  availableLocations = [],
  availableYears = [],
  costRange = { min: 0, max: 10000 },
  onSearchChange,
  onMaterialCategoryChange,
  onCountryChange,
  onCurrencyChange,
  onShapeChange,
  onCostRangeChange,
  onYearChange,
  onLocationChange,
  onClearFilters,
  compact = false,
  showAdvanced = true
}) => {
  const [isAdvancedOpen, setIsAdvancedOpen] = React.useState(false);
  
  // Calculate applied filters count
  const appliedFiltersCount = useMemo(() => {
    let count = 0;
    if (search) count++;
    if (materialCategory) count++;
    if (country) count++;
    if (currency) count++;
    if (shape) count++;
    if (minCost !== undefined || maxCost !== undefined) count++;
    if (year) count++;
    if (location) count++;
    return count;
  }, [search, materialCategory, country, currency, shape, minCost, maxCost, year, location]);

  // Get filtered shapes based on material category
  const getFilteredShapes = () => {
    if (!materialCategory) {
      return Object.entries(MATERIAL_SHAPE_LABELS).map(([value, label]) => ({
        value: value as MaterialShape,
        label
      }));
    }
    
    // This would use the SHAPE_CATEGORY_MAPPING from constants
    return Object.entries(MATERIAL_SHAPE_LABELS).map(([value, label]) => ({
      value: value as MaterialShape,
      label
    }));
  };

  const handleCostSliderChange = (values: number[]) => {
    const minCost = values[0];
    const maxCost = values[1];
    
    // Validate values are numbers
    if (!isNaN(minCost) && !isNaN(maxCost)) {
      onCostRangeChange(minCost, maxCost);
    }
  };

  const renderFilterSummary = () => {
    const filters: string[] = [];
    if (search) filters.push(`Search: "${search}"`);
    if (materialCategory) filters.push(`Category: ${MATERIAL_CATEGORY_LABELS[materialCategory]}`);
    if (country) filters.push(`Country: ${COUNTRY_LABELS[country]}`);
    if (shape) filters.push(`Shape: ${MATERIAL_SHAPE_LABELS[shape]}`);
    if (currency) filters.push(`Currency: ${CURRENCY_LABELS[currency]}`);
    if (minCost !== undefined || maxCost !== undefined) {
      filters.push(`Cost: ${minCost || 0} - ${maxCost || '∞'}`);
    }
    
    return filters.slice(0, 3).map((filter, index) => (
      <Badge key={index} variant="secondary" className="text-xs">
        {filter}
      </Badge>
    ));
  };

  if (compact) {
    return (
      <Card className="border-muted">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Input
                placeholder="Search materials..."
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                className="h-9"
              />
            </div>
            <Select value={country || 'all'} onValueChange={(value) => onCountryChange(value === 'all' ? undefined : value as Country)}>
              <SelectTrigger className="w-[160px] h-9">
                <SelectValue placeholder="Country" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Countries</SelectItem>
                {Object.entries(COUNTRY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {appliedFiltersCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={onClearFilters}
                className="h-9"
              >
                <X className="h-4 w-4 mr-1" />
                Clear ({appliedFiltersCount})
              </Button>
            )}
          </div>
          {appliedFiltersCount > 0 && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {renderFilterSummary()}
              {appliedFiltersCount > 3 && (
                <Badge variant="outline" className="text-xs">
                  +{appliedFiltersCount - 3} more
                </Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Primary Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Material Filters
              {appliedFiltersCount > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {appliedFiltersCount}
                </Badge>
              )}
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearFilters}
              disabled={appliedFiltersCount === 0}
              className="h-7 text-xs"
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Clear All
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-sm">
              <Search className="h-4 w-4" />
              Search Materials
            </Label>
            <Input
              placeholder="Search by name, abbreviation, grade, application..."
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-9"
            />
          </div>

          {/* Primary filters grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Material Category */}
            <div className="space-y-2">
              <Label className="text-sm">Material Category</Label>
              <Select 
                value={materialCategory || 'all'} 
                onValueChange={(value) => onMaterialCategoryChange(value === 'all' ? undefined : value as MaterialCategory)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {Object.entries(MATERIAL_CATEGORY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Country/Region */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-sm">
                <MapPin className="h-4 w-4" />
                Country/Region
              </Label>
              <Select value={country || 'all'} onValueChange={(value) => onCountryChange(value === 'all' ? undefined : value as Country)}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="All Countries" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Countries</SelectItem>
                  {Object.entries(COUNTRY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Material Shape */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-sm">
                <Shapes className="h-4 w-4" />
                Material Shape
              </Label>
              <Select value={shape || 'all'} onValueChange={(value) => onShapeChange(value === 'all' ? undefined : value as MaterialShape)}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="All Shapes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Shapes</SelectItem>
                  {getFilteredShapes().map(({ value, label }) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Advanced Filters */}
      {showAdvanced && (
        <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Advanced Filters
                  </CardTitle>
                  <ChevronDown className={`h-4 w-4 transition-transform ${isAdvancedOpen ? 'rotate-180' : ''}`} />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Cost Range */}
                  <div className="space-y-3">
                    <Label className="flex items-center gap-2 text-sm">
                      <DollarSign className="h-4 w-4" />
                      Cost Range
                    </Label>
                    <div className="space-y-3">
                      <Slider
                        value={[minCost || costRange.min, maxCost || costRange.max]}
                        min={costRange.min}
                        max={costRange.max}
                        step={0.01}
                        onValueChange={handleCostSliderChange}
                        className="w-full"
                      />
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          placeholder="Min"
                          value={minCost || ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            const numValue = value === '' ? undefined : parseFloat(value);
                            if (value === '' || !isNaN(numValue!)) {
                              onCostRangeChange(numValue, maxCost);
                            }
                          }}
                          className="h-8 text-xs"
                        />
                        <span className="text-muted-foreground text-sm">to</span>
                        <Input
                          type="number"
                          placeholder="Max"
                          value={maxCost || ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            const numValue = value === '' ? undefined : parseFloat(value);
                            if (value === '' || !isNaN(numValue!)) {
                              onCostRangeChange(minCost, numValue);
                            }
                          }}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>₹{costRange.min}</span>
                        <span>₹{costRange.max}</span>
                      </div>
                    </div>
                  </div>

                  {/* Additional filters */}
                  <div className="space-y-4">
                    {/* Currency */}
                    <div className="space-y-2">
                      <Label className="text-sm">Currency</Label>
                      <Select value={currency || 'all'} onValueChange={(value) => onCurrencyChange(value === 'all' ? undefined : value as Currency)}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="All Currencies" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Currencies</SelectItem>
                          {Object.entries(CURRENCY_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Year */}
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2 text-sm">
                        <Calendar className="h-4 w-4" />
                        Data Year
                      </Label>
                      <Select value={year?.toString() || 'all'} onValueChange={(value) => onYearChange(value === 'all' ? undefined : parseInt(value))}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="All Years" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Years</SelectItem>
                          {availableYears.map((yearOption) => (
                            <SelectItem key={yearOption} value={yearOption.toString()}>
                              {yearOption}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Location */}
                    <div className="space-y-2">
                      <Label className="text-sm">Specific Location</Label>
                      <Select value={location || 'all'} onValueChange={(value) => onLocationChange(value === 'all' ? undefined : value)}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="All Locations" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Locations</SelectItem>
                          {availableLocations.map((locationOption) => (
                            <SelectItem key={locationOption} value={locationOption}>
                              {locationOption}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* Applied Filters Summary */}
      {appliedFiltersCount > 0 && !compact && (
        <Card className="border-muted bg-muted/30">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-muted-foreground">Applied filters:</span>
                {renderFilterSummary()}
                {appliedFiltersCount > 3 && (
                  <Badge variant="outline" className="text-xs">
                    +{appliedFiltersCount - 3} more
                  </Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearFilters}
                className="h-7 text-xs"
              >
                <X className="h-3 w-3 mr-1" />
                Clear All
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};