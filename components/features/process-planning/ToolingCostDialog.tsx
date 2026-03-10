'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Calculator as CalculatorIcon, Eye, Loader2, Play } from 'lucide-react';
import { 
  useCalculators,
  useCalculator,
  useExecuteCalculator,
  useDatabaseLookupOptions 
} from '@/lib/api/hooks/useCalculators';

interface ToolingCostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  initialData?: any;
  bomItem?: any;
  selectedProcess?: string | null;
  selectedSubProcess?: string | null;
}

// Manufacturing Process Hierarchy
const MANUFACTURING_PROCESSES = {
  machining: {
    label: 'Machining',
    subProcesses: {
      turning: { label: 'Turning', toolTypes: ['cutting_tool', 'fixture', 'measuring_tool'] },
      milling: { label: 'Milling', toolTypes: ['cutting_tool', 'fixture', 'measuring_tool'] },
      drilling: { label: 'Drilling', toolTypes: ['cutting_tool', 'fixture', 'jig'] },
      grinding: { label: 'Grinding', toolTypes: ['cutting_tool', 'fixture', 'measuring_tool'] },
      boring: { label: 'Boring', toolTypes: ['cutting_tool', 'fixture', 'measuring_tool'] },
      threading: { label: 'Threading', toolTypes: ['cutting_tool', 'fixture', 'gauge'] }
    }
  },
  injection_molding: {
    label: 'Injection Molding',
    subProcesses: {
      mold_making: { label: 'Mold Making', toolTypes: ['die', 'cutting_tool', 'measuring_tool'] },
      injection: { label: 'Injection Process', toolTypes: ['die', 'fixture', 'test_equipment'] },
      cooling: { label: 'Cooling System', toolTypes: ['special_tool', 'measuring_tool'] },
      ejection: { label: 'Ejection System', toolTypes: ['special_tool', 'fixture'] }
    }
  },
  sheet_metal: {
    label: 'Sheet Metal',
    subProcesses: {
      cutting: { label: 'Cutting', toolTypes: ['cutting_tool', 'fixture', 'measuring_tool'] },
      bending: { label: 'Bending', toolTypes: ['die', 'fixture', 'gauge'] },
      punching: { label: 'Punching', toolTypes: ['punch', 'die', 'fixture'] },
      stamping: { label: 'Stamping', toolTypes: ['die', 'punch', 'fixture'] },
      welding: { label: 'Welding', toolTypes: ['fixture', 'jig', 'special_tool'] },
      forming: { label: 'Forming', toolTypes: ['die', 'fixture', 'gauge'] }
    }
  },
  casting: {
    label: 'Casting',
    subProcesses: {
      sand_casting: { label: 'Sand Casting', toolTypes: ['die', 'fixture', 'special_tool'] },
      investment_casting: { label: 'Investment Casting', toolTypes: ['die', 'fixture', 'measuring_tool'] },
      die_casting: { label: 'Die Casting', toolTypes: ['die', 'fixture', 'test_equipment'] },
      permanent_mold: { label: 'Permanent Mold', toolTypes: ['die', 'fixture', 'special_tool'] },
      pattern_making: { label: 'Pattern Making', toolTypes: ['cutting_tool', 'measuring_tool', 'special_tool'] }
    }
  },
  forging: {
    label: 'Forging',
    subProcesses: {
      hot_forging: { label: 'Hot Forging', toolTypes: ['die', 'fixture', 'special_tool'] },
      cold_forging: { label: 'Cold Forging', toolTypes: ['die', 'punch', 'fixture'] },
      upset_forging: { label: 'Upset Forging', toolTypes: ['die', 'fixture', 'measuring_tool'] },
      drop_forging: { label: 'Drop Forging', toolTypes: ['die', 'fixture', 'special_tool'] },
      press_forging: { label: 'Press Forging', toolTypes: ['die', 'fixture', 'measuring_tool'] }
    }
  },
  assembly: {
    label: 'Assembly',
    subProcesses: {
      mechanical_assembly: { label: 'Mechanical Assembly', toolTypes: ['assembly_tool', 'fixture', 'measuring_tool'] },
      welded_assembly: { label: 'Welded Assembly', toolTypes: ['fixture', 'jig', 'assembly_tool'] },
      fastened_assembly: { label: 'Fastened Assembly', toolTypes: ['assembly_tool', 'fixture', 'gauge'] },
      bonded_assembly: { label: 'Bonded Assembly', toolTypes: ['fixture', 'assembly_tool', 'special_tool'] }
    }
  },
  finishing: {
    label: 'Finishing',
    subProcesses: {
      surface_treatment: { label: 'Surface Treatment', toolTypes: ['fixture', 'special_tool', 'test_equipment'] },
      painting: { label: 'Painting', toolTypes: ['fixture', 'special_tool', 'test_equipment'] },
      plating: { label: 'Plating', toolTypes: ['fixture', 'special_tool', 'measuring_tool'] },
      heat_treatment: { label: 'Heat Treatment', toolTypes: ['fixture', 'measuring_tool', 'test_equipment'] }
    }
  },
  inspection: {
    label: 'Quality Control & Inspection',
    subProcesses: {
      dimensional_inspection: { label: 'Dimensional Inspection', toolTypes: ['measuring_tool', 'gauge', 'test_equipment'] },
      functional_testing: { label: 'Functional Testing', toolTypes: ['test_equipment', 'fixture', 'special_tool'] },
      visual_inspection: { label: 'Visual Inspection', toolTypes: ['measuring_tool', 'gauge', 'special_tool'] },
      material_testing: { label: 'Material Testing', toolTypes: ['test_equipment', 'special_tool', 'measuring_tool'] }
    }
  }
};

