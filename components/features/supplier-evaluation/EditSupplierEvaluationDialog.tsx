'use client';

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useUpdateSupplierEvaluationGroup } from '@/lib/api/hooks/useSupplierEvaluationGroups';
import { toast } from 'sonner';
import type { SupplierEvaluationGroupSummary } from '@/lib/api/supplier-evaluation-groups';

const editEvaluationFormSchema = z.object({
  name: z.string().min(1, 'Please enter a name').max(100, 'Name must be less than 100 characters'),
  description: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(['draft', 'active', 'completed', 'archived']),
});

type EditEvaluationFormData = z.infer<typeof editEvaluationFormSchema>;

interface EditSupplierEvaluationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: SupplierEvaluationGroupSummary | null;
  onSuccess?: () => void;
}

export function EditSupplierEvaluationDialog({
  open,
  onOpenChange,
  group,
  onSuccess
}: EditSupplierEvaluationDialogProps) {
  const updateMutation = useUpdateSupplierEvaluationGroup();

  const form = useForm<EditEvaluationFormData>({
    resolver: zodResolver(editEvaluationFormSchema),
    defaultValues: {
      name: '',
      description: '',
      notes: '',
      status: 'draft',
    },
  });

  // Update form when group changes
  React.useEffect(() => {
    if (group) {
      form.reset({
        name: group.name || '',
        description: group.description || '',
        notes: group.notes || '',
        status: (group.status as any) || 'draft',
      });
    }
  }, [group, form]);

  const onSubmit = async (data: EditEvaluationFormData) => {
    if (!group) return;

    try {
      await updateMutation.mutateAsync({
        groupId: group.id,
        data: {
          name: data.name,
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
          status: data.status,
        },
      });

      toast.success('Supplier evaluation updated successfully');
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast.error('Failed to update supplier evaluation. Please try again.');
      
      if (process.env.NODE_ENV === 'development') {
        console.error('Error updating supplier evaluation:', error);
      }
    }
  };

  const handleClose = () => {
    form.reset();
    onOpenChange(false);
  };

  if (!group) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Supplier Evaluation</DialogTitle>
          <DialogDescription>
            Update the details for "{group.name}" evaluation group.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Name Field */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Enter evaluation group name"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Description Field */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Enter a description for this evaluation group"
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Status Field */}
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="archived">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Notes Field */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Add any additional notes or comments"
                      className="resize-none"
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={form.handleSubmit(onSubmit)}
            disabled={updateMutation.isPending}
            className="gap-2"
          >
            {updateMutation.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Update Evaluation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}