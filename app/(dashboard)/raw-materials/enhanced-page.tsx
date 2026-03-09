'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, Upload, Download } from 'lucide-react';

import { MaterialFilters } from '@/components/features/raw-materials/MaterialFilters';
import { useMaterialFilters } from '@/lib/hooks/useMaterialFilters';
import {
  useRawMaterials,
  useRawMaterialFilterOptions,
  useUploadRawMaterialsExcel,
  useCreateRawMaterial,
  useUpdateRawMaterial,
  useDeleteRawMaterial,
  type RawMaterial,
} from '@/lib/api/hooks/useRawMaterials';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import {
  CURRENCY_SYMBOLS,
  MATERIAL_SHAPE_LABELS,
  COUNTRY_LABELS,
  Currency,
  Country,
  MaterialShape,
  MaterialCategory
} from '@/lib/constants/materials';

export default function EnhancedRawMaterialsPage() {
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);

  // Initialize filter state with smart defaults
  const {
    filters,
    appliedFiltersCount,
    hasFilters,
    queryFilters,
    filterSummary,
    isValid,
    validationErrors,
    setSearch,
    setMaterialCategory,
    setCountry,
    setCurrency,
    setShape,
    setCostRange,
    setYear,
    setLocation,
    setSorting,
    clearFilters,
  } = useMaterialFilters({
    initialFilters: {
      year: new Date().getFullYear()
    },
    autoSyncCurrency: true
  });

  // API hooks
  const { data: rawMaterialsData, isLoading } = useRawMaterials(queryFilters);
  const { data: filterOptions } = useRawMaterialFilterOptions();
  const uploadMutation = useUploadRawMaterialsExcel();

  const rawMaterials = rawMaterialsData?.items || [];
  const totalCount = rawMaterialsData?.total || 0;

  const handleToggleSort = (column: string) => {
    setSorting(column);
  };

  const renderCostDisplay = (material: RawMaterial) => {
    if (!material.unitCost) return '-';
    
    const symbol = material.currency ? CURRENCY_SYMBOLS[material.currency] : '₹';
    return `${symbol}${material.unitCost.toFixed(2)}`;
  };

  // Check if material is plastic or rubber to show enhanced columns
  const isPlasticOrRubber = (materialGroup: string) => {
    return materialGroup?.toLowerCase().includes('plastic') || 
           materialGroup?.toLowerCase().includes('rubber');
  };

  // Check if any materials in the current view are plastic/rubber
  const hasPlasticOrRubberMaterials = rawMaterials.some(material => 
    isPlasticOrRubber(material.materialGroup)
  );

  const renderLocationDisplay = (material: RawMaterial) => {
    if (material.country) {
      return COUNTRY_LABELS[material.country];
    }
    return material.location || '-';
  };

  const renderShapeDisplay = (material: RawMaterial) => {
    if (!material.shape) return '-';
    return MATERIAL_SHAPE_LABELS[material.shape];
  };

  // Show validation errors
  if (!isValid && validationErrors.length > 0) {
    validationErrors.forEach(error => {
      toast.error(error);
    });
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Enhanced Raw Materials Database"
        description="Advanced material properties and cost data with intelligent filtering"
      >
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setUploadDialogOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Upload Excel
          </Button>
          <Button onClick={() => {/* Handle create */}}>
            <Plus className="h-4 w-4 mr-2" />
            Add Material
          </Button>
        </div>
      </PageHeader>

      {/* Enhanced Material Filters */}
      <MaterialFilters
        search={filters.search}
        materialCategory={filters.materialCategory}
        country={filters.country}
        currency={filters.currency}
        shape={filters.shape}
        minCost={filters.minCost}
        maxCost={filters.maxCost}
        year={filters.year}
        location={filters.location}
        availableLocations={filterOptions?.locations || []}
        availableYears={filterOptions?.years || []}
        costRange={filterOptions?.costRange || { min: 0, max: 10000 }}
        onSearchChange={setSearch}
        onMaterialCategoryChange={setMaterialCategory}
        onCountryChange={setCountry}
        onCurrencyChange={setCurrency}
        onShapeChange={setShape}
        onCostRangeChange={setCostRange}
        onYearChange={setYear}
        onLocationChange={setLocation}
        onClearFilters={clearFilters}
        showAdvanced={true}
      />

      {/* Filter Summary */}
      {hasFilters && (
        <Card className="p-3 bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                {appliedFiltersCount} filter{appliedFiltersCount > 1 ? 's' : ''} applied
              </Badge>
              <div className="text-sm text-blue-800 dark:text-blue-200">
                Showing {rawMaterials.length} of {totalCount} materials
              </div>
            </div>
            <div className="flex items-center gap-2">
              {filterSummary.slice(0, 2).map((summary, index) => (
                <Badge key={index} variant="outline" className="text-xs border-blue-300 text-blue-700">
                  {summary}
                </Badge>
              ))}
              {filterSummary.length > 2 && (
                <Badge variant="outline" className="text-xs border-blue-300 text-blue-700">
                  +{filterSummary.length - 2} more
                </Badge>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Results Summary */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {rawMaterials.length} of {totalCount} materials
          {hasFilters && (
            <span className="ml-1 text-blue-600 dark:text-blue-400">
              (filtered)
            </span>
          )}
        </p>
        
        {rawMaterials.length > 0 && (
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export Results
          </Button>
        )}
      </div>

      {/* Enhanced Data Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-card hover:bg-card">
                <TableHead 
                  className="cursor-pointer h-9 px-2 text-xs" 
                  onClick={() => handleToggleSort('materialGroup')}
                >
                  <div className="flex items-center font-semibold">
                    Group
                  </div>
                </TableHead>
                <TableHead 
                  className="cursor-pointer h-9 px-2 text-xs" 
                  onClick={() => handleToggleSort('material')}
                >
                  <div className="flex items-center font-semibold">
                    Material
                  </div>
                </TableHead>
                <TableHead className="h-9 px-2 text-xs">Abbr</TableHead>
                <TableHead className="h-9 px-2 text-xs">Grade</TableHead>
                {hasPlasticOrRubberMaterials && (
                  <>
                    <TableHead className="h-9 px-2 text-xs">Shape</TableHead>
                    <TableHead className="h-9 px-2 text-xs">Application</TableHead>
                    <TableHead className="h-9 px-2 text-xs">Regrind</TableHead>
                  </>
                )}
                <TableHead className="text-right h-9 px-2 text-xs">Density</TableHead>
                {hasPlasticOrRubberMaterials && (
                  <>
                    <TableHead className="h-9 px-2 text-xs">Country</TableHead>
                    <TableHead className="text-right h-9 px-2 text-xs">Melting Temp</TableHead>
                    <TableHead className="text-right h-9 px-2 text-xs">Cost</TableHead>
                  </>
                )}
                <TableHead className="h-9 px-2 text-xs">Year</TableHead>
                <TableHead className="w-20 h-9 px-2 text-xs">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={hasPlasticOrRubberMaterials ? 13 : 7} className="text-center py-8 text-muted-foreground">
                    Loading materials...
                  </TableCell>
                </TableRow>
              ) : rawMaterials.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={hasPlasticOrRubberMaterials ? 13 : 7} className="text-center py-12 text-muted-foreground">
                    <div className="space-y-2">
                      <div className="text-lg font-medium">No materials found</div>
                      <div className="text-sm">
                        {hasFilters 
                          ? "Try adjusting your filters or upload new materials to get started."
                          : "Upload an Excel file to get started."
                        }
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                rawMaterials.map((material) => {
                  const isPlasticRubber = isPlasticOrRubber(material.materialGroup);
                  
                  return (
                    <TableRow key={material.id} className="hover:bg-secondary/30">
                      <TableCell className="font-medium p-2 text-xs">
                        <Badge 
                          variant="outline" 
                          className={`text-[10px] px-1 py-0 h-5 ${
                            isPlasticRubber 
                              ? 'border-blue-500 text-blue-700' 
                              : 'border-orange-500 text-orange-700'
                          }`}
                        >
                          {material.materialGroup}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium p-2 text-xs truncate max-w-[120px]" title={material.material}>
                        {material.material}
                      </TableCell>
                      <TableCell className="text-muted-foreground p-2 text-xs">
                        {material.materialAbbreviation || '-'}
                      </TableCell>
                      <TableCell className="p-2 text-xs truncate max-w-[100px]" title={material.materialGrade || ''}>
                        {material.materialGrade || '-'}
                      </TableCell>
                      {hasPlasticOrRubberMaterials && (
                        <>
                          <TableCell className="p-2 text-xs">
                            {renderShapeDisplay(material)}
                          </TableCell>
                          <TableCell className="p-2 text-xs truncate max-w-[120px]" title={material.application || ''}>
                            {material.application || '-'}
                          </TableCell>
                          <TableCell className="p-2 text-xs">
                            {material.regrinding || '-'}
                            {material.regrindingPercentage && (
                              <span className="text-muted-foreground ml-1">
                                ({material.regrindingPercentage}%)
                              </span>
                            )}
                          </TableCell>
                        </>
                      )}
                      <TableCell className="text-right p-2 text-xs">
                        {material.densityKgM3?.toFixed(0) || '-'}
                        {material.densityKgM3 && (
                          <span className="text-muted-foreground ml-1">kg/m³</span>
                        )}
                      </TableCell>
                      {hasPlasticOrRubberMaterials && (
                        <>
                          <TableCell className="p-2 text-xs">
                            {renderLocationDisplay(material)}
                          </TableCell>
                          <TableCell className="text-right p-2 text-xs">
                            {material.meltingTempC?.toFixed(0) || '-'}
                            {material.meltingTempC && (
                              <span className="text-muted-foreground ml-1">°C</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right p-2 text-xs font-mono">
                            {renderCostDisplay(material)}
                          </TableCell>
                        </>
                      )}
                      <TableCell className="p-2 text-xs">{material.year || '-'}</TableCell>
                      <TableCell className="p-2 text-xs">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {/* Handle edit */}}
                            className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950"
                          >
                            <span className="sr-only">Edit</span>
                            ✏️
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {/* Handle delete */}}
                            className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                          >
                            <span className="sr-only">Delete</span>
                            🗑️
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Performance Metrics (for development) */}
      {process.env.NODE_ENV === 'development' && (
        <Card className="p-3 bg-gray-50 dark:bg-gray-950/20 border-gray-200 dark:border-gray-800">
          <div className="text-xs text-muted-foreground space-y-1">
            <div>Filters applied: {appliedFiltersCount}</div>
            <div>Total materials: {totalCount}</div>
            <div>Filtered results: {rawMaterials.length}</div>
            <div>Filter summary: {filterSummary.join(', ') || 'None'}</div>
            <div>Query valid: {isValid ? 'Yes' : 'No'}</div>
          </div>
        </Card>
      )}
    </div>
  );
}