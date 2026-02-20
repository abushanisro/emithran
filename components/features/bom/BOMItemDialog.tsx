'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { toast } from 'sonner';
import { createBOMItem, updateBOMItem } from '@/lib/api/hooks/useBOMItems';
import { BOMItemType, ITEM_TYPE_LABELS } from '@/lib/types/bom.types';
import { apiClient } from '@/lib/api/client';
import { useQueryClient } from '@tanstack/react-query';

interface BOMItemDialogProps {
  bomId: string;
  item?: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  parentItemId?: string | null;
  defaultItemType?: BOMItemType;
  getAutoParent?: (type: BOMItemType) => string | null;
}

export function BOMItemDialog({ bomId, item, open, onOpenChange, onSuccess, parentItemId, defaultItemType, getAutoParent }: BOMItemDialogProps) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [autoParentId, setAutoParentId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    partNumber: '',
    description: '',
    itemType: defaultItemType || BOMItemType.ASSEMBLY,
    quantity: 1,
    annualVolume: 1000,
    unit: 'pcs',
    material: '',
    materialGrade: '',
    makeBuy: 'make' as 'make' | 'buy',
    unitCost: 0,
    weight: 0,
    maxLength: 0,
    maxWidth: 0,
    maxHeight: 0,
    surfaceArea: 0,
    file2d: null as File | null,
    file3d: null as File | null,
  });

  // Auto-assign parent when item type changes
  useEffect(() => {
    if (!item && getAutoParent) {
      const autoParent = getAutoParent(formData.itemType);
      setAutoParentId(autoParent);
    }
  }, [formData.itemType, getAutoParent, item]);

  useEffect(() => {
    if (item) {
      setFormData({
        name: item.name || '',
        partNumber: item.partNumber || '',
        description: item.description || '',
        itemType: item.itemType || BOMItemType.ASSEMBLY,
        quantity: item.quantity || 1,
        annualVolume: item.annualVolume || 1000,
        unit: item.unit || 'pcs',
        material: item.material || '',
        materialGrade: item.materialGrade || '',
        makeBuy: item.makeBuy || 'make',
        unitCost: item.unitCost || 0,
        weight: item.weight || 0,
        maxLength: item.maxLength || 0,
        maxWidth: item.maxWidth || 0,
        maxHeight: item.maxHeight || 0,
        surfaceArea: item.surfaceArea || 0,
        file2d: null,
        file3d: null,
      });
    } else {
      setFormData({
        name: '',
        partNumber: '',
        description: '',
        itemType: defaultItemType || BOMItemType.ASSEMBLY,
        quantity: 1,
        annualVolume: 1000,
        unit: 'pcs',
        material: '',
        materialGrade: '',
        makeBuy: 'make',
        unitCost: 0,
        weight: 0,
        maxLength: 0,
        maxWidth: 0,
        maxHeight: 0,
        surfaceArea: 0,
        file2d: null,
        file3d: null,
      });
    }
  }, [item, open, defaultItemType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Use explicit parentItemId if provided, otherwise use auto-assigned parent
      const finalParentId = parentItemId !== undefined ? parentItemId : autoParentId;

      const payload = {
        bomId,
        name: formData.name,
        partNumber: formData.partNumber || undefined,
        description: formData.description || undefined,
        itemType: formData.itemType,
        parentItemId: finalParentId || undefined,
        quantity: formData.quantity,
        annualVolume: formData.annualVolume,
        unit: formData.unit,
        material: formData.material || undefined,
        materialGrade: formData.materialGrade || undefined,
        makeBuy: formData.makeBuy,
        unitCost: formData.makeBuy === 'buy' ? formData.unitCost : undefined,
        weight: formData.weight || undefined,
        maxLength: formData.maxLength || undefined,
        maxWidth: formData.maxWidth || undefined,
        maxHeight: formData.maxHeight || undefined,
        surfaceArea: formData.surfaceArea || undefined,
      };

      let itemId: string;

      if (item) {
        await updateBOMItem(item.id, payload);
        itemId = item.id;
        toast.success('Item updated successfully');
      } else {
        const newItem = await createBOMItem(payload);
        itemId = newItem.id;
        toast.success('Item added successfully');
      }

      // Upload files if provided
      if (formData.file2d || formData.file3d) {
        const formDataUpload = new FormData();
        if (formData.file2d) {
          formDataUpload.append('file2d', formData.file2d);
        }
        if (formData.file3d) {
          formDataUpload.append('file3d', formData.file3d);
        }

        try {
          await apiClient.uploadFiles(`/bom-items/${itemId}/upload-files`, formDataUpload);
          toast.success('Files uploaded successfully');
        } catch (uploadError: any) {
          console.error('File upload error:', uploadError);
          let uploadErrorMessage = 'Item saved but file upload failed.';
          if (uploadError?.message) {
            if (uploadError.message.includes('size')) {
              uploadErrorMessage = 'Item saved but file upload failed: File size too large. Please use smaller files.';
            } else if (uploadError.message.includes('format')) {
              uploadErrorMessage = 'Item saved but file upload failed: Unsupported file format. Please use PDF, STEP, STL, or image files.';
            } else if (uploadError.message.includes('network')) {
              uploadErrorMessage = 'Item saved but file upload failed: Network error. You can try uploading the files later.';
            } else {
              uploadErrorMessage = `Item saved but file upload failed: ${uploadError.message}`;
            }
          }
          toast.error(uploadErrorMessage, { duration: 6000 });
        }
      }

      // Invalidate React Query cache to refresh the tree immediately
      await queryClient.invalidateQueries({ queryKey: ['bom-items', 'list', bomId] });

      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Error saving BOM item:', error);
      }
      
      let errorMessage = 'Failed to save item. Please try again.';
      if (error?.message) {
        if (error.message.includes('duplicate')) {
          errorMessage = 'An item with this part number already exists in the BOM. Please use a different part number.';
        } else if (error.message.includes('validation')) {
          errorMessage = 'Invalid item data. Please check all required fields (name, quantity, annual volume) and ensure they have valid values.';
        } else if (error.message.includes('network')) {
          errorMessage = 'Network connection failed. Please check your internet connection and try again.';
        } else if (error.message.includes('permission')) {
          errorMessage = 'You do not have permission to modify items in this BOM. Please contact your administrator.';
        } else if (error.message.includes('parent')) {
          errorMessage = 'Invalid parent item. Please ensure the parent item exists and is valid for this item type.';
        } else {
          errorMessage = `Failed to save item: ${error.message}`;
        }
      }
      
      toast.error(errorMessage, { duration: 6000 });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? 'Edit BOM Item' : 'Create BOM Item'}</DialogTitle>
          <DialogDescription>
            {item ? 'Update item details' : 'Add a new item to the Bill of Materials'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                placeholder="e.g., Cylinder Head Assembly"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="partNumber">Part Number</Label>
              <Input
                id="partNumber"
                placeholder="e.g., CH-2024-001"
                value={formData.partNumber}
                onChange={(e) => setFormData({ ...formData, partNumber: e.target.value })}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Detailed description of the part..."
                rows={3}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="materialGrade">Material Grade</Label>
              <Input
                id="materialGrade"
                placeholder="e.g., EN-GJL-250, AlSi10Mg"
                value={formData.materialGrade}
                onChange={(e) => setFormData({ ...formData, materialGrade: e.target.value })}
              />
            </div>

            {/* Make or Buy Decision */}
            <div className="grid gap-3 border-t pt-4">
              <Label>Make or Buy Decision</Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="makeBuy"
                    value="make"
                    checked={formData.makeBuy === 'make'}
                    onChange={(e) => setFormData({ ...formData, makeBuy: e.target.value as 'make' | 'buy' })}
                    className="h-4 w-4 text-primary"
                  />
                  <span className="text-sm">Manufacturing (Make)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="makeBuy"
                    value="buy"
                    checked={formData.makeBuy === 'buy'}
                    onChange={(e) => setFormData({ ...formData, makeBuy: e.target.value as 'make' | 'buy' })}
                    className="h-4 w-4 text-primary"
                  />
                  <span className="text-sm">Purchasing (Buy)</span>
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                {formData.makeBuy === 'make'
                  ? 'Part will be manufactured in-house'
                  : 'Part will be purchased from supplier'}
              </p>

              {/* Cost field - only shown for Buy option */}
              {formData.makeBuy === 'buy' && (
                <div className="grid gap-2 mt-2 p-4 border rounded-lg bg-muted/30">
                  <Label htmlFor="unitCost" className="flex items-center gap-2">
                    Unit Cost (Purchasing)
                    <span className="text-xs text-muted-foreground font-normal">(₹)</span>
                  </Label>
                  <Input
                    id="unitCost"
                    type="text"
                    placeholder="Enter supplier quoted price"
                    value={formData.unitCost || ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      const numValue = parseFloat(value);
                      if (value === '' || !isNaN(numValue)) {
                        setFormData({ ...formData, unitCost: value === '' ? 0 : numValue });
                      }
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Supplier quoted price per unit in Indian Rupees (INR)
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="file2d">2D Drawing (PDF, PNG, JPG)</Label>
                <Input
                  id="file2d"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf"
                  onChange={(e) => setFormData({ ...formData, file2d: e.target.files?.[0] || null })}
                />
                {formData.file2d && (
                  <p className="text-xs text-muted-foreground">Selected: {formData.file2d.name}</p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="file3d">3D Model (STEP, STL, OBJ)</Label>
                <Input
                  id="file3d"
                  type="file"
                  accept=".stp,.step,.stl,.obj,.iges,.igs"
                  onChange={(e) => setFormData({ ...formData, file3d: e.target.files?.[0] || null })}
                />
                {formData.file3d && (
                  <p className="text-xs text-muted-foreground">Selected: {formData.file3d.name}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="quantity">Quantity *</Label>
                <Input
                  id="quantity"
                  type="number"
                  min="1"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 1 })}
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="annualVolume">Annual Volume *</Label>
                <Input
                  id="annualVolume"
                  type="number"
                  min="1"
                  value={formData.annualVolume}
                  onChange={(e) => setFormData({ ...formData, annualVolume: parseInt(e.target.value) || 1 })}
                  required
                />
              </div>
            </div>

            {/* Physical Properties */}
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium mb-3">Physical Properties (Optional)</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="weight">Weight (kg)</Label>
                  <Input
                    id="weight"
                    type="number"
                    step="0.001"
                    min="0"
                    value={formData.weight || ''}
                    onChange={(e) => setFormData({ ...formData, weight: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="surfaceArea">Surface Area (mm²)</Label>
                  <Input
                    id="surfaceArea"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.surfaceArea || ''}
                    onChange={(e) => setFormData({ ...formData, surfaceArea: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="maxLength">Max Length (mm)</Label>
                  <Input
                    id="maxLength"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.maxLength || ''}
                    onChange={(e) => setFormData({ ...formData, maxLength: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="maxWidth">Max Width (mm)</Label>
                  <Input
                    id="maxWidth"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.maxWidth || ''}
                    onChange={(e) => setFormData({ ...formData, maxWidth: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="maxHeight">Max Height (mm)</Label>
                  <Input
                    id="maxHeight"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.maxHeight || ''}
                    onChange={(e) => setFormData({ ...formData, maxHeight: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="unit">UOM</Label>
                <Select
                  value={formData.unit}
                  onValueChange={(value) => setFormData({ ...formData, unit: value })}
                >
                  <SelectTrigger id="unit">
                    <SelectValue placeholder="Select unit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pcs">Pieces</SelectItem>
                    <SelectItem value="kg">Kilograms</SelectItem>
                    <SelectItem value="lbs">Pounds</SelectItem>
                    <SelectItem value="m">Meters</SelectItem>
                    <SelectItem value="ft">Feet</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="itemType">Type *</Label>
                <Select
                  value={formData.itemType}
                  onValueChange={(value) => setFormData({ ...formData, itemType: value as BOMItemType })}
                >
                  <SelectTrigger id="itemType">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!item && autoParentId && formData.itemType !== BOMItemType.ASSEMBLY && (
                  <p className="text-xs text-muted-foreground">
                    Will be added under: {
                      formData.itemType === BOMItemType.SUB_ASSEMBLY ? 'Latest Assembly' :
                        formData.itemType === BOMItemType.CHILD_PART ? 'Latest Sub-Assembly' : ''
                    }
                  </p>
                )}
              </div>
            </div>

          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                  {item ? 'Updating...' : 'Creating...'}
                </>
              ) : (
                item ? 'Update Item' : 'Create Item'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
