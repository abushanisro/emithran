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
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCalculateChildPartCost } from '@/lib/api/hooks/useChildPartCost';
import { Loader2 } from 'lucide-react';

interface ChildPartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  editData?: any;
}

export function ChildPartDialog({
  open,
  onOpenChange,
  onSubmit,
  editData,
}: ChildPartDialogProps) {
  // Form fields
  const [estimateName, setEstimateName] = useState<string>('');
  const [partNumber, setPartNumber] = useState<string>('');
  const [supplierLocation, setSupplierLocation] = useState<string>('');
  const [makeBuy, setMakeBuy] = useState<'make' | 'buy'>('buy');

  // Purchased part fields (buy)
  const [unitCost, setUnitCost] = useState<number>(0);
  const [freight, setFreight] = useState<number>(0);
  const [duty, setDuty] = useState<number>(0);
  const [overhead, setOverhead] = useState<number>(0);

  // Manufactured part fields (make)
  const [rawMaterialCost, setRawMaterialCost] = useState<number>(0);
  const [processCost, setProcessCost] = useState<number>(0);

  // Common fields
  const [quantity, setQuantity] = useState<number>(1);
  const [scrap, setScrap] = useState<number>(0);
  const [defectRate, setDefectRate] = useState<number>(0);
  const [moq, setMoq] = useState<number>(1);

  // Calculated cost result
  const [calculatedCost, setCalculatedCost] = useState<any>(null);

  // API hook for cost calculation
  const calculateCostMutation = useCalculateChildPartCost();

  // Load edit data
  useEffect(() => {
    if (editData && open) {
      setEstimateName(editData.estimateName || '');
      setPartNumber(editData.partNumber || '');
      setSupplierLocation(editData.supplierLocation || '');
      setMakeBuy(editData.makeBuy || 'buy');
      setUnitCost(editData.unitCost || 0);
      setFreight(editData.freight || 0);
      setDuty(editData.duty || 0);
      setOverhead(editData.overhead || 0);
      setRawMaterialCost(editData.rawMaterialCost || 0);
      setProcessCost(editData.processCost || 0);
      setQuantity(editData.quantity || 1);
      setScrap(editData.scrap || 0);
      setDefectRate(editData.defectRate || 0);
      setMoq(editData.moq || 1);
      setCalculatedCost(editData.calculatedCost || null);
    } else if (!editData && open) {
      // Reset for new entry
      setEstimateName('');
      setPartNumber('');
      setSupplierLocation('');
      setMakeBuy('buy');
      setUnitCost(0);
      setFreight(0);
      setDuty(0);
      setOverhead(0);
      setRawMaterialCost(0);
      setProcessCost(0);
      setQuantity(1);
      setScrap(0);
      setDefectRate(0);
      setMoq(1);
      setCalculatedCost(null);
    }
  }, [editData, open]);

  // Calculate cost in real-time when inputs change
  useEffect(() => {
    const timer = setTimeout(() => {
      // Only calculate if we have minimum required data
      if (makeBuy === 'buy' && unitCost > 0) {
        calculateCostMutation.mutate({
          makeBuy: 'buy',
          partNumber,
          partName: estimateName,
          unitCost,
          freight,
          duty,
          overhead,
          scrap,
          defectRate,
          quantity,
          moq,
          currency: 'INR',
        }, {
          onSuccess: (result) => {
            setCalculatedCost(result);
          },
        });
      } else if (makeBuy === 'make' && (rawMaterialCost > 0 || processCost > 0)) {
        calculateCostMutation.mutate({
          makeBuy: 'make',
          partNumber,
          partName: estimateName,
          rawMaterialCost,
          processCost,
          scrap,
          defectRate,
          quantity,
          moq,
          currency: 'INR',
        }, {
          onSuccess: (result) => {
            setCalculatedCost(result);
          },
        });
      } else {
        setCalculatedCost(null);
      }
    }, 500); // Debounce for 500ms

    return () => clearTimeout(timer);
  }, [makeBuy, unitCost, freight, duty, overhead, rawMaterialCost, processCost, scrap, defectRate, quantity, moq, partNumber, estimateName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!estimateName.trim()) {
      return;
    }
    if (!supplierLocation.trim()) {
      return;
    }
    if (quantity <= 0) {
      return;
    }
    if (makeBuy === 'buy' && unitCost <= 0) {
      return;
    }
    if (makeBuy === 'make' && rawMaterialCost <= 0 && processCost <= 0) {
      return;
    }

    onSubmit({
      id: editData?.id,
      estimateName,
      partNumber,
      supplierLocation,
      makeBuy,
      unitCost,
      freight,
      duty,
      overhead,
      rawMaterialCost,
      processCost,
      quantity,
      scrap,
      defectRate,
      moq,
      totalCost: calculatedCost?.totalCostPerPart || 0,
      extendedCost: calculatedCost?.extendedCost || 0,
      calculatedCost,
    });

    // Reset form
    setEstimateName('');
    setPartNumber('');
    setSupplierLocation('');
    setMakeBuy('buy');
    setUnitCost(0);
    setFreight(0);
    setDuty(0);
    setOverhead(0);
    setRawMaterialCost(0);
    setProcessCost(0);
    setQuantity(1);
    setScrap(0);
    setDefectRate(0);
    setMoq(1);
    setCalculatedCost(null);
    onOpenChange(false);
  };

  const totalCost = calculatedCost?.totalCostPerPart || 0;
  const extendedCost = calculatedCost?.extendedCost || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-primary">
            {editData ? 'Edit Child Part' : 'Add Child Part'}
          </DialogTitle>
          <DialogDescription>
            Add child parts with quantities and calculate assembly costs
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            {/* Basic Information */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Part Name / Estimate Name *</Label>
                <Input
                  type="text"
                  value={estimateName}
                  onChange={(e) => setEstimateName(e.target.value)}
                  placeholder="Enter part name"
                />
              </div>

              <div className="space-y-2">
                <Label>Part Number</Label>
                <Input
                  type="text"
                  value={partNumber}
                  onChange={(e) => setPartNumber(e.target.value)}
                  placeholder="Enter part number"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Supplier Location *</Label>
                <Input
                  type="text"
                  value={supplierLocation}
                  onChange={(e) => setSupplierLocation(e.target.value)}
                  placeholder="Enter supplier location"
                />
              </div>

              <div className="space-y-2">
                <Label>Make/Buy Decision *</Label>
                <Select value={makeBuy} onValueChange={(value: 'make' | 'buy') => setMakeBuy(value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select make or buy" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="buy">Buy (Purchased)</SelectItem>
                    <SelectItem value="make">Make (Manufactured)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Purchased Part Fields */}
            {makeBuy === 'buy' && (
              <>
                <div className="border-l-4 border-l-blue-500 pl-4 bg-blue-50 dark:bg-blue-950/20 py-3 rounded">
                  <h4 className="font-semibold text-sm mb-3">Purchased Part Costs</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Unit Cost ($) *</Label>
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
                      <Label>Freight (%)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={freight || ''}
                        onChange={(e) => setFreight(parseFloat(e.target.value) || 0)}
                        placeholder="Enter freight %"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Duty (%)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={duty || ''}
                        onChange={(e) => setDuty(parseFloat(e.target.value) || 0)}
                        placeholder="Enter duty %"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Overhead (%)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max="500"
                        value={overhead || ''}
                        onChange={(e) => setOverhead(parseFloat(e.target.value) || 0)}
                        placeholder="Enter overhead %"
                      />
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Manufactured Part Fields */}
            {makeBuy === 'make' && (
              <>
                <div className="border-l-4 border-l-green-500 pl-4 bg-green-50 dark:bg-green-950/20 py-3 rounded">
                  <h4 className="font-semibold text-sm mb-3">Manufactured Part Costs</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Raw Material Cost ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={rawMaterialCost || ''}
                        onChange={(e) => setRawMaterialCost(parseFloat(e.target.value) || 0)}
                        placeholder="Enter raw material cost"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Process Cost ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={processCost || ''}
                        onChange={(e) => setProcessCost(parseFloat(e.target.value) || 0)}
                        placeholder="Enter process cost"
                      />
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Quality and Quantity Parameters */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Quantity per Assembly *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={quantity || ''}
                  onChange={(e) => setQuantity(parseFloat(e.target.value) || 1)}
                  placeholder="Enter quantity"
                />
              </div>

              <div className="space-y-2">
                <Label>MOQ (Minimum Order Qty)</Label>
                <Input
                  type="number"
                  step="1"
                  min="1"
                  value={moq || ''}
                  onChange={(e) => setMoq(parseInt(e.target.value) || 1)}
                  placeholder="Enter MOQ"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Scrap (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="50"
                  value={scrap || ''}
                  onChange={(e) => setScrap(parseFloat(e.target.value) || 0)}
                  placeholder="Enter scrap %"
                />
              </div>

              <div className="space-y-2">
                <Label>Defect Rate (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="50"
                  value={defectRate || ''}
                  onChange={(e) => setDefectRate(parseFloat(e.target.value) || 0)}
                  placeholder="Enter defect rate %"
                />
              </div>
            </div>

            {/* Cost Summary */}
            <Card className="bg-primary/10 border border-primary/20">
              <CardContent className="pt-4 pb-4">
                {calculateCostMutation.isPending ? (
                  <div className="flex items-center justify-center gap-2 py-4">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Calculating...</span>
                  </div>
                ) : calculatedCost ? (
                  <>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <Label className="text-xs text-muted-foreground">Cost Per Part</Label>
                        <div className="text-2xl font-bold text-primary">
                          ${totalCost.toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Extended Cost (×{quantity})</Label>
                        <div className="text-2xl font-bold text-primary">
                          ${extendedCost.toFixed(2)}
                        </div>
                      </div>
                    </div>

                    {/* Cost Breakdown */}
                    <div className="border-t pt-3 space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Base Cost:</span>
                        <span>${calculatedCost.baseCost?.toFixed(2)}</span>
                      </div>
                      {makeBuy === 'buy' && (
                        <>
                          {calculatedCost.freightCost > 0 && (
                            <div className="flex justify-between text-xs">
                              <span className="text-muted-foreground">Freight:</span>
                              <span>${calculatedCost.freightCost?.toFixed(2)}</span>
                            </div>
                          )}
                          {calculatedCost.dutyCost > 0 && (
                            <div className="flex justify-between text-xs">
                              <span className="text-muted-foreground">Duty:</span>
                              <span>${calculatedCost.dutyCost?.toFixed(2)}</span>
                            </div>
                          )}
                          {calculatedCost.overheadCost > 0 && (
                            <div className="flex justify-between text-xs">
                              <span className="text-muted-foreground">Overhead:</span>
                              <span>${calculatedCost.overheadCost?.toFixed(2)}</span>
                            </div>
                          )}
                        </>
                      )}
                      {calculatedCost.scrapAdjustment > 0 && (
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Scrap Adjustment:</span>
                          <span>${calculatedCost.scrapAdjustment?.toFixed(2)}</span>
                        </div>
                      )}
                      {calculatedCost.defectAdjustment > 0 && (
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Defect Adjustment:</span>
                          <span>${calculatedCost.defectAdjustment?.toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-4 text-sm text-muted-foreground">
                    Enter {makeBuy === 'buy' ? 'unit cost' : 'raw material or process cost'} to see calculation
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !estimateName.trim() ||
                !supplierLocation.trim() ||
                quantity <= 0 ||
                (makeBuy === 'buy' && unitCost <= 0) ||
                (makeBuy === 'make' && rawMaterialCost <= 0 && processCost <= 0)
              }
            >
              {editData ? 'Update Child Part' : 'Add Child Part'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
