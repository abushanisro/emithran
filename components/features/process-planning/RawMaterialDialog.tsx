'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useRawMaterials, useRawMaterialFilterOptions } from '@/lib/api/hooks/useRawMaterials';
import { useCalculators, useCalculator, useExecuteCalculator } from '@/lib/api/hooks/useCalculators';
import { Loader2, Calculator as CalculatorIcon, Play, Eye } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface RawMaterialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  estimateId?: string;
  editData?: any;
  bomItemData?: any;
}

export function RawMaterialDialog({
  open,
  onOpenChange,
  onSubmit,
  editData,
  bomItemData,
}: RawMaterialDialogProps) {
  const [materialGroup, setMaterialGroup] = useState<string>('');
  const [location, setLocation] = useState<string>('');
  const [selectedQuarter, setSelectedQuarter] = useState<string>('q1');
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>('');
  const [grossUsage, setGrossUsage] = useState<number>(0);
  const [netUsage, setNetUsage] = useState<number>(0);
  const [scrap, setScrap] = useState<number>(0);
  const [overhead, setOverhead] = useState<number>(0);
  const [totalCost, setTotalCost] = useState<number>(0);

  // Calculator state
  const [calculatorOpen, setCalculatorOpen] = useState<boolean>(false);
  const [calculatorTarget, setCalculatorTarget] = useState<'grossUsage' | 'netUsage' | null>(null);
  const [selectedCalculatorId, setSelectedCalculatorId] = useState<string>('');
  const [calculatorInputs, setCalculatorInputs] = useState<Record<string, any>>({});
  const [calculatorResults, setCalculatorResults] = useState<Record<string, any> | null>(null);

  // Lookup table state
  const [selectedLookupField, setSelectedLookupField] = useState<any>(null);
  const [showLookupTable, setShowLookupTable] = useState<boolean>(false);
  const [lookupTableData, setLookupTableData] = useState<any>(null);

  // Fetch calculators
  const { data: calculatorsData } = useCalculators();
  const { data: selectedCalculator } = useCalculator(selectedCalculatorId, { enabled: !!selectedCalculatorId });
  const executeCalculator = useExecuteCalculator();

  // Auto-populate calculator inputs from BOM data
  const autoPopulateFromBOM = () => {
    if (!bomItemData || !selectedCalculator) return;

    const bomFieldMapping: Record<string, any> = {
      // Weight mappings
      'weight': bomItemData.weight || bomItemData.unitWeight,
      'unitWeight': bomItemData.unitWeight || bomItemData.weight,
      'Weight': bomItemData.weight || bomItemData.unitWeight,
      'Weight(kg)': bomItemData.weight || bomItemData.unitWeight,
      
      // Dimension mappings
      'length': bomItemData.length || bomItemData.maxLength,
      'maxLength': bomItemData.maxLength || bomItemData.length,
      'Length': bomItemData.length || bomItemData.maxLength,
      'Max Length': bomItemData.maxLength || bomItemData.length,
      'Max Length(mm)': bomItemData.maxLength || bomItemData.length,
      
      'width': bomItemData.width || bomItemData.maxWidth,
      'maxWidth': bomItemData.maxWidth || bomItemData.width,
      'Width': bomItemData.width || bomItemData.maxWidth,
      'Max Width': bomItemData.maxWidth || bomItemData.width,
      'Max Width(mm)': bomItemData.maxWidth || bomItemData.width,
      
      'height': bomItemData.height || bomItemData.maxHeight,
      'maxHeight': bomItemData.maxHeight || bomItemData.height,
      'Height': bomItemData.height || bomItemData.maxHeight,
      'Max Height': bomItemData.maxHeight || bomItemData.height,
      'Max Height(mm)': bomItemData.maxHeight || bomItemData.height,
      
      // Surface area mapping
      'surfaceArea': bomItemData.surfaceArea,
      'Surface Area': bomItemData.surfaceArea,
      'Surface Area(mm²)': bomItemData.surfaceArea,
    };

    const newInputs: Record<string, any> = { ...calculatorInputs };

    selectedCalculator.fields
      ?.filter((field: any) => field.fieldType !== 'calculated')
      .forEach((field: any) => {
        const fieldName = field.fieldName;
        const displayName = field.displayLabel || field.displayName;

        // Try to match by field name or display name
        const bomValue = bomFieldMapping[fieldName] || bomFieldMapping[displayName];
        
        if (bomValue !== undefined && bomValue !== null && bomValue !== '') {
          newInputs[fieldName] = typeof bomValue === 'number' ? bomValue : parseFloat(bomValue) || 0;
        }
      });

    setCalculatorInputs(newInputs);
  };

  // Auto-populate when calculator or BOM data changes
  useEffect(() => {
    if (selectedCalculator && bomItemData) {
      autoPopulateFromBOM();
    }
  }, [selectedCalculator?.id, bomItemData?.id, calculatorTarget]);

  // Also auto-populate when dialog opens with calculator already selected
  useEffect(() => {
    if (open && selectedCalculatorId && bomItemData) {
      // Small delay to ensure calculator data is loaded
      setTimeout(autoPopulateFromBOM, 100);
    }
  }, [open, selectedCalculatorId, bomItemData?.id]);

  // Handle calculator value selection
  const handleUseCalculatorValue = (value: number) => {
    if (calculatorTarget === 'grossUsage') {
      setGrossUsage(value);
    } else if (calculatorTarget === 'netUsage') {
      setNetUsage(value);
    }
    // Close calculator when "Use" button is clicked
    setCalculatorOpen(false);
    setCalculatorResults(null);
    setCalculatorInputs({});
    setSelectedCalculatorId('');
  };

  // Handle calculator execution
  const handleExecuteCalculator = async () => {
    if (!selectedCalculatorId) return;

    try {
      const result = await executeCalculator.mutateAsync({
        calculatorId: selectedCalculatorId,
        inputValues: calculatorInputs,
      });

      if (result.success) {
        setCalculatorResults(result.results);
      }
    } catch (error) {
      console.error('Calculator execution error:', error);
    }
  };

  // Handle viewing lookup table
  const handleViewLookupTable = async (field: any) => {
    console.log('Opening lookup table for field:', field.fieldName);
    setSelectedLookupField(field);

    try {
      const { processesApi } = await import('@/lib/api/processes');

      // Case 1: sourceField is set — fetch by table ID directly
      if (field.sourceField) {
        let tableId = field.sourceField;
        if (field.sourceField.startsWith('from_')) {
          tableId = field.sourceField.replace('from_', '');
        }

        const table = await processesApi.getReferenceTable(tableId);
        if (table) {
          const processedRows = table.rows?.map((row: any) =>
            row.rowData ? row.rowData : row
          ) || [];
          const tableData = {
            fieldName: field.fieldName,
            fieldLabel: field.displayLabel || field.fieldName,
            tableName: table.tableName,
            tableId: table.id,
            column_definitions: table.columnDefinitions || [],
            rows: processedRows,
          };
          console.log('Setting lookup table data:', tableData);
          setLookupTableData(tableData);
          setShowLookupTable(true);
          return;
        }
      }

      // Case 2: Find reference table by matching field label
      const processId: string | undefined =
        (selectedCalculator as any)?.associatedProcessId ||
        (selectedCalculator as any)?.processId;

      if (processId) {
        const tables = await processesApi.getReferenceTables(processId);
        const fieldLabel = (field.displayLabel || field.fieldName || '').toLowerCase();
        const fieldName = (field.fieldName || '').toLowerCase();
        
        let matched = tables.find((t: any) => {
          const tableName = (t.tableName || '').toLowerCase();
          
          // Direct matches
          if (tableName.includes(fieldLabel) || fieldLabel.includes(tableName)) return true;
          if (tableName.includes(fieldName) || fieldName.includes(tableName)) return true;
          
          // Special cases for common field types
          if (fieldName.includes('viscosity') && tableName.includes('viscosity')) return true;
          if (fieldName.includes('gross') && tableName.includes('weight')) return true;
          if (fieldName.includes('usage') && tableName.includes('weight')) return true;
          if (fieldName.includes('density') && tableName.includes('density')) return true;
          
          return false;
        });
        
        if (!matched && tables.length === 1) {
          matched = tables[0];
        }

        if (matched) {
          const processedRows = matched.rows?.map((row: any) =>
            row.rowData ? row.rowData : row
          ) || [];
          setLookupTableData({
            fieldName: field.fieldName,
            fieldLabel: field.displayLabel || field.fieldName,
            tableName: matched.tableName,
            tableId: matched.id,
            column_definitions: matched.columnDefinitions || [],
            rows: processedRows,
          });
          setShowLookupTable(true);
          return;
        }
      }

      console.error('Could not resolve reference table for field:', field);
    } catch (error) {
      console.error('Failed to fetch table for field:', field.fieldName, error);
    }
  };

  // Reset calculator when closed
  useEffect(() => {
    if (!calculatorOpen) {
      setSelectedCalculatorId('');
      setCalculatorInputs({});
      setCalculatorResults(null);
      // Don't auto-close lookup table - let user control it independently
    }
  }, [calculatorOpen]);

  // Control page scroll when calculator is open
  useEffect(() => {
    if (calculatorOpen) {
      document.body.classList.add('overflow-hidden');
    } else {
      document.body.classList.remove('overflow-hidden');
    }
    
    return () => {
      document.body.classList.remove('overflow-hidden');
    };
  }, [calculatorOpen]);

  // Fetch raw materials from API
  const { data: rawMaterialsData, isLoading } = useRawMaterials();
  const { data: filterOptions, isLoading: isLoadingOptions } = useRawMaterialFilterOptions();

  // Debug logging

  // Get unique material groups
  const materialGroups = useMemo(() => {
    return filterOptions?.materialGroups || [];
  }, [filterOptions]);

  // Get unique locations
  const locations = useMemo(() => {
    return filterOptions?.locations || [];
  }, [filterOptions]);

  // Get materials filtered by selected group and location
  const materials = useMemo(() => {
    if (!rawMaterialsData?.items || !materialGroup) return [];
    let filtered = rawMaterialsData.items.filter(m => m.materialGroup === materialGroup);

    // Apply location filter if selected
    if (location) {
      filtered = filtered.filter(m => m.location === location);
    }

    return filtered;
  }, [rawMaterialsData, materialGroup, location]);

  // Get selected material details
  const selectedMaterial = useMemo(() => {
    if (!selectedMaterialId || !materials.length) return null;
    return materials.find(m => m.id === selectedMaterialId);
  }, [selectedMaterialId, materials]);

  // Load edit data first (wait for data to be loaded AND options to be available)
  useEffect(() => {
    if (editData && open && !isLoading && !isLoadingOptions && materialGroups.length > 0) {
      setMaterialGroup(editData.materialGroup || '');
      setLocation(editData.location || '');
      setSelectedQuarter(editData.quarter || 'q1');
      setSelectedMaterialId(editData.materialId || '');
      setGrossUsage(editData.grossUsage || 0);
      setNetUsage(editData.netUsage || 0);
      setScrap(editData.scrap ?? 0);
      setOverhead(editData.overhead ?? 0);
      setTotalCost(editData.totalCost || 0);
    } else if (!editData && open) {
      // Reset for new entry
      setMaterialGroup('');
      setLocation('');
      setSelectedQuarter('q1');
      setSelectedMaterialId('');
      setGrossUsage(0);
      setNetUsage(0);
      setScrap(0);
      setOverhead(0);
      setTotalCost(0);
    }
  }, [editData, open, isLoading, isLoadingOptions, materialGroups]);

  // Reset material selection when filters change (but not during initial load with editData)
  useEffect(() => {
    if (!editData) {
      setSelectedMaterialId('');
    }
  }, [materialGroup, location, editData]);

  // Calculate total cost based on selected quarter
  useEffect(() => {
    if (selectedMaterial && grossUsage > 0) {
      // Get unit cost from selected quarter
      const unitCost =
        selectedQuarter === 'q1' ? selectedMaterial.q1Cost :
        selectedQuarter === 'q2' ? selectedMaterial.q2Cost :
        selectedQuarter === 'q3' ? selectedMaterial.q3Cost :
        selectedQuarter === 'q4' ? selectedMaterial.q4Cost : 0;

      if (!unitCost) {
        setTotalCost(0);
        return;
      }

      const materialCost = grossUsage * unitCost;
      const scrapCost = (materialCost * scrap) / 100;
      const overheadCost = (materialCost * overhead) / 100;
      const total = materialCost + scrapCost + overheadCost;
      setTotalCost(Math.max(0, total));
    } else {
      setTotalCost(0);
    }
  }, [selectedMaterial, selectedQuarter, grossUsage, netUsage, scrap, overhead]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // For editing, we can submit even if selectedMaterial is not loaded yet
    if (editData) {
      // Use editData information if selectedMaterial is not available
      const materialInfo = selectedMaterial || {
        id: editData.materialId,
        material: editData.material,
        materialGroup: editData.materialGroup,
        materialGrade: editData.materialGrade || '',
        location: editData.location || '',
        q1Cost: 0,
        q2Cost: 0,
        q3Cost: 0,
        q4Cost: 0,
      };

      onSubmit({
        id: editData.id,
        materialId: editData.materialId || selectedMaterialId,
        materialName: materialInfo.material,
        materialGroup: materialInfo.materialGroup,
        material: materialInfo.material,
        materialGrade: materialInfo.materialGrade || '',
        location: materialInfo.location || '',
        quarter: selectedQuarter,
        unitCost: editData.unitCost, // Use the stored unit cost from editData
        grossUsage,
        netUsage,
        scrap,
        overhead,
        totalCost,
      });
    } else {
      // For new material, require selectedMaterial
      if (!materialGroup) {
        return;
      }
      if (!selectedMaterialId || !selectedMaterial) {
        return;
      }
      if (grossUsage <= 0) {
        return;
      }

      // Get unit cost from selected quarter
      const unitCost =
        selectedQuarter === 'q1' ? selectedMaterial.q1Cost :
        selectedQuarter === 'q2' ? selectedMaterial.q2Cost :
        selectedQuarter === 'q3' ? selectedMaterial.q3Cost :
        selectedQuarter === 'q4' ? selectedMaterial.q4Cost : 0;

      onSubmit({
        materialId: selectedMaterialId,
        materialName: selectedMaterial.material,
        materialGroup: selectedMaterial.materialGroup,
        material: selectedMaterial.material,
        materialGrade: selectedMaterial.materialGrade || '',
        location: selectedMaterial.location || '',
        quarter: selectedQuarter,
        unitCost,
        grossUsage,
        netUsage,
        scrap,
        overhead,
        totalCost,
      });
    }

    // Reset form
    setMaterialGroup('');
    setLocation('');
    setSelectedQuarter('q1');
    setSelectedMaterialId('');
    setGrossUsage(0);
    setNetUsage(0);
    setScrap(0);
    setOverhead(0);
    setTotalCost(0);
    onOpenChange(false);
  };

  return (
    <Dialog 
      open={open} 
      modal={false}
      onOpenChange={(openState) => {
        // Prevent closing if calculator is open
        if (!openState && calculatorOpen) {
          console.log('Preventing main dialog close because calculator is open');
          return;
        }
        onOpenChange(openState);
      }}
    >
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-primary">
            {editData ? 'Edit Material Cost' : 'Create Material Cost'}
          </DialogTitle>
          <DialogDescription>
            Select raw materials and calculate costs with weight and scrap factors
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(90vh-120px)] overflow-y-auto">
          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
            {/* Loading State */}
            {(isLoading || isLoadingOptions) && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="ml-2 text-muted-foreground">Loading materials...</span>
              </div>
            )}

            {!isLoading && !isLoadingOptions && (
              <>
                {/* Info Banner - Show when no data available */}
                {materialGroups.length === 0 && (
                  <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
                    <CardContent className="pt-4 pb-4">
                      <div className="flex gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                        </svg>
                        <div className="flex-1">
                          <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-1">
                            No Raw Materials Available
                          </h4>
                          <p className="text-xs text-blue-700 dark:text-blue-300">
                            There are no raw materials in your database yet. Please add raw materials by uploading an Excel file or creating them manually in the Raw Materials management page.
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Filters Row */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Material Group */}
                  <div className="space-y-2">
                    <label className="text-sm font-semibold">Material Group</label>
                    <Select value={materialGroup} onValueChange={setMaterialGroup}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select material group" />
                      </SelectTrigger>
                      <SelectContent>
                        {materialGroups.length > 0 ? (
                          materialGroups.map((group) => (
                            <SelectItem key={group} value={group}>
                              {group}
                            </SelectItem>
                          ))
                        ) : (
                          <SelectItem key="no-groups" value="none" disabled>
                            No material groups available
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Location Filter */}
                  <div className="space-y-2">
                    <label className="text-sm font-semibold">
                      Location <span className="text-muted-foreground text-xs">(Optional)</span>
                    </label>
                    <div className="flex gap-2">
                      <Select value={location} onValueChange={setLocation}>
                        <SelectTrigger>
                          <SelectValue placeholder="All locations" />
                        </SelectTrigger>
                        <SelectContent>
                          {locations.length > 0 ? (
                            locations.map((loc) => (
                              <SelectItem key={loc} value={loc}>
                                {loc}
                              </SelectItem>
                            ))
                          ) : (
                            <SelectItem key="no-locations" value="none" disabled>
                              No locations available
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                      {location && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setLocation('')}
                          className="px-3"
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Material Selection */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold">
                    Material
                    {!materialGroup && (
                      <span className="ml-2 text-xs text-muted-foreground font-normal">
                        (Select material group first)
                      </span>
                    )}
                  </label>
                  <Select
                    value={selectedMaterialId}
                    onValueChange={setSelectedMaterialId}
                    disabled={!materialGroup}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={materialGroup ? "Select material" : "Select material group first"} />
                    </SelectTrigger>
                    <SelectContent>
                      {materials.length > 0 ? (
                        materials.map((material) => (
                          <SelectItem key={material.id} value={material.id}>
                            {material.material} {material.materialGrade ? `(${material.materialGrade})` : ''}
                            {material.location ? ` - ${material.location}` : ''}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem key="no-materials" value="none" disabled>
                          {materialGroup ? 'No materials available' : 'Select material group first'}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {/* Material Details and Quarter Selection */}
            {selectedMaterial && (
              <div className="space-y-2 bg-secondary/20 p-4 rounded-lg">
                <label className="text-sm font-semibold block">Material Details</label>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Material:</span>
                    <span className="ml-2 font-medium">{selectedMaterial.material}</span>
                  </div>
                  {selectedMaterial.materialGrade && (
                    <div>
                      <span className="text-muted-foreground">Grade:</span>
                      <span className="ml-2 font-medium">{selectedMaterial.materialGrade}</span>
                    </div>
                  )}
                  {selectedMaterial.location && (
                    <div>
                      <span className="text-muted-foreground">Location:</span>
                      <span className="ml-2 font-medium">{selectedMaterial.location}</span>
                    </div>
                  )}
                  {selectedMaterial.densityKgM3 && (
                    <div>
                      <span className="text-muted-foreground">Density:</span>
                      <span className="ml-2 font-medium">{selectedMaterial.densityKgM3} kg/m³</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Quarter Selection with Cost Preview */}
            <div className="space-y-2">
              <label className="text-sm font-semibold">Select Quarter & Cost</label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: 'q1', label: 'Q1', cost: selectedMaterial?.q1Cost },
                  { value: 'q2', label: 'Q2', cost: selectedMaterial?.q2Cost },
                  { value: 'q3', label: 'Q3', cost: selectedMaterial?.q3Cost },
                  { value: 'q4', label: 'Q4', cost: selectedMaterial?.q4Cost },
                ].map(({ value, label, cost }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSelectedQuarter(value)}
                    disabled={!selectedMaterialId && !editData}
                    className={`p-3 border-2 rounded-lg text-left transition-all ${
                      selectedQuarter === value
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/50'
                    } ${!selectedMaterialId && !editData ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <div className="text-sm font-semibold">{label}</div>
                    <div className="text-lg font-bold text-primary">
                      {cost ? `₹${cost.toFixed(2)}` : 'N/A'}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Usage and Cost Fields */}
            {!selectedMaterialId && !editData && (
              <div className="bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-xs text-blue-700 dark:text-blue-300">
                Select a material above to enable usage and cost fields
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold">Gross Usage</label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    value={grossUsage === 0 ? '' : grossUsage}
                    onChange={(e) => {
                      const val = e.target.value;
                      setGrossUsage(val === '' ? 0 : parseFloat(val) || 0);
                    }}
                    placeholder="Enter gross usage"
                    className="flex-1"
                    disabled={!selectedMaterialId && !editData}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.nativeEvent?.stopImmediatePropagation?.();
                      setCalculatorTarget('grossUsage');
                      setCalculatorOpen(true);
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.nativeEvent?.stopImmediatePropagation?.();
                    }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    title="Use Calculator"
                    disabled={!selectedMaterialId && !editData}
                  >
                    <CalculatorIcon className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">Net Usage</label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    value={netUsage === 0 ? '' : netUsage}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNetUsage(val === '' ? 0 : parseFloat(val) || 0);
                    }}
                    placeholder="Enter net usage"
                    className="flex-1"
                    disabled={!selectedMaterialId && !editData}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.nativeEvent?.stopImmediatePropagation?.();
                      setCalculatorTarget('netUsage');
                      setCalculatorOpen(true);
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.nativeEvent?.stopImmediatePropagation?.();
                    }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    title="Use Calculator"
                    disabled={!selectedMaterialId && !editData}
                  >
                    <CalculatorIcon className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold">Scrap %</label>
                <Input
                  type="number"
                  step="0.01"
                  value={scrap === 0 ? '' : scrap}
                  onChange={(e) => {
                    const val = e.target.value;
                    setScrap(val === '' ? 0 : parseFloat(val) || 0);
                  }}
                  placeholder="Enter scrap percentage"
                  disabled={!selectedMaterialId && !editData}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">Overhead %</label>
                <Input
                  type="number"
                  step="0.01"
                  value={overhead === 0 ? '' : overhead}
                  onChange={(e) => {
                    const val = e.target.value;
                    setOverhead(val === '' ? 0 : parseFloat(val) || 0);
                  }}
                  placeholder="Enter overhead percentage"
                  disabled={!selectedMaterialId && !editData}
                />
              </div>
            </div>

            {/* Total Cost Display */}
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
              <label className="text-sm font-semibold block mb-2">Total Cost</label>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">INR</span>
                <span className="text-lg font-bold">₹{totalCost.toFixed(2)}</span>
              </div>
            </div>
            </div>

            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  editData
                    ? grossUsage <= 0
                    : !materialGroup || !selectedMaterialId || grossUsage <= 0
                }
              >
                {editData ? 'Update Material' : 'Add Material'}
              </Button>
            </DialogFooter>
          </form>
        </div>
      </DialogContent>

      {/* Calculator Side Panel */}
      <Sheet open={calculatorOpen} onOpenChange={(open) => {
        console.log('Calculator onOpenChange called with:', open);
        
        // Prevent calculator from closing if lookup table is open
        if (!open && showLookupTable) {
          console.log('Preventing calculator close because lookup table is open');
          return;
        }
        
        if (!open) {
          console.log('Calculator closing - also closing lookup table');
          // When closing calculator, also close lookup table
          setShowLookupTable(false);
          setSelectedLookupField(null);
          setLookupTableData(null);
        }
        
        setCalculatorOpen(open);
      }} modal={false}>
        <SheetContent side="right" className="w-[600px] sm:w-[700px]" style={{ overflowY: 'auto' }}>
          <SheetHeader>
            <SheetTitle>
              Calculator - {calculatorTarget === 'grossUsage' ? 'Gross Usage' : 'Net Usage'}
            </SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            {/* Calculator Selector */}
            <div className="space-y-2">
              <Label>Select Calculator</Label>
              <Select value={selectedCalculatorId} onValueChange={setSelectedCalculatorId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a calculator" />
                </SelectTrigger>
                <SelectContent>
                  {calculatorsData?.calculators?.map((calc: any) => (
                    <SelectItem key={calc.id} value={calc.id}>
                      {calc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Auto-populate from BOM button */}
            {bomItemData && (
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline" 
                  onClick={autoPopulateFromBOM}
                  className="w-full"
                  disabled={!selectedCalculator}
                >
                  Auto-fill from BOM Data
                </Button>
                {!selectedCalculator && (
                  <p className="text-xs text-muted-foreground text-center">
                    Select a calculator above to enable auto-fill
                  </p>
                )}
              </div>
            )}

            {/* Calculator Inputs */}
            {selectedCalculator && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Input Values</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {selectedCalculator.fields
                      ?.filter((field: any) => field.fieldType !== 'calculated')
                      .map((field: any) => {
                        // Only show eye button for fields that are likely to have lookup tables
                        const labelLower = (field.displayLabel || field.fieldName || '').toLowerCase();
                        const fieldNameLower = (field.fieldName || '').toLowerCase();
                        
                        const isLookupTableField = 
                          // Only show for explicitly configured database lookup fields
                          (field.fieldType === 'database_lookup' && field.dataSource === 'processes') ||
                          // Only show for fields with sourceField starting with 'from_' (linked to reference tables)
                          (field.sourceField && field.sourceField.startsWith('from_'));

                        return (
                          <div key={field.id} className="space-y-2">
                            <Label htmlFor={field.fieldName}>
                              {field.displayLabel || field.fieldName}
                              {field.unit && <span className="text-muted-foreground ml-1">({field.unit})</span>}
                            </Label>

                            {isLookupTableField ? (
                              // Input field WITH eye icon for lookup table fields
                              <div className="flex gap-2">
                                <Input
                                  id={field.fieldName}
                                  type="number"
                                  step="0.01"
                                  value={calculatorInputs[field.fieldName] || ''}
                                  onChange={(e) =>
                                    setCalculatorInputs({
                                      ...calculatorInputs,
                                      [field.fieldName]: parseFloat(e.target.value) || 0,
                                    })
                                  }
                                  placeholder={`Enter ${field.displayLabel || field.fieldName}`}
                                  className="flex-1"
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleViewLookupTable(field);
                                  }}
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                  }}
                                  className="px-3"
                                  title="View reference table"
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </div>
                            ) : (
                              // Regular input field only
                              <Input
                                id={field.fieldName}
                                type="number"
                                step="0.01"
                                value={calculatorInputs[field.fieldName] || ''}
                                onChange={(e) =>
                                  setCalculatorInputs({
                                    ...calculatorInputs,
                                    [field.fieldName]: parseFloat(e.target.value) || 0,
                                  })
                                }
                                placeholder={`Enter ${field.displayLabel || field.fieldName}`}
                              />
                            )}
                          </div>
                        );
                      })}

                    <Button
                      onClick={handleExecuteCalculator}
                      disabled={executeCalculator.isPending}
                      className="w-full"
                    >
                      <Play className="h-4 w-4 mr-2" />
                      {executeCalculator.isPending ? 'Calculating...' : 'Calculate'}
                    </Button>
                  </CardContent>
                </Card>

                {/* Calculator Results */}
                {calculatorResults && (
                  <Card className="border-primary">
                    <CardHeader>
                      <CardTitle className="text-lg">Results</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {selectedCalculator.fields
                        ?.filter((field: any) => field.fieldType === 'calculated')
                        .map((field: any) => {
                          const result = calculatorResults[field.fieldName];
                          const value = result?.value !== undefined ? result.value : result;

                          return (
                            <div
                              key={field.id}
                              className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg"
                            >
                              <div>
                                <div className="font-medium">{field.displayName || field.fieldName}</div>
                                {field.unit && (
                                  <div className="text-xs text-muted-foreground">{field.unit}</div>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="text-lg font-bold text-primary">
                                  {typeof value === 'number' ? value.toFixed(4) : value || 'N/A'}
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleUseCalculatorValue(value)}
                                  disabled={typeof value !== 'number'}
                                >
                                  Use
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Lookup Table Panel */}
      {showLookupTable && lookupTableData && (() => {
        console.log('Rendering lookup table:', { showLookupTable, hasData: !!lookupTableData, tableName: lookupTableData?.tableName });
        return (
          <>
            {/* Backdrop */}
            <div 
              className="fixed inset-0 bg-black/20 z-[59]" 
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                e.nativeEvent?.stopImmediatePropagation?.();
                setShowLookupTable(false);
                setSelectedLookupField(null);
                setLookupTableData(null);
              }}
            />
            
            {/* Lookup Table */}
            <div
              className="fixed top-0 left-0 h-screen w-[500px] bg-background border-r border-border shadow-xl z-[60] flex flex-col"
              style={{ pointerEvents: 'auto' }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-3 border-b border-border bg-background">
                <div>
                  <h3 className="font-semibold text-sm">Reference Table</h3>
                  <p className="text-xs text-muted-foreground">{lookupTableData.tableName}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    e.nativeEvent?.stopImmediatePropagation?.();
                    setShowLookupTable(false);
                    setSelectedLookupField(null);
                    setLookupTableData(null);
                  }}
                  className="h-6 w-6 p-0"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18"></path>
                    <path d="m6 6 12 12"></path>
                  </svg>
                </Button>
              </div>

              {/* Hint */}
              <div className="px-3 py-1.5 bg-primary/5 border-b border-border text-xs text-muted-foreground flex items-center gap-1.5">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
                Click any row to use that value for <strong className="text-foreground mx-0.5">{lookupTableData.fieldLabel}</strong>. Highlighted column = selected value.
              </div>

              <div
                className="flex-1 p-3 relative overflow-auto"
                style={{
                  height: 'calc(100vh - 120px)',
                  pointerEvents: 'auto',
                  zIndex: 61
                }}
                onClick={(e) => e.stopPropagation()}
                onScroll={(e) => e.stopPropagation()}
              >
                <div className="w-full">
                  <table className="w-full border-collapse text-sm bg-background">
                    <thead>
                      <tr className="bg-muted/60">
                        <th className="border border-border text-center text-xs font-medium py-1 px-1 text-muted-foreground w-6">
                          #
                        </th>
                        {lookupTableData.column_definitions.map((col: any, colIdx: number) => {
                          const isOutputCol = colIdx === lookupTableData.column_definitions.length - 1;
                          return (
                            <th
                              key={col.name}
                              className={`border border-border text-left text-xs font-semibold py-1 px-2 ${isOutputCol ? 'text-primary bg-primary/10' : 'text-foreground'}`}
                            >
                              {col.label}
                              {isOutputCol && <span className="ml-1 text-primary/60">(↵ select)</span>}
                              {col.unit && (
                                <span className="text-primary/70 ml-1">({col.unit})</span>
                              )}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {lookupTableData.rows.map((row: any, rowIndex: number) => {
                        const outputCol = lookupTableData.column_definitions[lookupTableData.column_definitions.length - 1];
                        const getVal = (col: any) => {
                          const camel = col.name.replace(/_([a-z])/g, (_: string, l: string) => l.toUpperCase());
                          return row[col.name] !== undefined ? row[col.name] : row[camel];
                        };
                        const outputValue = outputCol ? getVal(outputCol) : undefined;
                        return (
                          <tr
                            key={rowIndex}
                            className="hover:bg-primary/10 cursor-pointer transition-colors"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                            }}
                            onClick={(e) => {
                              console.log('Lookup table row clicked');
                              e.stopPropagation();
                              e.preventDefault();
                              e.nativeEvent?.stopImmediatePropagation?.();
                              
                              if (selectedLookupField && outputValue !== undefined) {
                                console.log('Setting calculator input:', selectedLookupField.fieldName, outputValue);
                                setCalculatorInputs((prev: Record<string, any>) => ({
                                  ...prev,
                                  [selectedLookupField.fieldName]: typeof outputValue === "number"
                                    ? outputValue
                                    : parseFloat(outputValue) || outputValue,
                                }));
                              }
                              
                              // Use setTimeout to ensure state updates don't conflict
                              setTimeout(() => {
                                console.log('Closing lookup table only');
                                // Close ONLY lookup table after selection
                                setShowLookupTable(false);
                                setSelectedLookupField(null);
                                setLookupTableData(null);
                              }, 0);
                              
                              return false;
                            }}
                            title={outputCol ? `Click to use: ${outputCol.label} = ${outputValue}` : `Click to select`}
                          >
                            <td className="border border-border text-center text-xs py-1 px-1 text-muted-foreground font-mono bg-muted/20">
                              {rowIndex + 1}
                            </td>
                            {lookupTableData.column_definitions.map((col: any) => {
                              const value = getVal(col);
                              const isOutput = col.name === outputCol?.name;
                              return (
                                <td
                                  key={col.name}
                                  className={`border border-border py-1 px-2 text-xs${isOutput ? ' font-semibold text-primary bg-primary/5' : ''}`}
                                >
                                  {value !== undefined && value !== null ? String(value) : '—'}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        );
      })()}
    </Dialog>
  );
}
