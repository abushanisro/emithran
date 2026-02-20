'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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
import { bomApi } from '@/lib/api/bom';
import { createBOMItem } from '@/lib/api/hooks/useBOMItems';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Plus, Trash2, Package } from 'lucide-react';
import { BOMItemType, ITEM_TYPE_LABELS } from '@/lib/types/bom.types';

interface ItemForm {
  id: string;
  name: string;
  partNumber: string;
  description: string;
  materialGrade: string;
  quantity: number;
  annualVolume: number;
  unit: string;
  itemType: BOMItemType;
  parentId?: string;
}

interface BOMCreateDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function BOMCreateDialog({ projectId, open, onOpenChange, onSuccess }: BOMCreateDialogProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [_currentStep, setCurrentStep] = useState<'bom' | 'items'>('bom');
  const [bomData, setBomData] = useState({
    name: '',
    version: '1.0',
    description: '',
  });

  // Items array - starts with an assembly
  const [items, setItems] = useState<ItemForm[]>([
    {
      id: 'item-1',
      name: '',
      partNumber: '',
      description: '',
      materialGrade: '',
      quantity: 1,
      annualVolume: 1000,
      unit: 'pcs',
      itemType: BOMItemType.ASSEMBLY,
    }
  ]);

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      setBomData({ name: '', version: '1.0', description: '' });
      setItems([
        {
          id: 'item-1',
          name: '',
          partNumber: '',
          description: '',
          materialGrade: '',
          quantity: 1,
          annualVolume: 1000,
          unit: 'pcs',
          itemType: BOMItemType.ASSEMBLY,
        }
      ]);
      setCurrentStep('bom');
    }
  }, [open]);

  const addItem = (type: BOMItemType) => {
    const newItem: ItemForm = {
      id: `item-${Date.now()}`,
      name: '',
      partNumber: '',
      description: '',
      materialGrade: '',
      quantity: 1,
      annualVolume: 1000,
      unit: 'pcs',
      itemType: type,
    };

    // Auto-assign parent based on type
    if (type === BOMItemType.SUB_ASSEMBLY) {
      // Find the last assembly
      const lastAssembly = [...items].reverse().find(i => i.itemType === BOMItemType.ASSEMBLY);
      if (lastAssembly) newItem.parentId = lastAssembly.id;
    } else if (type === BOMItemType.CHILD_PART) {
      // Find the last sub-assembly
      const lastSubAssembly = [...items].reverse().find(i => i.itemType === BOMItemType.SUB_ASSEMBLY);
      if (lastSubAssembly) newItem.parentId = lastSubAssembly.id;
    }

    setItems([...items, newItem]);
  };

  const removeItem = (id: string) => {
    // Can't remove if it's the only assembly
    const assemblies = items.filter(i => i.itemType === BOMItemType.ASSEMBLY);
    const itemToRemove = items.find(i => i.id === id);

    if (assemblies.length === 1 && itemToRemove?.itemType === BOMItemType.ASSEMBLY) {
      toast.error('Cannot remove the only assembly. Every BOM must have at least one main assembly item. Consider adding another assembly first.');
      return;
    }

    // Remove item and all descendants recursively
    const getDescendantIds = (parentId: string): string[] => {
      const directChildren = items.filter(i => i.parentId === parentId);
      return directChildren.flatMap(child => [child.id, ...getDescendantIds(child.id)]);
    };

    const idsToRemove = new Set([id, ...getDescendantIds(id)]);
    setItems(items.filter(i => !idsToRemove.has(i.id)));
  };

  const updateItem = (id: string, updates: Partial<ItemForm>) => {
    setItems(items.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Enhanced form validation
    if (!bomData.name.trim()) {
      toast.error('BOM name is required. Please enter a descriptive name for your Bill of Materials.');
      return;
    }

    if (items.every(item => !item.name.trim())) {
      toast.error('At least one BOM item is required. Please add items with descriptive names to complete your BOM.');
      return;
    }

    // Validate each item has required fields
    const invalidItems = items.filter(item => item.name.trim() && !item.quantity);
    if (invalidItems.length > 0) {
      toast.error(`Invalid quantities found for ${invalidItems.length} item(s). All items must have valid quantities greater than 0.`);
      return;
    }

    setLoading(true);

    try {
      // Step 1: Create the BOM
      const bomPayload = {
        projectId,
        name: bomData.name,
        version: bomData.version,
        description: bomData.description,
      };

      const createdBOM = await bomApi.create(bomPayload);

      if (!createdBOM || !createdBOM.id) {
        throw new Error('Invalid BOM response from server');
      }

      // Step 2: Create items in order (assemblies, then sub-assemblies, then child parts)
      // Keep track of temp ID -> real ID mapping
      const idMap = new Map<string, string>();
      const errors: Array<{ itemName: string; error: string }> = [];
      let successCount = 0;

      // Filter out empty items
      const validItems = items.filter(item => item.name.trim());

      // Sort items by hierarchy level
      const assemblies = validItems.filter(i => i.itemType === BOMItemType.ASSEMBLY);
      const subAssemblies = validItems.filter(i => i.itemType === BOMItemType.SUB_ASSEMBLY);
      const childParts = validItems.filter(i => i.itemType === BOMItemType.CHILD_PART);

      const orderedItems = [...assemblies, ...subAssemblies, ...childParts];

      for (const item of orderedItems) {
        try {
          // Check if parent exists in idMap (if item has a parent)
          if (item.parentId && !idMap.has(item.parentId)) {
            errors.push({
              itemName: item.name,
              error: 'Parent item failed to create - skipping',
            });
            continue;
          }

          const itemPayload = {
            bomId: createdBOM.id,
            name: item.name,
            partNumber: item.partNumber || undefined,
            description: item.description || undefined,
            materialGrade: item.materialGrade || undefined,
            quantity: item.quantity,
            annualVolume: item.annualVolume,
            unit: item.unit,
            itemType: item.itemType,
            parentItemId: item.parentId ? idMap.get(item.parentId) : undefined,
          };

          const createdItem = await createBOMItem(itemPayload);
          idMap.set(item.id, createdItem.id);
          successCount++;
        } catch (error: any) {
          let errorMessage = 'Unknown error occurred';
          if (error?.message) {
            if (error.message.includes('duplicate')) {
              errorMessage = 'Item with this part number already exists';
            } else if (error.message.includes('validation')) {
              errorMessage = 'Invalid item data provided';
            } else if (error.message.includes('network')) {
              errorMessage = 'Network connection failed';
            } else if (error.message.includes('permission')) {
              errorMessage = 'Insufficient permissions to create item';
            } else {
              errorMessage = error.message;
            }
          }
          errors.push({
            itemName: item.name,
            error: errorMessage,
          });
        }
      }

      // Report results with detailed feedback
      if (errors.length === 0) {
        toast.success(`BOM "${bomData.name}" created successfully with ${successCount} item(s). You can now proceed to add technical drawings and specifications.`);
      } else if (successCount > 0) {
        toast.warning(
          `BOM "${bomData.name}" created partially. ${successCount} item(s) succeeded, ${errors.length} failed. Failed items: ${errors.map(e => `${e.itemName} (${e.error})`).slice(0, 3).join(', ')}${errors.length > 3 ? '...' : ''}`,
          { duration: 8000 }
        );
      } else {
        const mainError = errors[0]?.error || 'Unknown error';
        throw new Error(`Failed to create any items. Primary issue: ${mainError}. Please check your data and try again.`);
      }

      onOpenChange(false);
      onSuccess?.();

      router.push(`/projects/${projectId}/bom/${createdBOM.id}`);
    } catch (error: any) {
      let errorMessage = 'Failed to create BOM. Please try again.';
      if (error?.message) {
        if (error.message.includes('network')) {
          errorMessage = 'Network connection failed. Please check your internet connection and try again.';
        } else if (error.message.includes('permission')) {
          errorMessage = 'You do not have permission to create BOMs in this project. Please contact your administrator.';
        } else if (error.message.includes('validation')) {
          errorMessage = 'Invalid BOM data provided. Please check all required fields and try again.';
        } else if (error.message.includes('duplicate')) {
          errorMessage = 'A BOM with this name already exists in the project. Please use a different name.';
        } else {
          errorMessage = `Failed to create BOM: ${error.message}`;
        }
      }
      toast.error(errorMessage, { duration: 6000 });
    } finally {
      setLoading(false);
    }
  };

  const getItemTypeColor = (type: BOMItemType) => {
    switch (type) {
      case BOMItemType.ASSEMBLY:
        return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20';
      case BOMItemType.SUB_ASSEMBLY:
        return 'bg-blue-500/10 text-blue-700 border-blue-500/20';
      case BOMItemType.CHILD_PART:
        return 'bg-purple-500/10 text-purple-700 border-purple-500/20';
      default:
        return 'bg-gray-500/10 text-gray-700 border-gray-500/20';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create BOM with Items</DialogTitle>
          <DialogDescription>
            Create a new Bill of Materials and add assembly, sub-assemblies, and child parts
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* BOM Details */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                1
              </div>
              <h3 className="font-semibold">BOM Details</h3>
            </div>

            <div className="grid gap-4 pl-10">
              <div className="grid gap-2">
                <Label htmlFor="bomName">BOM Name *</Label>
                <Input
                  id="bomName"
                  placeholder="e.g., Main Assembly BOM"
                  value={bomData.name}
                  onChange={(e) => setBomData({ ...bomData, name: e.target.value })}
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="bomVersion">Version</Label>
                  <Input
                    id="bomVersion"
                    placeholder="e.g., 1.0"
                    value={bomData.version}
                    onChange={(e) => setBomData({ ...bomData, version: e.target.value })}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="bomDescription">Description</Label>
                  <Input
                    id="bomDescription"
                    placeholder="Brief description"
                    value={bomData.description}
                    onChange={(e) => setBomData({ ...bomData, description: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </div>

          <Separator />

          {/* Items Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                  2
                </div>
                <h3 className="font-semibold">BOM Items ({items.length})</h3>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addItem(BOMItemType.SUB_ASSEMBLY)}
                  disabled={!items.some(i => i.itemType === BOMItemType.ASSEMBLY)}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Sub-Assembly
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addItem(BOMItemType.CHILD_PART)}
                  disabled={!items.some(i => i.itemType === BOMItemType.SUB_ASSEMBLY)}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Child Part
                </Button>
              </div>
            </div>

            <div className={`space-y-3 pl-2 md:pl-10`}>
              {items.map((item, _index) => (
                <div key={item.id} className={`border rounded-lg p-4 ${item.itemType === BOMItemType.SUB_ASSEMBLY ? 'ml-2 md:ml-6' : item.itemType === BOMItemType.CHILD_PART ? 'ml-4 md:ml-12' : ''}`}>
                  <div className="flex items-start gap-3 mb-3">
                    <Package className="h-5 w-5 mt-1 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder={`${ITEM_TYPE_LABELS[item.itemType]} name *`}
                          value={item.name}
                          onChange={(e) => updateItem(item.id, { name: e.target.value })}
                          className="font-medium"
                        />
                        <div className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${getItemTypeColor(item.itemType)}`}>
                          <span className="hidden sm:inline">{ITEM_TYPE_LABELS[item.itemType]}</span>
                          <span className="sm:hidden">
                            {/* FIX: Safe truncation for mobile view */}
                            {(ITEM_TYPE_LABELS[item.itemType] ?? '').split('-')[0]?.substring(0, 4)}
                          </span>
                        </div>
                        {items.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeItem(item.id)}
                            className="flex-shrink-0"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Input
                          placeholder="Part Number"
                          value={item.partNumber}
                          onChange={(e) => updateItem(item.id, { partNumber: e.target.value })}
                        />
                        <Input
                          placeholder="Material Grade"
                          value={item.materialGrade}
                          onChange={(e) => updateItem(item.id, { materialGrade: e.target.value })}
                        />
                      </div>

                      <Textarea
                        placeholder="Description"
                        value={item.description}
                        onChange={(e) => updateItem(item.id, { description: e.target.value })}
                        rows={2}
                      />

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <Label className="text-xs mb-1">Quantity</Label>
                          <Input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => updateItem(item.id, { quantity: parseInt(e.target.value) || 1 })}
                          />
                        </div>
                        <div>
                          <Label className="text-xs mb-1">Annual Volume</Label>
                          <Input
                            type="number"
                            min="1"
                            value={item.annualVolume}
                            onChange={(e) => updateItem(item.id, { annualVolume: parseInt(e.target.value) || 1 })}
                          />
                        </div>
                        <div>
                          <Label className="text-xs mb-1">UOM</Label>
                          <Select
                            value={item.unit}
                            onValueChange={(value) => updateItem(item.id, { unit: value })}
                          >
                            <SelectTrigger>
                              <SelectValue />
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
                      </div>
                    </div>
                  </div>
                </div>
              ))}
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
            <Button type="submit" disabled={loading || !bomData.name.trim()}>
              {loading ? (
                <>
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                  Creating BOM...
                </>
              ) : (
                `Create BOM with ${items.filter(i => i.name.trim()).length} item(s)`
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