const TOOLING_TYPES = [
  { value: 'cutting_tool', label: 'Cutting Tools (End Mills, Drills, etc.)', category: 'machining' },
  { value: 'fixture', label: 'Fixtures & Work Holding', category: 'setup' },
  { value: 'jig', label: 'Jigs & Templates', category: 'setup' },
  { value: 'die', label: 'Dies & Molds', category: 'forming' },
  { value: 'punch', label: 'Punches & Stamps', category: 'forming' },
  { value: 'gauge', label: 'Go/No-Go Gauges', category: 'inspection' },
  { value: 'measuring_tool', label: 'Measuring Tools', category: 'inspection' },
  { value: 'special_tool', label: 'Special Purpose Tools', category: 'custom' },
  { value: 'assembly_tool', label: 'Assembly Tools', category: 'assembly' },
  { value: 'test_equipment', label: 'Test Equipment', category: 'inspection' },
];

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
    } else {
      // Reset form for new tooling
      setFormData({
        manufacturingProcess: selectedProcess || '',
        subProcess: selectedSubProcess || '',
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
    }
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
      isCustom: formData.isCustom,
      supplier: formData.supplier,
      leadTime: parseInt(formData.leadTime) || 0,
      notes: formData.notes,
      totalCost: costPerPart, // Cost per part
      totalToolingInvestment: totalToolingCost, // Total investment
    };

    onSubmit(submitData);
  };

  const selectedTooling = TOOLING_TYPES.find(t => t.value === formData.toolingType);
  const selectedProcessData = MANUFACTURING_PROCESSES[formData.manufacturingProcess as keyof typeof MANUFACTURING_PROCESSES];
  const availableSubProcesses = selectedProcessData ? Object.entries(selectedProcessData.subProcesses) : [];
  const selectedSubProcessData = selectedProcessData?.subProcesses[formData.subProcess as keyof typeof selectedProcessData.subProcesses];

  // Filter tooling types based on selected sub-process
  const getRecommendedTools = () => {
    if (!selectedSubProcessData?.toolTypes) {
      return { recommended: [], others: TOOLING_TYPES };
    }
    
    const recommendedTypes = selectedSubProcessData.toolTypes;
    const recommended = TOOLING_TYPES.filter(tool => recommendedTypes.includes(tool.value));
    const others = TOOLING_TYPES.filter(tool => !recommendedTypes.includes(tool.value));
    
    return { recommended, others };
  };

  const { recommended: recommendedTools, others: otherTools } = getRecommendedTools();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {initialData ? 'Edit Tooling Item' : 'Add Tooling Item'}
            {selectedProcess && selectedSubProcess && (
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="secondary" className="text-xs">
                  {MANUFACTURING_PROCESSES[selectedProcess as keyof typeof MANUFACTURING_PROCESSES]?.label}
                </Badge>
                <span className="text-xs text-muted-foreground">→</span>
                <Badge variant="outline" className="text-xs">
                  {MANUFACTURING_PROCESSES[selectedProcess as keyof typeof MANUFACTURING_PROCESSES]?.subProcesses[selectedSubProcess as keyof typeof MANUFACTURING_PROCESSES[typeof selectedProcess]['subProcesses']]?.label}
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
                onValueChange={(value) => setFormData(prev => ({ 
                  ...prev, 
                  manufacturingProcess: value,
                  subProcess: '' // Reset sub-process when process changes
                }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select manufacturing process" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(MANUFACTURING_PROCESSES).map(([key, process]) => (
                    <SelectItem key={key} value={key}>
                      {process.label}
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
                disabled={!formData.manufacturingProcess}
              >
                <SelectTrigger>
                  <SelectValue placeholder={
                    !formData.manufacturingProcess 
                      ? "Select process first" 
                      : "Select sub-process"
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

          {/* Recommended Tool Types */}
          {selectedSubProcessData && (
            <div className="p-4 bg-primary/5 rounded-lg">
              <Label className="text-sm font-medium">Recommended Tool Types for {selectedSubProcessData.label}:</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {selectedSubProcessData.toolTypes.map((toolType: string) => (
                  <Badge key={toolType} variant="secondary" className="text-xs">
                    {TOOLING_TYPES.find(t => t.value === toolType)?.label || toolType.replace('_', ' ')}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Tooling Type */}
          <div className="space-y-2">
            <Label htmlFor="toolingType">Tooling Type *</Label>
            <Select
              value={formData.toolingType}
              onValueChange={(value) => setFormData(prev => ({ ...prev, toolingType: value }))}
              required
            >
              <SelectTrigger>
                <SelectValue placeholder="Select tooling type" />
              </SelectTrigger>
              <SelectContent>
                {recommendedTools.length > 0 && (
                  <>
                    <div className="px-2 py-1 text-xs font-semibold text-green-600 uppercase">
                      Recommended for this process
                    </div>
                    {recommendedTools.map((tool) => (
                      <SelectItem key={tool.value} value={tool.value}>
                        <div className="flex items-center gap-2">
                          <span className="text-green-600">★</span>
                          <span>{tool.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                    <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase border-t">
                      Other tool types
                    </div>
                  </>
                )}
                {otherTools.map((tool) => (
                  <SelectItem key={tool.value} value={tool.value}>
                    {tool.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedTooling && (
              <Badge variant="outline" className="text-xs">
                {selectedTooling.category.replace('_', ' ').toUpperCase()}
              </Badge>
            )}
          </div>

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
              <Label htmlFor="unitCost">Unit Cost (₹) *</Label>
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
              Number of parts over which to amortize the tooling cost
            </p>
          </div>

          {/* Custom Tooling Checkbox */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="isCustom"
              checked={formData.isCustom}
              onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isCustom: checked as boolean }))}
            />
            <Label htmlFor="isCustom" className="text-sm">
              Custom/Special Purpose Tooling
            </Label>
          </div>

          {/* Supplier and Lead Time (for custom tooling) */}
          {formData.isCustom && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="supplier">Supplier</Label>
                <Input
                  id="supplier"
                  value={formData.supplier}
                  onChange={(e) => setFormData(prev => ({ ...prev, supplier: e.target.value }))}
                  placeholder="Supplier name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="leadTime">Lead Time (Days)</Label>
                <Input
                  id="leadTime"
                  type="number"
                  min="0"
                  value={formData.leadTime}
                  onChange={(e) => setFormData(prev => ({ ...prev, leadTime: e.target.value }))}
                  placeholder="0"
                />
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Additional Notes</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="Special requirements, maintenance notes, etc."
              rows={3}
            />
          </div>


          {/* Cost Calculation Summary */}
          {formData.unitCost && formData.amortizationParts && (
            <div className="bg-muted/30 p-4 rounded-lg border">
              <h4 className="font-semibold text-sm mb-2">Cost Calculation</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Total Tooling Investment:</span>
                  <div className="font-semibold">
                    ₹{totalToolingCost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Cost per Part:</span>
                  <div className="font-bold text-green-700">
                    ₹{costPerPart.toLocaleString('en-IN', { minimumFractionDigits: 4 })}
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
                                      onClick={() => handleUseCalculatorValue(value, calculatorTarget)}
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
              <div className="px-3 py-1.5 bg-primary/5 border border-border rounded text-xs text-muted-foreground flex items-center gap-1.5 mb-4 flex-shrink-0">
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