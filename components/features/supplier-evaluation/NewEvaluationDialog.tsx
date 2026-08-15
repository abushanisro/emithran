'use client';

import React from 'react';

import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
// import {
//   DropdownMenu,
//   DropdownMenuContent,
//   DropdownMenuItem,
//   DropdownMenuTrigger,
// } from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Search } from 'lucide-react';
import {
  useBOMs,
  useBOMItems
} from '@/lib/api/hooks';
import { ErrorBoundary } from '@/components/error-boundary';
import { useCreateSupplierEvaluationGroup } from '@/lib/api/hooks/useSupplierEvaluationGroups';
import { toast } from 'sonner';

const evaluationFormSchema = z.object({
  supplierGroupName: z.string().min(1, 'Please enter a supplier group name').max(100, 'Name must be less than 100 characters'),
  bomId: z.string().uuid('Please select a valid BOM'),
  bomItemIds: z.array(z.string().uuid()).min(1, 'Please select at least one part'),
  notes: z.string().optional(),
});

type EvaluationFormData = z.infer<typeof evaluationFormSchema>;

interface NewEvaluationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function NewEvaluationDialog({
  open,
  onOpenChange,
  onSuccess
}: NewEvaluationDialogProps) {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = params?.id || '';

  const form = useForm<EvaluationFormData>({
    resolver: zodResolver(evaluationFormSchema),
    defaultValues: {
      supplierGroupName: '',
      bomId: '',
      bomItemIds: [],
      notes: '',
    },
    mode: 'onChange',
  });

  // Watch form values for dependent queries
  const selectedBomId = form.watch('bomId');
  const selectedBomItemIds = form.watch('bomItemIds');

  // Search states
  const [bomSearch, setBomSearch] = React.useState('');

  // Fetch data
  const { data: bomsData, isLoading: bomsLoading } = useBOMs({
    projectId: projectId
  });

  const { data: bomItemsData, isLoading: bomItemsLoading } = useBOMItems(
    selectedBomId || undefined
  );

  // Mutations
  const createEvaluationGroupMutation = useCreateSupplierEvaluationGroup();

  const boms = bomsData?.boms || [];
  const bomItems = bomItemsData?.items || [];

  // Filter BOM items based on search
  const filteredBomItems = bomItems.filter(item => {
    if (!bomSearch) return true;
    const searchLower = bomSearch.toLowerCase();
    return (
      item.name?.toLowerCase().includes(searchLower) ||
      item.partNumber?.toLowerCase().includes(searchLower) ||
      item.material?.toLowerCase().includes(searchLower)
    );
  });

  const onSubmit = async (data: EvaluationFormData) => {
    try {
      // UUIDs are validated by Zod schema
      const sanitizedBomItemIds = data.bomItemIds;

      // Prepare evaluation group data for database
      const evaluationGroupData = {
        projectId,
        name: data.supplierGroupName,
        ...(data.notes ? { notes: data.notes } : {}),
        bomItems: sanitizedBomItemIds.map(bomItemId => {
          const item = bomItems.find(b => b.id === bomItemId);
          return {
            id: bomItemId,
            bomId: data.bomId,
            name: item?.name || 'Unknown Part',
            partNumber: item?.partNumber || '',
            material: item?.material || '',
            quantity: item?.quantity || 1
          };
        }),
        processes: [], // Empty array since process search was removed
      };

      // Create evaluation group in database
      await createEvaluationGroupMutation.mutateAsync(evaluationGroupData);

      // Show success message
      toast.success('Supplier evaluation created! Opening supplier dashboard.');

      // Reset form and close dialog
      form.reset({
        supplierGroupName: '',
        bomId: '',
        bomItemIds: [],
        notes: '',
      });
      onOpenChange(false);
      onSuccess?.();

      // Navigate to supplier evaluation page
      router.push(`/projects/${projectId}/supplier-evaluation`);
    } catch (error) {
      toast.error('Failed to create supplier evaluation. Please try again.');

      // Log errors in development only
      if (process.env.NODE_ENV === 'development') {
        console.error('Error creating supplier evaluation:', error);
        if (error instanceof Error && error.message.includes('UUID')) {
          console.error('UUID validation failed:', error.message);
        }
      }
    }
  };

  const handleBomChange = (bomId: string) => {
    form.setValue('bomId', bomId);
    // Reset dependent fields
    form.setValue('bomItemIds', []);
  };

  const toggleBomItem = (bomItemId: string) => {
    const currentItems = form.getValues('bomItemIds');
    if (currentItems.includes(bomItemId)) {
      form.setValue('bomItemIds', currentItems.filter(id => id !== bomItemId));
    } else {
      form.setValue('bomItemIds', [...currentItems, bomItemId]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] flex flex-col">
        <ErrorBoundary
          onError={(error, errorInfo) => {
            if (process.env.NODE_ENV === 'development') {
              console.error('[NewEvaluationDialog] Error:', error);
              console.error('[NewEvaluationDialog] Error Info:', errorInfo);
            }
          }}
        >
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>New Supplier Evaluation</DialogTitle>
            <DialogDescription>
              Create a new supplier evaluation by selecting BOM parts. You'll manage processes and select vendors on the next page.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto pr-2">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 py-4">
                {/* Supplier Group Name */}
                <FormField
                  control={form.control}
                  name="supplierGroupName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Supplier Group Name *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Enter a name for this supplier evaluation group (e.g., 'Engine Block Suppliers', 'Q1 2026 Evaluation')"
                          value={field.value || ''}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* BOM Selection */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 pb-2 border-b">
                    <h3 className="text-lg font-semibold">BOM Selection</h3>
                  </div>

                  <FormField
                    control={form.control}
                    name="bomId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Select BOM</FormLabel>
                        <Select
                          onValueChange={handleBomChange}
                          value={field.value}
                          disabled={bomsLoading}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a BOM" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {boms.map((bom) => (
                              <SelectItem key={bom.id} value={bom.id}>
                                <div className="flex flex-col">
                                  <span className="font-medium">{bom.name}</span>
                                  <span className="text-xs text-muted-foreground">
                                    v{bom.version} • {bom.totalItems} items • {bom.status}
                                  </span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Multi-Select Parts */}
                  {selectedBomId && (
                    <FormField
                      control={form.control}
                      name="bomItemIds"
                      render={() => (
                        <FormItem>
                          <FormLabel>Select Parts (Multiple)</FormLabel>
                          <Card>
                            <CardHeader className="pb-3">
                              <CardDescription>
                                Select multiple parts for supplier evaluation
                              </CardDescription>
                            </CardHeader>
                            <CardContent>
                              {/* Search Bar for BOM Items */}
                              <div className="mb-3">
                                <div className="relative">
                                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                  <Input
                                    placeholder="Search parts by name, part number, or material..."
                                    value={bomSearch}
                                    onChange={(e) => setBomSearch(e.target.value)}
                                    className="pl-8"
                                  />
                                </div>
                              </div>
                              <div className="h-64 overflow-y-auto pr-2">
                                <div className="space-y-2">
                                  {bomItemsLoading ? (
                                    <div className="text-sm text-muted-foreground p-4 text-center">
                                      Loading parts...
                                    </div>
                                  ) : filteredBomItems.length === 0 ? (
                                    <div className="text-sm text-muted-foreground p-4 text-center">
                                      {bomSearch ? 'No parts found matching search criteria' : 'No parts available'}
                                    </div>
                                  ) : (
                                    filteredBomItems.map((item) => (
                                      <div key={item.id} className="flex items-start space-x-2 p-2 hover:bg-muted/50 rounded">
                                        <Checkbox
                                          id={`part-${item.id}`}
                                          checked={selectedBomItemIds.includes(item.id)}
                                          onCheckedChange={() => toggleBomItem(item.id)}
                                        />
                                        <div className="flex-1 min-w-0">
                                          <label
                                            htmlFor={`part-${item.id}`}
                                            className="text-sm font-medium cursor-pointer"
                                          >
                                            {item.name}
                                          </label>
                                          <div className="text-xs text-muted-foreground">
                                            {item.partNumber && `Part: ${item.partNumber} • `}
                                            {item.itemType} • Qty: {item.quantity}
                                            {item.material && ` • ${item.material}`}
                                          </div>
                                        </div>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>

                              {/* Selected Parts Display */}
                              {selectedBomItemIds.length > 0 && (
                                <div className="mt-3 pt-3 border-t">
                                  <div className="text-xs font-medium text-muted-foreground mb-2">
                                    Selected Parts ({selectedBomItemIds.length}):
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {selectedBomItemIds.map((itemId) => {
                                      const item = bomItems.find(b => b.id === itemId);
                                      return item ? (
                                        <Badge key={itemId} variant="secondary" className="text-xs">
                                          {item.name}
                                        </Badge>
                                      ) : null;
                                    })}
                                  </div>
                                </div>
                              )}
                            </CardContent>
                          </Card>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>

                {/* Notes */}
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Evaluation Notes (Optional)</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Add any specific requirements or notes for this evaluation..."
                          className="resize-none"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </form>
            </Form>
          </div>

          <DialogFooter className="flex-shrink-0 border-t pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={form.handleSubmit(onSubmit)}
              disabled={form.formState.isSubmitting}
              className="gap-2"
            >
              {form.formState.isSubmitting && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Continue to Vendor Selection
            </Button>
          </DialogFooter>
        </ErrorBoundary>
      </DialogContent>

    </Dialog>
  );
}