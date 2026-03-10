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

interface EnhancedToolingCostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  initialData?: any;
  bomItem?: any;
  selectedProcess?: string | null;
  selectedSubProcess?: string | null;
  processHierarchy?: any;
  toolTypeDefinitions?: any;
}

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

export function EnhancedToolingCostDialog({
  open,
  onOpenChange,
  onSubmit,
  initialData,
  bomItem,
  selectedProcess,
  selectedSubProcess,
  processHierarchy,
  toolTypeDefinitions,
}: EnhancedToolingCostDialogProps) {
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
  const selectedProcessData = processHierarchy ? processHierarchy[formData.manufacturingProcess] : null;
  const availableSubProcesses = selectedProcessData ? Object.entries(selectedProcessData.subProcesses) : [];
  const selectedSubProcessData = selectedProcessData?.subProcesses[formData.subProcess];

  // Filter tooling types based on selected sub-process
  const getRecommendedTools = () => {
    if (!selectedSubProcessData?.toolTypes) return TOOLING_TYPES;
    
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
                  {processHierarchy?.[selectedProcess]?.label}
                </Badge>
                <span className="text-xs text-muted-foreground">→</span>
                <Badge variant="outline" className="text-xs">
                  {processHierarchy?.[selectedProcess]?.subProcesses[selectedSubProcess]?.label}
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
                  {processHierarchy && Object.entries(processHierarchy).map(([key, process]: [string, any]) => (
                    <SelectItem key={key} value={key}>
                      <div className="flex items-center gap-2">
                        <span>{process.icon}</span>
                        <span>{process.label}</span>
                      </div>
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
                  {availableSubProcesses.map(([key, subProcess]: [string, any]) => (
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
                    {toolTypeDefinitions?.[toolType]?.label || toolType.replace('_', ' ')}
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
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {selectedTooling.category.replace('_', ' ').toUpperCase()}
                </Badge>
                {toolTypeDefinitions?.[selectedTooling.value] && (
                  <p className="text-xs text-muted-foreground">
                    {toolTypeDefinitions[selectedTooling.value].description}
                  </p>
                )}
              </div>
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
              <Label htmlFor="specifications">Specifications</Label>
              <Input
                id="specifications"
                value={formData.specifications}
                onChange={(e) => setFormData(prev => ({ ...prev, specifications: e.target.value }))}
                placeholder="Technical specifications"
              />
            </div>
          </div>

          {/* Cost and Quantity */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="unitCost">Unit Cost (₹) *</Label>
              <Input
                id="unitCost"
                type="number"
                step="0.01"
                value={formData.unitCost}
                onChange={(e) => setFormData(prev => ({ ...prev, unitCost: e.target.value }))}
                placeholder="0.00"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                type="number"
                step="1"
                min="1"
                value={formData.quantity}
                onChange={(e) => setFormData(prev => ({ ...prev, quantity: e.target.value }))}
                placeholder="1"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="amortizationParts">Amortization (Parts)</Label>
              <Input
                id="amortizationParts"
                type="number"
                step="1"
                min="1"
                value={formData.amortizationParts}
                onChange={(e) => setFormData(prev => ({ ...prev, amortizationParts: e.target.value }))}
                placeholder="Total parts to produce"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="usagePercentage">Usage %</Label>
              <Input
                id="usagePercentage"
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={formData.usagePercentage}
                onChange={(e) => setFormData(prev => ({ ...prev, usagePercentage: e.target.value }))}
                placeholder="100"
              />
            </div>
          </div>

          {/* Cost Calculation Display */}
          {formData.unitCost && formData.amortizationParts && (
            <div className="p-4 bg-secondary/20 rounded-lg">
              <h3 className="font-semibold text-sm mb-2">Cost Calculation</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Total Tooling Investment:</span>
                  <div className="font-semibold">₹{totalToolingCost.toFixed(2)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Cost per Part:</span>
                  <div className="font-semibold text-primary">₹{costPerPart.toFixed(4)}</div>
                </div>
              </div>
            </div>
          )}

          {/* Custom Tooling Options */}
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="isCustom"
                checked={formData.isCustom}
                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isCustom: !!checked }))}
              />
              <Label htmlFor="isCustom" className="text-sm font-medium">
                Custom/Special Tooling
              </Label>
              <Badge variant="outline" className="text-xs">Requires supplier info</Badge>
            </div>

            {formData.isCustom && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
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
                  <Label htmlFor="leadTime">Lead Time (days)</Label>
                  <Input
                    id="leadTime"
                    type="number"
                    value={formData.leadTime}
                    onChange={(e) => setFormData(prev => ({ ...prev, leadTime: e.target.value }))}
                    placeholder="0"
                  />
                </div>
                <div className="md:col-span-2 space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    value={formData.notes}
                    onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder="Additional notes, special requirements..."
                    rows={3}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Form Actions */}
          <div className="flex justify-end space-x-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">
              {initialData ? 'Update' : 'Add'} Tooling
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}