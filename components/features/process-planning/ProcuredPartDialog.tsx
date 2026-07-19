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

interface ProcuredPartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  editData?: any;
}

export function ProcuredPartDialog({
  open,
  onOpenChange,
  onSubmit,
  editData,
}: ProcuredPartDialogProps) {
  const [part, setPart] = useState<string>('');
  const [unitCost, setUnitCost] = useState<number>(0);
  const [noOff, setNoOff] = useState<number>(0);
  const [scrapPercentage, setScrapPercentage] = useState<number | ''>('');
  const [overheadPercentage, setOverheadPercentage] = useState<number | ''>('');
  const [totalCost, setTotalCost] = useState<number>(0);

  // Load edit data
  useEffect(() => {
    if (editData && open) {
      setPart(editData.part || '');
      setUnitCost(editData.unitCost || 0);
      setNoOff(editData.noOff || 0);
      setScrapPercentage(editData.scrapPercentage || 0);
      setOverheadPercentage(editData.overheadPercentage || 0);
      setTotalCost(editData.totalCost || 0);
    } else if (!editData && open) {
      // Reset for new entry
      setPart('');
      setUnitCost(0);
      setNoOff(0);
      setScrapPercentage(0);
      setOverheadPercentage(0);
      setTotalCost(0);
    }
  }, [editData, open]);

  // Calculate total cost
  useEffect(() => {
    const baseCost = unitCost * noOff;
    const scrapPercent = typeof scrapPercentage === 'number' ? scrapPercentage : 0;
    const overheadPercent = typeof overheadPercentage === 'number' ? overheadPercentage : 0;
    const scrapCost = (baseCost * scrapPercent) / 100;
    const overheadCost = (baseCost * overheadPercent) / 100;
    const total = baseCost + scrapCost + overheadCost;
    setTotalCost(Math.max(0, total));
  }, [unitCost, noOff, scrapPercentage, overheadPercentage]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!part.trim()) {
      return;
    }
    if (unitCost <= 0) {
      return;
    }
    if (noOff <= 0) {
      return;
    }

    onSubmit({
      id: editData?.id,
      part,
      unitCost,
      noOff,
      scrapPercentage,
      overheadPercentage,
      totalCost,
    });

    // Reset form
    setPart('');
    setUnitCost(0);
    setNoOff(0);
    setScrapPercentage(0);
    setOverheadPercentage(0);
    setTotalCost(0);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-primary">
            {editData ? 'Edit Procured Part' : 'Add Procured Part'}
          </DialogTitle>
          <DialogDescription>
            Add purchased parts from suppliers with pricing and lead times
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            {/* Part Name */}
            <div className="space-y-2">
              <Label>Part Name</Label>
              <Input
                type="text"
                value={part}
                onChange={(e) => setPart(e.target.value)}
                placeholder="Enter part name"
              />
            </div>

            {/* Unit Cost and No Off */}
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
                <Label>No Off (Quantity)</Label>
                <Input
                  type="number"
                  step="1"
                  min="0"
                  value={noOff || ''}
                  onChange={(e) => setNoOff(parseFloat(e.target.value) || 0)}
                  placeholder="Enter quantity"
                />
              </div>
            </div>

            {/* Scrap % and Overhead % */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Scrap %</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={scrapPercentage === '' ? '' : scrapPercentage.toString()}
                  onChange={(e) => {
                    const value = e.target.value;
                    setScrapPercentage(value === '' ? '' : Number(value) || 0);
                  }}
                  placeholder="Enter scrap percentage"
                />
              </div>

              <div className="space-y-2">
                <Label>Overhead %</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={overheadPercentage === '' ? '' : overheadPercentage.toString()}
                  onChange={(e) => {
                    const value = e.target.value;
                    setOverheadPercentage(value === '' ? '' : Number(value) || 0);
                  }}
                  placeholder="Enter overhead percentage"
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
              disabled={!part.trim() || unitCost <= 0 || noOff <= 0}
            >
              {editData ? 'Update Procured Part' : 'Add Procured Part'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
