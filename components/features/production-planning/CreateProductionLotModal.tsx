'use client';

import { useState, useCallback, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, X } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useBOMs } from '@/lib/api/hooks/useBOM';
import { useBOMItems } from '@/lib/api/hooks/useBOMItems';
import { useCreateProductionLot } from '@/lib/api/hooks/useProductionPlanning';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const createLotSchema = z.object({
  bomId: z.string().min(1, 'Please select a BOM'),
  lotNumber: z.string().min(1, 'Lot number is required'),
  productionQuantity: z.number().min(1, 'Quantity must be at least 1'),
  plannedStartDate: z.date({
    required_error: 'Start date is required',
  }),
  plannedEndDate: z.date({
    required_error: 'End date is required',
  }),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  lotType: z.enum(['standard', 'prototype', 'rework', 'urgent']),
  remarks: z.string().optional(),
  selectedBomItemIds: z.array(z.string()).min(1, 'Please select at least one BOM item'),
});

type CreateLotFormValues = z.infer<typeof createLotSchema>;

interface CreateProductionLotModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string;
}

export function CreateProductionLotModal({ open, onOpenChange, projectId }: CreateProductionLotModalProps) {
  const [bomSearch, setBomSearch] = useState('');
  const [selectedBomId, setSelectedBomId] = useState<string>('');
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [itemSearch, setItemSearch] = useState('');

  const { data: bomsData, isLoading: isLoadingBOMs } = useBOMs();
  const { data: bomItemsData, isLoading: isLoadingBOMItems } = useBOMItems(selectedBomId || undefined);
  const createLotMutation = useCreateProductionLot();

  const form = useForm<CreateLotFormValues>({
    resolver: zodResolver(createLotSchema),
    defaultValues: {
      bomId: '',
      lotNumber: '',
      productionQuantity: 1,
      priority: 'medium',
      lotType: 'standard',
      remarks: '',
      selectedBomItemIds: [],
    },
  });

  let boms = bomsData?.boms || [];
  
  if (projectId) {
    boms = boms.filter(bom => bom.projectId === projectId);
  }
  
  const filteredBOMs = boms.filter(bom =>
    bom.name.toLowerCase().includes(bomSearch.toLowerCase()) ||
    bom.description?.toLowerCase().includes(bomSearch.toLowerCase())
  );

  const generateLotNumber = () => {
    const date = new Date();
    const dateStr = format(date, 'yyyyMMdd');
    const randomNum = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `LOT-${dateStr}-${randomNum}`;
  };

  const handleBomChange = (bomId: string) => {
    setSelectedBomId(bomId);
    setSelectedItemIds([]);
    setItemSearch('');
    form.setValue('selectedBomItemIds', []);
  };

  const handleItemToggle = useCallback((itemId: string) => {
    setSelectedItemIds(prev => {
      const newSelection = prev.includes(itemId)
        ? prev.filter(id => id !== itemId)
        : [...prev, itemId];
      return newSelection;
    });
  }, []);

  const filteredBomItems = bomItemsData?.items.filter(item =>
    item.partNumber?.toLowerCase().includes(itemSearch.toLowerCase()) ||
    item.description?.toLowerCase().includes(itemSearch.toLowerCase()) ||
    item.itemType?.toLowerCase().includes(itemSearch.toLowerCase()) ||
    item.materialGrade?.toLowerCase().includes(itemSearch.toLowerCase())
  ) || [];

  const handleSelectAllItems = () => {
    const visibleItemIds = filteredBomItems.map(item => item.id);
    const areAllVisibleSelected = visibleItemIds.length > 0 && visibleItemIds.every(id => selectedItemIds.includes(id));
    
    setSelectedItemIds(prev => {
      let newSelection: string[];
      if (areAllVisibleSelected) {
        newSelection = prev.filter(id => !visibleItemIds.includes(id));
      } else {
        newSelection = [...new Set([...prev, ...visibleItemIds])];
      }
      return newSelection;
    });
  };

  const selectedItems = bomItemsData?.items.filter(item => selectedItemIds.includes(item.id)) || [];

  useEffect(() => {
    if (open) {
      form.reset({
        bomId: '',
        lotNumber: '',
        productionQuantity: 1,
        priority: 'medium',
        lotType: 'standard',
        remarks: '',
        selectedBomItemIds: [],
      });
      setSelectedItemIds([]);
      setSelectedBomId('');
      setItemSearch('');
      setBomSearch('');
    }
  }, [open, form]);

  // Sync selected items with form field
  useEffect(() => {
    form.setValue('selectedBomItemIds', selectedItemIds);
  }, [selectedItemIds, form]);

  const onSubmit = async (data: CreateLotFormValues) => {
    try {
      if (selectedItemIds.length === 0) {
        toast.error('Please select at least one BOM item');
        return;
      }

      const submitData = {
        ...data,
        selectedBomItemIds: selectedItemIds,
        plannedStartDate: data.plannedStartDate.toISOString().split('T')[0],
        plannedEndDate: data.plannedEndDate.toISOString().split('T')[0],
      };

      await createLotMutation.mutateAsync(submitData);

      toast.success('Production lot created successfully');
      onOpenChange(false);
      form.reset();
      setSelectedItemIds([]);
      setSelectedBomId('');
      setItemSearch('');
    } catch (error) {
      toast.error('Failed to create production lot');
      console.error('Error creating lot:', error);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/80" 
        onClick={() => onOpenChange(false)}
      />
      
      {/* Modal */}
      <div className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-background border rounded-lg shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-lg font-semibold">Create Production Lot</h2>
            <p className="text-sm text-muted-foreground">
              Create a new production lot from a BOM to start manufacturing planning
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-6 w-6 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                {/* Left Column */}
                <div className="space-y-6">
                  <FormField
                    control={form.control}
                    name="bomId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>BOM Selection *</FormLabel>
                        <div className="space-y-2">
                          <Input
                            placeholder="Search BOMs..."
                            value={bomSearch}
                            onChange={(e) => setBomSearch(e.target.value)}
                            className="mb-2"
                          />
                          <FormControl>
                            <select
                              className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                              value={field.value}
                              onChange={(e) => {
                                field.onChange(e.target.value);
                                handleBomChange(e.target.value);
                              }}
                            >
                              <option value="">Select a BOM to manufacture</option>
                              {isLoadingBOMs ? (
                                <option disabled>Loading BOMs...</option>
                              ) : filteredBOMs.length === 0 ? (
                                <option disabled>No BOMs found</option>
                              ) : (
                                filteredBOMs.map((bom) => (
                                  <option key={bom.id} value={bom.id}>
                                    {bom.name} • v{bom.version}
                                  </option>
                                ))
                              )}
                            </select>
                          </FormControl>
                        </div>
                        <FormDescription>
                          Select the BOM that defines what will be manufactured in this lot
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="lotNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Lot Number *</FormLabel>
                        <div className="flex gap-2">
                          <FormControl>
                            <Input 
                              placeholder="LOT-20260204-001" 
                              {...field} 
                            />
                          </FormControl>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => field.onChange(generateLotNumber())}
                          >
                            Generate
                          </Button>
                        </div>
                        <FormDescription>
                          Unique identifier for this production lot
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="productionQuantity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Production Quantity *</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            placeholder="100"
                            {...field}
                            onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                          />
                        </FormControl>
                        <FormDescription>
                          Number of units to be manufactured in this lot
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Priority</FormLabel>
                        <FormControl>
                          <select
                            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            value={field.value}
                            onChange={field.onChange}
                          >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                            <option value="urgent">Urgent</option>
                          </select>
                        </FormControl>
                        <FormDescription>
                          Production priority level for scheduling
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Right Column */}
                <div className="space-y-6">
                  <FormField
                    control={form.control}
                    name="plannedStartDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Planned Start Date *</FormLabel>
                        <FormControl>
                          <div className="space-y-2">
                            <Input
                              type="date"
                              value={field.value ? format(field.value, 'yyyy-MM-dd') : ''}
                              onChange={(e) => {
                                const date = e.target.value ? new Date(e.target.value) : null;
                                field.onChange(date);
                              }}
                              min={format(new Date(), 'yyyy-MM-dd')}
                            />
                            {field.value && (
                              <div className="text-sm text-muted-foreground">
                                {format(field.value, 'EEEE, MMMM do, yyyy')}
                              </div>
                            )}
                          </div>
                        </FormControl>
                        <FormDescription>
                          When production should begin
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="plannedEndDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Planned End Date *</FormLabel>
                        <FormControl>
                          <div className="space-y-2">
                            <Input
                              type="date"
                              value={field.value ? format(field.value, 'yyyy-MM-dd') : ''}
                              onChange={(e) => {
                                const date = e.target.value ? new Date(e.target.value) : null;
                                field.onChange(date);
                              }}
                              min={
                                form.getValues().plannedStartDate 
                                  ? format(form.getValues().plannedStartDate, 'yyyy-MM-dd')
                                  : format(new Date(), 'yyyy-MM-dd')
                              }
                            />
                            {field.value && (
                              <div className="text-sm text-muted-foreground">
                                {format(field.value, 'EEEE, MMMM do, yyyy')}
                              </div>
                            )}
                          </div>
                        </FormControl>
                        <FormDescription>
                          Target completion date for this lot
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="lotType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Lot Type</FormLabel>
                        <FormControl>
                          <select
                            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            value={field.value}
                            onChange={field.onChange}
                          >
                            <option value="standard">Standard Production</option>
                            <option value="prototype">Prototype/Trial</option>
                            <option value="rework">Rework/Repair</option>
                            <option value="urgent">Urgent/Rush</option>
                          </select>
                        </FormControl>
                        <FormDescription>
                          Type of production lot for categorization
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="remarks"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Remarks</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Additional notes or special instructions..."
                            className="resize-none"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          Optional notes about this production lot
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* BOM Items Selection */}
              {selectedBomId && (
                <Card className="mt-6">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg">Select BOM Items</CardTitle>
                        <CardDescription>
                          Choose which parts to include in this production lot
                        </CardDescription>
                      </div>
                      {bomItemsData?.items && bomItemsData.items.length > 0 && (
                        <Button 
                          type="button" 
                          variant="outline" 
                          size="sm"
                          onClick={handleSelectAllItems}
                        >
                          {filteredBomItems.every(item => selectedItemIds.includes(item.id)) && filteredBomItems.length > 0 
                            ? 'Deselect All' 
                            : 'Select All'
                          }
                        </Button>
                      )}
                    </div>
                    
                    {bomItemsData?.items && bomItemsData.items.length > 0 && (
                      <div className="mt-4">
                        <Input
                          placeholder="Search items by part number, description, type, or material..."
                          value={itemSearch}
                          onChange={(e) => setItemSearch(e.target.value)}
                          className="max-w-md"
                        />
                      </div>
                    )}
                  </CardHeader>
                  <CardContent>
                    {isLoadingBOMItems ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <span className="ml-2">Loading BOM items...</span>
                      </div>
                    ) : bomItemsData?.items && bomItemsData.items.length > 0 ? (
                      filteredBomItems.length > 0 ? (
                      <div className="space-y-3">
                        {filteredBomItems.map((item) => (
                          <div 
                            key={item.id} 
                            className={cn(
                              "flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors",
                              selectedItemIds.includes(item.id) && "border-primary bg-primary/5"
                            )}
                            onClick={() => handleItemToggle(item.id)}
                          >
                            <input
                              type="checkbox"
                              checked={selectedItemIds.includes(item.id)}
                              className="h-4 w-4 rounded border border-primary text-primary focus:ring-primary pointer-events-none"
                              readOnly
                            />
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{item.partNumber}</span>
                                <Badge variant="outline" className="text-xs">
                                  {item.itemType}
                                </Badge>
                                {item.makeBuy && (
                                  <Badge variant={item.makeBuy === 'make' ? 'default' : 'secondary'} className="text-xs">
                                    {item.makeBuy.toUpperCase()}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground mt-1">
                                {item.description}
                              </p>
                              {item.materialGrade && (
                                <p className="text-xs text-muted-foreground">
                                  Material: {item.materialGrade}
                                </p>
                              )}
                            </div>
                            <div className="text-right">
                              <div className="font-medium">Qty: {item.quantity}</div>
                              {item.unitCost && (
                                <div className="text-sm text-muted-foreground">
                                  ${item.unitCost.toFixed(2)} each
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                        
                      </div>
                      ) : (
                        <div className="text-center py-8 text-muted-foreground">
                          {itemSearch ? `No items found matching "${itemSearch}"` : 'No items found'}
                        </div>
                      )
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        No items found in this BOM
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              <div className="flex justify-end space-x-4 pt-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={createLotMutation.isPending}
                  className="min-w-[120px]"
                >
                  {createLotMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Creating...
                    </>
                  ) : (
                    'Create Lot'
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </div>
    </div>
  );
}