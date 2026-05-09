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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_ITEM = (): ItemForm => ({
  id: 'item-1',
  name: '',
  partNumber: '',
  description: '',
  materialGrade: '',
  quantity: 1,
  annualVolume: 1000,
  unit: 'pcs',
  itemType: BOMItemType.ASSEMBLY,
});

const ITEM_TYPE_COLORS: Record<BOMItemType, string> = {
  [BOMItemType.ASSEMBLY]:     'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
  [BOMItemType.SUB_ASSEMBLY]: 'bg-blue-500/10 text-blue-700 border-blue-500/20',
  [BOMItemType.CHILD_PART]:   'bg-purple-500/10 text-purple-700 border-purple-500/20',
};

function getItemTypeColor(type: BOMItemType): string {
  return ITEM_TYPE_COLORS[type] ?? 'bg-gray-500/10 text-gray-700 border-gray-500/20';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Unknown error occurred';
}

function friendlyItemError(msg: string): string {
  if (msg.includes('duplicate'))  return 'Item with this part number already exists';
  if (msg.includes('validation')) return 'Invalid item data provided';
  if (msg.includes('network'))    return 'Network connection failed';
  if (msg.includes('permission')) return 'Insufficient permissions to create item';
  return msg;
}

function friendlyBomError(msg: string): string {
  if (msg.includes('network'))    return 'Network connection failed. Please check your internet connection and try again.';
  if (msg.includes('permission')) return 'You do not have permission to create BOMs in this project. Please contact your administrator.';
  if (msg.includes('validation')) return 'Invalid BOM data provided. Please check all required fields and try again.';
  if (msg.includes('duplicate'))  return 'A BOM with this name already exists in the project. Please use a different name.';
  return `Failed to create BOM: ${msg}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BOMCreateDialog({ projectId, open, onOpenChange, onSuccess }: BOMCreateDialogProps) {
  const router = useRouter();

  const [loading,  setLoading]  = useState(false);
  const [bomData,  setBomData]  = useState({ name: '', version: '1.0', description: '' });
  const [items,    setItems]    = useState<ItemForm[]>([DEFAULT_ITEM()]);

  // Reset on open/close
  useEffect(() => {
    if (open) {
      setBomData({ name: '', version: '1.0', description: '' });
      setItems([DEFAULT_ITEM()]);
    }
  }, [open]);

  // -------------------------------------------------------------------------
  // Item management
  // -------------------------------------------------------------------------

  const addItem = (type: BOMItemType) => {
    const newItem: ItemForm = {
      id:           `item-${Date.now()}`,
      name:         '',
      partNumber:   '',
      description:  '',
      materialGrade: '',
      quantity:     1,
      annualVolume: 1000,
      unit:         'pcs',
      itemType:     type,
    };

    if (type === BOMItemType.SUB_ASSEMBLY) {
      const last = [...items].reverse().find(i => i.itemType === BOMItemType.ASSEMBLY);
      if (last) newItem.parentId = last.id;
    } else if (type === BOMItemType.CHILD_PART) {
      const last = [...items].reverse().find(i => i.itemType === BOMItemType.SUB_ASSEMBLY);
      if (last) newItem.parentId = last.id;
    }

    setItems(prev => [...prev, newItem]);
  };

  const removeItem = (id: string) => {
    const assemblies   = items.filter(i => i.itemType === BOMItemType.ASSEMBLY);
    const itemToRemove = items.find(i => i.id === id);

    if (assemblies.length === 1 && itemToRemove?.itemType === BOMItemType.ASSEMBLY) {
      toast.error('Cannot remove the only assembly. Every BOM must have at least one main assembly item.');
      return;
    }

    const getDescendantIds = (parentId: string): string[] => {
      const children = items.filter(i => i.parentId === parentId);
      return children.flatMap(c => [c.id, ...getDescendantIds(c.id)]);
    };

    const toRemove = new Set([id, ...getDescendantIds(id)]);
    setItems(prev => prev.filter(i => !toRemove.has(i.id)));
  };

  const updateItem = (id: string, updates: Partial<ItemForm>) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!bomData.name.trim()) {
      toast.error('BOM name is required. Please enter a descriptive name for your Bill of Materials.');
      return;
    }

    if (items.every(item => !item.name.trim())) {
      toast.error('At least one BOM item is required. Please add items with descriptive names.');
      return;
    }

    const invalidItems = items.filter(item => item.name.trim() && !item.quantity);
    if (invalidItems.length > 0) {
      toast.error(`Invalid quantities for ${invalidItems.length} item(s). All items must have valid quantities greater than 0.`);
      return;
    }

    setLoading(true);

    try {
      // Step 1 — create the BOM
      const createdBOM = await bomApi.create({
        projectId,
        name:        bomData.name,
        version:     bomData.version,
        description: bomData.description,
      });

      if (!createdBOM?.id) throw new Error('Invalid BOM response from server');

      // Step 2 — create items in hierarchy order
      const idMap    = new Map<string, string>();
      const errors: Array<{ itemName: string; error: string }> = [];
      let successCount = 0;

      const validItems = items.filter(item => item.name.trim());
      const orderedItems = [
        ...validItems.filter(i => i.itemType === BOMItemType.ASSEMBLY),
        ...validItems.filter(i => i.itemType === BOMItemType.SUB_ASSEMBLY),
        ...validItems.filter(i => i.itemType === BOMItemType.CHILD_PART),
      ];

      for (const item of orderedItems) {
        if (item.parentId && !idMap.has(item.parentId)) {
          errors.push({ itemName: item.name, error: 'Parent item failed to create — skipping' });
          continue;
        }

        try {
          // Build with all optional fields (possibly undefined), then strip
          // undefined keys so the object satisfies CreateBOMItemDto at runtime.
          // The cast is safe because Object.fromEntries removes every undefined
          // value — TypeScript just can't infer that narrowing automatically.
          const raw = {
            bomId:        createdBOM.id,
            name:         item.name,
            quantity:     item.quantity,
            annualVolume: item.annualVolume,
            unit:         item.unit,
            itemType:     item.itemType,
            partNumber:   item.partNumber   || undefined,
            description:  item.description  || undefined,
            materialGrade: item.materialGrade || undefined,
            parentItemId: item.parentId ? idMap.get(item.parentId) : undefined,
          };

          // Fix TS2345: remove all keys whose value is undefined so the
          // resulting object never carries `string | undefined` on any field.
          const itemPayload = Object.fromEntries(
            Object.entries(raw).filter(([, v]) => v !== undefined),
          ) as unknown as Parameters<typeof createBOMItem>[0];

          const createdItem = await createBOMItem(itemPayload);
          idMap.set(item.id, createdItem.id);
          successCount++;
        } catch (error: unknown) {
          errors.push({ itemName: item.name, error: friendlyItemError(getErrorMessage(error)) });
        }
      }

      // Report results
      if (errors.length === 0) {
        toast.success(`BOM "${bomData.name}" created successfully with ${successCount} item(s).`);
      } else if (successCount > 0) {
        const sample = errors.slice(0, 3).map(e => `${e.itemName} (${e.error})`).join(', ');
        toast.warning(
          `BOM created partially. ${successCount} succeeded, ${errors.length} failed. ${sample}${errors.length > 3 ? '…' : ''}`,
          { duration: 8_000 },
        );
      } else {
        throw new Error(`Failed to create any items. Primary issue: ${errors[0]?.error ?? 'Unknown'}. Please check your data and try again.`);
      }

      onOpenChange(false);
      onSuccess?.();
      router.push(`/projects/${projectId}/bom/${createdBOM.id}`);

    } catch (error: unknown) {
      toast.error(friendlyBomError(getErrorMessage(error)), { duration: 6_000 });
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

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

          {/* ── Step 1: BOM details ───────────────────────────────────────── */}
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
                  onChange={e => setBomData({ ...bomData, name: e.target.value })}
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
                    onChange={e => setBomData({ ...bomData, version: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="bomDescription">Description</Label>
                  <Input
                    id="bomDescription"
                    placeholder="Brief description"
                    value={bomData.description}
                    onChange={e => setBomData({ ...bomData, description: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </div>

          <Separator />

          {/* ── Step 2: BOM items ─────────────────────────────────────────── */}
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

            <div className="space-y-3 pl-2 md:pl-10">
              {items.map(item => (
                <div
                  key={item.id}
                  className={[
                    'border rounded-lg p-4',
                    item.itemType === BOMItemType.SUB_ASSEMBLY ? 'ml-2 md:ml-6'  : '',
                    item.itemType === BOMItemType.CHILD_PART   ? 'ml-4 md:ml-12' : '',
                  ].join(' ')}
                >
                  <div className="flex items-start gap-3 mb-3">
                    <Package className="h-5 w-5 mt-1 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 space-y-3">

                      {/* Name row */}
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder={`${ITEM_TYPE_LABELS[item.itemType]} name *`}
                          value={item.name}
                          onChange={e => updateItem(item.id, { name: e.target.value })}
                          className="font-medium"
                        />
                        <div className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${getItemTypeColor(item.itemType)}`}>
                          <span className="hidden sm:inline">{ITEM_TYPE_LABELS[item.itemType]}</span>
                          <span className="sm:hidden">
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

                      {/* Part number / material */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Input
                          placeholder="Part Number"
                          value={item.partNumber}
                          onChange={e => updateItem(item.id, { partNumber: e.target.value })}
                        />
                        <Input
                          placeholder="Material Grade"
                          value={item.materialGrade}
                          onChange={e => updateItem(item.id, { materialGrade: e.target.value })}
                        />
                      </div>

                      {/* Description */}
                      <Textarea
                        placeholder="Description"
                        value={item.description}
                        onChange={e => updateItem(item.id, { description: e.target.value })}
                        rows={2}
                      />

                      {/* Quantity / volume / UOM */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <Label className="text-xs mb-1">Quantity</Label>
                          <Input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={e => updateItem(item.id, { quantity: parseInt(e.target.value) || 1 })}
                          />
                        </div>
                        <div>
                          <Label className="text-xs mb-1">Annual Volume</Label>
                          <Input
                            type="number"
                            min="1"
                            value={item.annualVolume}
                            onChange={e => updateItem(item.id, { annualVolume: parseInt(e.target.value) || 1 })}
                          />
                        </div>
                        <div>
                          <Label className="text-xs mb-1">UOM</Label>
                          <Select value={item.unit} onValueChange={value => updateItem(item.id, { unit: value })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
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