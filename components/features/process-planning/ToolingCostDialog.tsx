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

interface ToolingCostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  initialData?: any;
  bomItem?: any;
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

export function ToolingCostDialog({
  open,
  onOpenChange,
  onSubmit,
  initialData,
  bomItem,
}: ToolingCostDialogProps) {
  const [formData, setFormData] = useState({
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
  }, [initialData, open]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {initialData ? 'Edit Tooling Item' : 'Add Tooling Item'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
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
                {Object.entries(
                  TOOLING_TYPES.reduce((acc, tool) => {
                    if (!acc[tool.category]) acc[tool.category] = [];
                    acc[tool.category].push(tool);
                    return acc;
                  }, {} as Record<string, typeof TOOLING_TYPES>)
                ).map(([category, tools]) => (
                  <div key={category}>
                    <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase">
                      {category.replace('_', ' ')}
                    </div>
                    {tools.map((tool) => (
                      <SelectItem key={tool.value} value={tool.value}>
                        {tool.label}
                      </SelectItem>
                    ))}
                  </div>
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
      </DialogContent>
    </Dialog>
  );
}