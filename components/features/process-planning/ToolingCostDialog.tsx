'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Calculator as CalculatorIcon, Eye, Loader2, Play } from 'lucide-react';
import type { BOMItem } from '@/lib/api/hooks/useBOMItems';
import {
  useCalculators,
  useCalculator,
  useExecuteCalculator,
} from '@/lib/api/hooks/useCalculators';
import { useProcessCalculatorMappings } from '@/lib/api/hooks/useProcessCalculatorMappings';
import { useToolingCatalog, useToolingCatalogDomains } from '@/lib/api/hooks/useToolingCatalogs';
import type { ToolingCatalogItem } from '@/lib/api/tooling-catalogs';
import { catalogItemFields, catalogSourceLine, defaultAmortization, processLabel } from '@/lib/costing/tooling-catalog';

interface ToolingCostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  initialData?: any;
  bomItem?: any;
  selectedProcess?: string | null;
  selectedSubProcess?: string | null;
}

/** A Machining operation (process_calculator_mappings): the only sub-processes with real data. */
interface SubProcessDefinition {
  label: string;
}

/** The item picker's value for an item not in the catalog: it needs a tooling type and a reason. */
const CUSTOM_ITEM = '__custom__';

export function ToolingCostDialog({
  open,
  onOpenChange,
  onSubmit,
  initialData,
  bomItem,
  selectedProcess,
  selectedSubProcess,
}: ToolingCostDialogProps) {
  const [formData, setFormData] = useState({
    manufacturingProcess: '',
    subProcess: '',
    toolingType: '',
    description: '',
    specifications: '',
    unitCost: '',
    quantity: '1',
    amortizationParts: '',
    usagePercentage: '100',
    isCustom: false,
    supplier: '',
    leadTime: '',
    notes: '',
  });

  // The catalog item picked ('' none yet, CUSTOM_ITEM for an item not in the catalog).
  const [catalogItemId, setCatalogItemId] = useState<string>('');
  const amortizationDefault = defaultAmortization((bomItem as Partial<BOMItem> | undefined)?.resolvedCostingInputs);

  // Calculator state
  const [calculatorOpen, setCalculatorOpen] = useState<boolean>(false);
  const [calculatorTarget, setCalculatorTarget] = useState<string | null>(null);
  const [selectedCalculatorId, setSelectedCalculatorId] = useState<string>('');
  const [calculatorInputs, setCalculatorInputs] = useState<Record<string, any>>({});
  const [calculatorResults, setCalculatorResults] = useState<Record<string, any> | null>(null);
  const [lookupTableOpen, setLookupTableOpen] = useState<boolean>(false);
  const [selectedLookupField, setSelectedLookupField] = useState<any>(null);

  useEffect(() => {
    if (initialData) {
      setFormData({
        manufacturingProcess: initialData.manufacturingProcess || '',
        subProcess: initialData.subProcess || '',
        toolingType: initialData.toolingType || '',
        description: initialData.description || '',
        specifications: initialData.specifications || '',
        unitCost: initialData.unitCost?.toString() || '',
        quantity: initialData.quantity?.toString() || '1',
        amortizationParts: initialData.amortizationParts?.toString() || '',
        usagePercentage: initialData.usagePercentage?.toString() || '100',
        isCustom: initialData.isCustom || false,
        supplier: initialData.supplier || '',
        leadTime: initialData.leadTime?.toString() || '',
        notes: initialData.notes || '',
      });
      setCatalogItemId((initialData as { isCustom?: boolean }).isCustom ? CUSTOM_ITEM : '');
    } else {
      setCatalogItemId('');
      // Reset form for new tooling
      setFormData({
        manufacturingProcess: selectedProcess || '',
        subProcess: selectedSubProcess || '',
        toolingType: '',
        description: '',
        specifications: '',
        unitCost: '',
        quantity: '1',
        amortizationParts: amortizationDefault ? String(amortizationDefault.parts) : '',
        usagePercentage: '100',
        isCustom: false,
        supplier: '',
        leadTime: '',
        notes: '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open; the default is read from the part as it is then
  }, [initialData, open, selectedProcess, selectedSubProcess]);

  // Calculate total cost per part
  const calculateTotalCost = () => {
    const unitCost = parseFloat(formData.unitCost) || 0;
    const quantity = parseFloat(formData.quantity) || 1;
    const amortizationParts = parseFloat(formData.amortizationParts) || 1;
    const usagePercentage = parseFloat(formData.usagePercentage) || 100;

    const totalToolingCost = unitCost * quantity;
    const costPerPart = (totalToolingCost / amortizationParts) * (usagePercentage / 100);

    return {
      totalToolingCost,
      costPerPart,
    };
  };

  const { totalToolingCost, costPerPart } = calculateTotalCost();

  // Calculator API hooks
  const { data: calculatorsData } = useCalculators();
  const { data: selectedCalculator } = useCalculator(selectedCalculatorId);
  const executeCalculator = useExecuteCalculator();

  // Real Machining operations (process_calculator_mappings, processGroup=
  // 'Machining') — replaces the hardcoded turning/milling/drilling/grinding/
  // boring/threading sub-process list. Fetched with both active and
  // inactive rows (same convention as the Process Catalog page): every one
  // of Machining's 43 real categories has no calculator wired yet
  // (is_active=false), so filtering to active-only would show nothing.
  // Only fetched while this dialog is open.
  const { data: machiningMappingsData } = useProcessCalculatorMappings(
    { processGroup: 'Machining', limit: 1000 },
    { enabled: open },
  );
  const machiningOperations = useMemo<Array<[string, SubProcessDefinition]>>(() => {
    const rows = machiningMappingsData?.mappings ?? [];
    const seen = new Set<string>();
    const ops: Array<[string, SubProcessDefinition]> = [];
    for (const m of rows) {
      if (!m.operation || seen.has(m.operation)) continue;
      seen.add(m.operation);
      ops.push([m.operation, { label: m.operation }]);
    }
    return ops.sort((a, b) => a[0].localeCompare(b[0]));
  }, [machiningMappingsData]);

  // Processes with a tooling catalog, and the items of the one chosen (staged memory/ reference data).
  const { data: catalogDomains = [] } = useToolingCatalogDomains(open);
  const { data: catalog, isLoading: catalogLoading } = useToolingCatalog(open && formData.manufacturingProcess ? formData.manufacturingProcess : undefined);
  const catalogItemsByKind = useMemo(() => {
    const groups = new Map<string, ToolingCatalogItem[]>();
    for (const item of catalog?.items ?? []) groups.set(item.kind, [...(groups.get(item.kind) ?? []), item]);
    return [...groups.entries()];
  }, [catalog]);
  const pickedItem = catalog?.items.find((i) => i.id === catalogItemId) ?? null;
  const isCustom = catalogItemId === CUSTOM_ITEM;

  const pickCatalogItem = (id: string) => {
    setCatalogItemId(id);
    const item = catalog?.items.find((i) => i.id === id);
    if (item) setFormData((prev) => ({ ...prev, ...catalogItemFields(item), isCustom: false }));
    else if (id === CUSTOM_ITEM) setFormData((prev) => ({ ...prev, isCustom: true }));
  };

  // Lookup table state (matching raw material pattern)
  const [lookupTableData, setLookupTableData] = useState<any>(null);

  // Reset calculator when dialog closes
  useEffect(() => {
    if (!open) {
      setCalculatorOpen(false);
      setCalculatorTarget(null);
      setSelectedCalculatorId('');
      setCalculatorInputs({});
      setCalculatorResults(null);
      setLookupTableOpen(false);
      setSelectedLookupField(null);
    }
  }, [open]);

  // Auto-populate calculator inputs from BOM data
  const autoPopulateFromBOM = () => {
    if (!bomItem || !selectedCalculator) return;

    const bomFieldMapping: Record<string, any> = {
      'weight': bomItem.weight || bomItem.unitWeight || bomItem.netWeight || bomItem.grossWeight,
      'length': bomItem.length || bomItem.maxLength || bomItem.overallLength,
      'width': bomItem.width || bomItem.maxWidth || bomItem.overallWidth,
      'height': bomItem.height || bomItem.maxHeight || bomItem.overallHeight,
      'diameter': bomItem.diameter || bomItem.maxDiameter || bomItem.outerDiameter,
      'thickness': bomItem.thickness || bomItem.wallThickness,
      'quantity': bomItem.quantity || 1,
      'volume': bomItem.volume || bomItem.totalVolume,
      'surface_area': bomItem.surfaceArea || bomItem.totalSurfaceArea,
      'material_grade': bomItem.materialGrade || bomItem.material,
      'hardness': bomItem.hardness,
      'tolerance': bomItem.tolerance || bomItem.surfaceFinish,
      'batch_size': bomItem.batchSize || bomItem.quantity,
    };

    const newInputs: Record<string, any> = {};
    selectedCalculator.fields
      ?.filter((field: any) => field.fieldType !== 'calculated')
      .forEach((field: any) => {
        const bomValue = bomFieldMapping[field.fieldName];
        if (bomValue !== undefined && bomValue !== null && bomValue !== '') {
          newInputs[field.fieldName] = bomValue;
        }
      });

    setCalculatorInputs(newInputs);
  };

  const handleExecuteCalculator = async () => {
    try {
      const result = await executeCalculator.mutateAsync({
        calculatorId: selectedCalculatorId,
        inputValues: calculatorInputs,
      });

      if (result.success) {
        setCalculatorResults(result.results);
      }
    } catch (error) {
      console.error('Calculator execution failed:', error);
    }
  };

  const handleUseCalculatorValue = (value: number, targetField?: string) => {
    const fieldToUpdate = targetField || calculatorTarget;
    if (fieldToUpdate) {
      setFormData(prev => ({
        ...prev,
        [fieldToUpdate]: value.toString()
      }));
      setCalculatorOpen(false);
      setCalculatorTarget(null);
    }
  };

  // Handle viewing lookup table (matching raw material pattern)
  const handleViewLookupTable = async (field: any) => {
    setSelectedLookupField(field);
    setLookupTableOpen(true);
    
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
          setLookupTableData(tableData);
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
          if (fieldName.includes('temperature') && tableName.includes('temp')) return true;
          if (fieldName.includes('pressure') && tableName.includes('pressure')) return true;
          if (fieldName.includes('speed') && tableName.includes('speed')) return true;
          if (fieldName.includes('feed') && tableName.includes('feed')) return true;
          if (fieldName.includes('cutting') && tableName.includes('cutting')) return true;
          if (fieldName.includes('tooling') && tableName.includes('tool')) return true;
          if (fieldName.includes('cavities') && tableName.includes('cavit')) return true;
          if (fieldName.includes('cavity') && tableName.includes('cavit')) return true;
          if (fieldName.includes('recommendation') && tableName.includes('recommend')) return true;
          
          return false;
        });

        if (matched) {
          const processedRows = matched.rows?.map((row: any) =>
            row.rowData ? row.rowData : row
          ) || [];
          const tableData = {
            fieldName: field.fieldName,
            fieldLabel: field.displayLabel || field.fieldName,
            tableName: matched.tableName,
            tableId: matched.id,
            column_definitions: matched.columnDefinitions || [],
            rows: processedRows,
          };
          setLookupTableData(tableData);
          return;
        }
      }
    } catch (error) {
      console.error('Error fetching lookup table:', error);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const submitData = {
      manufacturingProcess: formData.manufacturingProcess,
      subProcess: formData.subProcess,
      toolingType: formData.toolingType,
      description: formData.description,
      specifications: formData.specifications,
      unitCost: parseFloat(formData.unitCost) || 0,
      quantity: parseInt(formData.quantity) || 1,
      amortizationParts: parseInt(formData.amortizationParts) || 1,
      usagePercentage: parseFloat(formData.usagePercentage) || 100,
      isCustom: isCustom || formData.isCustom,
      supplier: formData.supplier,
      leadTime: parseInt(formData.leadTime) || 0,
      notes: formData.notes,
      totalCost: costPerPart, // Cost per part
      totalToolingInvestment: totalToolingCost, // Total investment
    };

    onSubmit(submitData);
  };

  const isMachiningSelected = formData.manufacturingProcess === 'machining';
  // Only Machining has real sub-processes (its operations); the other processes have none on file, so none are offered.
  const availableSubProcesses = isMachiningSelected ? machiningOperations : [];
  // A record saved before the catalog may name a process without one: it stays selectable so editing keeps it.
  const processOptions = formData.manufacturingProcess && !catalogDomains.some((d) => d.key === formData.manufacturingProcess)
    ? [...catalogDomains, { key: formData.manufacturingProcess, label: processLabel(formData.manufacturingProcess, catalogDomains) }]
    : catalogDomains;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {initialData ? 'Edit Tooling Item' : 'Add Tooling Item'}
            {selectedProcess && selectedSubProcess && (
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="secondary" className="text-xs">
                  {processLabel(selectedProcess, catalogDomains)}
                </Badge>
                <span className="text-xs text-muted-foreground">→</span>
                <Badge variant="outline" className="text-xs">
                  {machiningOperations.find(([key]) => key === selectedSubProcess)?.[1]?.label ?? selectedSubProcess}
                </Badge>
              </div>
            )}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Process Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-secondary/20 rounded-lg">
            <div className="space-y-2">
              <Label htmlFor="manufacturingProcess">Manufacturing Process</Label>
              <Select
                value={formData.manufacturingProcess}
                onValueChange={(value) => {
                  setCatalogItemId('');
                  setFormData(prev => ({ ...prev, manufacturingProcess: value, subProcess: '' }));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select manufacturing process" />
                </SelectTrigger>
                <SelectContent>
                  {processOptions.map((d) => (
                    <SelectItem key={d.key} value={d.key}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="subProcess">Sub-Process</Label>
              <Select
                value={formData.subProcess}
                onValueChange={(value) => setFormData(prev => ({ ...prev, subProcess: value }))}
                disabled={availableSubProcesses.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={
                    !formData.manufacturingProcess
                      ? "Select process first"
                      : availableSubProcesses.length === 0 ? "None on file for this process" : "Select sub-process"
                  } />
                </SelectTrigger>
                <SelectContent>
                  {availableSubProcesses.map(([key, subProcess]) => (
                    <SelectItem key={key} value={key}>
                      {subProcess.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Catalog item: picking one fills the type, description, unit cost and typical quantity from the reference data. */}
          <div className="space-y-2">
            <Label htmlFor="catalogItem">Tooling Item *</Label>
            <Select value={catalogItemId} onValueChange={pickCatalogItem} disabled={!formData.manufacturingProcess} required={!initialData}>
              <SelectTrigger id="catalogItem">
                <SelectValue placeholder={
                  !formData.manufacturingProcess
                    ? 'Select process first'
                    : catalogLoading ? 'Loading catalog…' : initialData && !isCustom ? (formData.description || 'Select item') : 'Select from the catalog, or a custom item'
                } />
              </SelectTrigger>
              <SelectContent>
                {catalogItemsByKind.map(([kind, items]) => (
                  <div key={kind}>
                    <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase">{kind}</div>
                    {items.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}{item.details ? ` · ${item.details}` : ''}
                      </SelectItem>
                    ))}
                  </div>
                ))}
                <div className="border-t" />
                <SelectItem value={CUSTOM_ITEM}>Custom item (not in the catalog)</SelectItem>
              </SelectContent>
            </Select>
            {pickedItem && (
              <p className="text-xs text-muted-foreground">Why: {catalogSourceLine(pickedItem)}</p>
            )}
            {catalog && catalog.unpriced.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Not offered, no price on file: {catalog.unpriced.map((u) => u.name).join(', ')}
              </p>
            )}
          </div>

          {isCustom && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="toolingType">Tooling Type *</Label>
                <Input
                  id="toolingType"
                  value={formData.toolingType}
                  onChange={(e) => { setFormData(prev => ({ ...prev, toolingType: e.target.value })); }}
                  placeholder="e.g. Fixture"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customReason">Why it is not from the catalog *</Label>
                <Input
                  id="customReason"
                  value={formData.notes}
                  onChange={(e) => { setFormData(prev => ({ ...prev, notes: e.target.value })); }}
                  placeholder="e.g. Supplier quote Q-1042"
                  minLength={3}
                  required
                />
              </div>
            </div>
          )}

          {/* Description and Specifications */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="description">Description *</Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Tool description (e.g., 10mm End Mill)"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="specifications">Technical Specifications</Label>
              <Input
                id="specifications"
                value={formData.specifications}
                onChange={(e) => setFormData(prev => ({ ...prev, specifications: e.target.value }))}
                placeholder="HSS, TiN Coated, 4-Flute"
              />
            </div>
          </div>

          {/* Cost and Quantity */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="unitCost">Unit Cost ($) *</Label>
              <div className="flex gap-2">
                <Input
                  id="unitCost"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.unitCost}
                  onChange={(e) => setFormData(prev => ({ ...prev, unitCost: e.target.value }))}
                  placeholder="0.00"
                  required
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10"
                  onClick={() => {
                    setCalculatorTarget('unitCost');
                    setCalculatorOpen(true);
                  }}
                >
                  <CalculatorIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity Required</Label>
              <Input
                id="quantity"
                type="number"
                min="1"
                value={formData.quantity}
                onChange={(e) => setFormData(prev => ({ ...prev, quantity: e.target.value }))}
                placeholder="1"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="usagePercentage">Usage % for this Part</Label>
              <Input
                id="usagePercentage"
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={formData.usagePercentage}
                onChange={(e) => setFormData(prev => ({ ...prev, usagePercentage: e.target.value }))}
                placeholder="100"
              />
            </div>
          </div>

          {/* Amortization */}
          <div className="space-y-2">
            <Label htmlFor="amortizationParts">Amortization Over (Number of Parts) *</Label>
            <Input
              id="amortizationParts"
              type="number"
              min="1"
              value={formData.amortizationParts}
              onChange={(e) => setFormData(prev => ({ ...prev, amortizationParts: e.target.value }))}
              placeholder="e.g., 10000 (tooling cost spread over 10,000 parts)"
              required
            />
            <p className="text-xs text-muted-foreground">
              {amortizationDefault && formData.amortizationParts === String(amortizationDefault.parts)
                ? `Why: the part's lifetime volume, ${amortizationDefault.why}`
                : 'Number of parts over which to amortize the tooling cost'}
            </p>
          </div>

          {/* Cost Calculation Summary */}
          {formData.unitCost && formData.amortizationParts && (
            <div className="bg-muted/30 p-4 rounded-lg border">
              <h4 className="font-semibold text-sm mb-2">Cost Calculation</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Total Tooling Investment:</span>
                  <div className="font-semibold">
                    ${totalToolingCost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Cost per Part:</span>
                  <div className="font-bold text-green-700">
                    ${costPerPart.toLocaleString('en-IN', { minimumFractionDigits: 4 })}
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Based on {parseInt(formData.amortizationParts).toLocaleString()} parts with {formData.usagePercentage}% usage
              </p>
            </div>
          )}

          {/* Form Actions */}
          <div className="flex justify-end space-x-2 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">
              {initialData ? 'Update Tooling' : 'Add Tooling'}
            </Button>
          </div>
        </form>

        {/* Calculator Sheet */}
        <Sheet open={calculatorOpen} onOpenChange={(open) => {
          if (!open && lookupTableOpen) {
            return;
          }
          if (!open) {
            setLookupTableOpen(false);
            setSelectedLookupField(null);
            setLookupTableData(null);
          }
          setCalculatorOpen(open);
        }} modal={false}>
          <SheetContent 
            side="right" 
            className="w-[600px] sm:w-[700px] overflow-y-auto overflow-x-hidden" 
            style={{ 
              overflowY: 'auto',
              overflowX: 'hidden',
              pointerEvents: 'auto',
              touchAction: 'pan-y'
            }}
          >
            <SheetHeader>
              <SheetTitle>
                Calculator - Unit Cost
              </SheetTitle>
            </SheetHeader>

            <div 
              className="mt-6 space-y-6 pb-20" 
              style={{ 
                minHeight: '100%',
                pointerEvents: 'auto'
              }}
            >
              {/* Calculator Selection */}
              <div className="space-y-2">
                <Label>Select Calculator</Label>
                <Select
                  value={selectedCalculatorId}
                  onValueChange={(value) => {
                    setSelectedCalculatorId(value);
                    setCalculatorInputs({});
                    setCalculatorResults(null);
                  }}
                >
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
              {bomItem && (
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
                          const isLookupTableField = 
                            (field.fieldType === 'database_lookup' && field.dataSource) ||
                            (field.sourceField && field.sourceField.startsWith('from_'));

                          return (
                            <div key={field.id} className="space-y-2">
                              <Label htmlFor={field.fieldName}>
                                {field.displayLabel || field.fieldName}
                                {field.unit && <span className="text-muted-foreground ml-1">({field.unit})</span>}
                              </Label>

                              {isLookupTableField ? (
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
                                    onClick={() => handleViewLookupTable(field)}
                                    className="px-3"
                                    title="View reference table"
                                  >
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                </div>
                              ) : (
                                <Input
                                  id={field.fieldName}
                                  type={field.dataType === 'number' ? 'number' : 'text'}
                                  step={field.dataType === 'number' ? '0.01' : undefined}
                                  value={calculatorInputs[field.fieldName] || ''}
                                  onChange={(e) => {
                                    const value = field.dataType === 'number' 
                                      ? parseFloat(e.target.value) || 0
                                      : e.target.value;
                                    setCalculatorInputs(prev => ({
                                      ...prev,
                                      [field.fieldName]: value
                                    }));
                                  }}
                                  placeholder={`Enter ${field.displayLabel || field.fieldName}`}
                                />
                              )}
                              
                              {field.description && (
                                <p className="text-xs text-muted-foreground">{field.description}</p>
                              )}
                            </div>
                          );
                        })}
                    </CardContent>
                  </Card>

                  <Button 
                    onClick={handleExecuteCalculator}
                    disabled={executeCalculator.isPending}
                    className="w-full"
                  >
                    {executeCalculator.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Calculating...
                      </>
                    ) : (
                      <>
                        <Play className="mr-2 h-4 w-4" />
                        Calculate
                      </>
                    )}
                  </Button>

                  {/* Calculator Results */}
                  {calculatorResults && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Results</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-4">
                          {selectedCalculator.fields
                            ?.filter((field: any) => field.fieldType === 'calculated')
                            .map((field: any) => {
                              const value = calculatorResults[field.fieldName];
                              return (
                                <div key={field.id} className="flex items-center justify-between p-3 bg-muted rounded">
                                  <div>
                                    <p className="font-medium">{field.displayLabel || field.fieldName}</p>
                                    {field.description && (
                                      <p className="text-sm text-muted-foreground">{field.description}</p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-lg">
                                      {typeof value === 'number' ? value.toFixed(2) : value}
                                      {field.unit && <span className="text-sm text-muted-foreground ml-1">{field.unit}</span>}
                                    </span>
                                    <Button
                                      size="sm"
                                      onClick={() => handleUseCalculatorValue(value, calculatorTarget ?? undefined)}
                                      disabled={typeof value !== 'number'}
                                    >
                                      Use Value
                                    </Button>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </div>
          </SheetContent>
        </Sheet>

        {/* Lookup Table Sheet */}
        <Sheet open={lookupTableOpen} onOpenChange={setLookupTableOpen} modal={false}>
          <SheetContent side="left" className="w-[800px] sm:w-[900px]" style={{ overflowY: 'auto' }}>
            <SheetHeader>
              <SheetTitle>
                Reference Table - {selectedLookupField?.displayLabel || selectedLookupField?.fieldName}
              </SheetTitle>
            </SheetHeader>
            
            <div className="mt-6 flex flex-col h-[calc(100vh-200px)]">
              <div className="px-3 py-1.5 bg-primary/5 border border-border rounded text-xs text-muted-foreground flex items-center gap-1.5 mb-4 shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
                Click any row to use that value for <strong className="text-foreground mx-0.5">{selectedLookupField?.displayLabel || selectedLookupField?.fieldName}</strong>.
              </div>

              {lookupTableData && (
                <div className="flex-1 overflow-auto">
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
                              e.stopPropagation();
                              e.preventDefault();
                              
                              if (selectedLookupField && outputValue !== undefined) {
                                setCalculatorInputs((prev: Record<string, any>) => ({
                                  ...prev,
                                  [selectedLookupField.fieldName]: typeof outputValue === "number"
                                    ? outputValue
                                    : parseFloat(outputValue) || outputValue,
                                }));
                              }
                              setLookupTableOpen(false);
                              setSelectedLookupField(null);
                              setLookupTableData(null);
                            }}
                          >
                            <td className="border border-border text-center text-xs py-1 px-1 text-muted-foreground">
                              {rowIndex + 1}
                            </td>
                            {lookupTableData.column_definitions.map((col: any, colIdx: number) => {
                              const value = getVal(col);
                              const isOutputCol = colIdx === lookupTableData.column_definitions.length - 1;
                              return (
                                <td
                                  key={col.name}
                                  className={`border border-border py-1 px-2 text-sm ${isOutputCol ? 'font-medium text-primary' : ''}`}
                                >
                                  {value}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              
              {!lookupTableData && selectedLookupField && (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center text-muted-foreground">
                    <div className="mb-2">Loading lookup table data...</div>
                    <div className="text-xs">Field: {selectedLookupField.fieldName}</div>
                  </div>
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </DialogContent>
    </Dialog>
  );
}