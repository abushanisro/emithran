'use client';

import React, { useState, useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { X, Save, Loader2 } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateSupplierNomination } from '@/lib/api/hooks/useSupplierNominations';
import { NominationType, type SupplierNominationSummary } from '@/lib/api/supplier-nominations';

interface EditNominationDialogProps {
  nomination: SupplierNominationSummary | null;
  onClose: () => void;
}

export function EditNominationDialog({
  nomination,
  onClose
}: EditNominationDialogProps) {
  const [formData, setFormData] = useState({
    nominationName: '',
    description: '',
    nominationType: NominationType.OEM
  });

  const updateNominationMutation = useUpdateSupplierNomination();

  useEffect(() => {
    if (nomination) {
      setFormData({
        nominationName: nomination.nominationName,
        description: '',
        nominationType: nomination.nominationType
      });
    }
  }, [nomination]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nomination) return;

    updateNominationMutation.mutate({
      nominationId: nomination.id,
      data: formData
    }, {
      onSuccess: () => {
        onClose();
      }
    });
  };

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  if (!nomination) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-lg border border-border w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-semibold text-foreground">Edit Nomination</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <Label htmlFor="nominationName" className="text-sm font-medium text-foreground/80">
              Nomination Name *
            </Label>
            <Input
              id="nominationName"
              value={formData.nominationName}
              onChange={(e) => handleChange('nominationName', e.target.value)}
              className="mt-1 bg-muted border-border text-foreground"
              required
            />
          </div>

          <div>
            <Label htmlFor="description" className="text-sm font-medium text-foreground/80">
              Description
            </Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => handleChange('description', e.target.value)}
              className="mt-1 bg-muted border-border text-foreground"
              rows={3}
            />
          </div>

          <div>
            <Label htmlFor="nominationType" className="text-sm font-medium text-foreground/80">
              Nomination Type *
            </Label>
            <select
              id="nominationType"
              value={formData.nominationType}
              onChange={(e) => handleChange('nominationType', e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-muted border border-border rounded-md text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40"
              required
            >
              <option value={NominationType.OEM}>OEM</option>
              <option value={NominationType.MANUFACTURER}>Manufacturer</option>
              <option value={NominationType.HYBRID}>Hybrid</option>
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="border-border text-foreground/80 hover:bg-accent"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateNominationMutation.isPending}
              className="bg-brand-600 hover:bg-brand-700 text-white"
            >
              {updateNominationMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Update Nomination
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}