'use client';

import React, { useState, useEffect } from 'react';
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
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { LogisticsType, CostBasis } from '@/lib/api/hooks/usePackagingLogisticsCosts';

interface LogisticsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  editData?: any;
}

export function LogisticsDialog({
  open,
  onOpenChange,
  onSubmit,
  editData,
}: LogisticsDialogProps) {
  const [costName, setCostName] = useState<string>('');
  const [logisticsType, setLogisticsType] = useState<string>('');
  const [modeOfTransport, setModeOfTransport] = useState<string>('');
  const [costBasis, setCostBasis] = useState<string>('');
  const [parameters, setParameters] = useState<string>('');
  const [unitCost, setUnitCost] = useState<number>(0);
  const [quantity, setQuantity] = useState<number>(0);
  const [totalCost, setTotalCost] = useState<number>(0);

  // Load edit data
  useEffect(() => {
    if (editData && open) {
      setCostName(editData.costName || '');
      setLogisticsType(editData.logisticsType || '');
      setModeOfTransport(editData.modeOfTransport || '');
      setCostBasis(editData.costBasis || '');
      setParameters(editData.parameters?.raw || '');
      setUnitCost(editData.unitCost || 0);
      setQuantity(editData.quantity || 0);
      setTotalCost(editData.totalCost || 0);
    } else if (!editData && open) {
      // Reset for new entry
      setCostName('');
      setLogisticsType('');
      setModeOfTransport('');
      setCostBasis('');
      setParameters('');
      setUnitCost(0);
      setQuantity(0);
      setTotalCost(0);
    }
  }, [editData, open]);

  // Calculate total cost
  useEffect(() => {
    const total = unitCost * quantity;
    setTotalCost(total);
  }, [unitCost, quantity]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!costName) {
      return;
    }
    if (!logisticsType) {
      return;
    }
    if (!modeOfTransport) {
      return;
    }
    if (!costBasis) {
      return;
    }

    onSubmit({
      costName,
      logisticsType,
      modeOfTransport,
      costBasis,
      parameters,
      unitCost,
      quantity,
      totalCost,
    });

    // Reset form
    setCostName('');
    setLogisticsType('');
    setModeOfTransport('');
    setCostBasis('');
    setParameters('');
    setUnitCost(0);
    setQuantity(0);
    setTotalCost(0);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-primary">
            {editData ? 'Edit Logistics Item' : 'Add Logistics Item'}
          </DialogTitle>
          <DialogDescription>
            Configure packaging and logistics costs for this BOM item
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            {/* Cost Name */}
            <div className="space-y-2">
              <Label>Cost Name</Label>
              <Input
                type="text"
                value={costName}
                onChange={(e) => setCostName(e.target.value)}
                placeholder="e.g., Shipping to warehouse, Packaging materials, etc."
                required
              />
            </div>

            {/* Logistics Type & Mode of Transport */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Logistics Type</Label>
                <Select value={logisticsType} onValueChange={setLogisticsType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={LogisticsType.PACKAGING}>Packaging</SelectItem>
                    <SelectItem value={LogisticsType.INBOUND}>Inbound</SelectItem>
                    <SelectItem value={LogisticsType.OUTBOUND}>Outbound</SelectItem>
                    <SelectItem value={LogisticsType.STORAGE}>Storage</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Mode of Transport</Label>
                <Select value={modeOfTransport} onValueChange={setModeOfTransport}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Road">Road</SelectItem>
                    <SelectItem value="Rail">Rail</SelectItem>
                    <SelectItem value="Air">Air</SelectItem>
                    <SelectItem value="Sea">Sea</SelectItem>
                    <SelectItem value="Courier">Courier</SelectItem>
                    <SelectItem value="Local">Local</SelectItem>
                    <SelectItem value="N/A">N/A</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Cost Basis */}
            <div className="space-y-2">
              <Label>Cost Basis</Label>
              <Select value={costBasis} onValueChange={setCostBasis}>
                <SelectTrigger>
                  <SelectValue placeholder="Select basis" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CostBasis.PER_UNIT}>Per Unit</SelectItem>
                  <SelectItem value={CostBasis.PER_BATCH}>Per Batch</SelectItem>
                  <SelectItem value={CostBasis.PER_KG}>Per Kg (Weight)</SelectItem>
                  <SelectItem value={CostBasis.PER_KM}>Per Km (Distance)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Parameters */}
            <div className="space-y-2">
              <Label>Parameters</Label>
              <Input
                type="text"
                value={parameters}
                onChange={(e) => setParameters(e.target.value)}
                placeholder="e.g., Distance: 500km, Weight: 2kg, etc."
              />
            </div>

            {/* Unit Cost & Quantity */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Unit Cost ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={unitCost || ''}
                  onChange={(e) => setUnitCost(parseFloat(e.target.value) || 0)}
                  placeholder="Enter unit cost"
                />
              </div>

              <div className="space-y-2">
                <Label>Quantity</Label>
                <Input
                  type="number"
                  step="1"
                  min="0"
                  value={quantity || ''}
                  onChange={(e) => setQuantity(parseFloat(e.target.value) || 0)}
                  placeholder="Enter quantity"
                />
              </div>
            </div>

            {/* Total Cost Display */}
            <Card className="bg-primary/10 border border-primary/20">
              <CardContent className="pt-4 pb-4">
                <Label className="block mb-2">Total Cost</Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">USD</span>
                  <span className="text-2xl font-bold text-primary">${totalCost.toFixed(2)}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!costName || !logisticsType || !modeOfTransport || !costBasis}
            >
              {editData ? 'Update Item' : 'Add Item'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
