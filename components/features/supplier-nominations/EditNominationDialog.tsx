'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { X, Save, Loader2 } from 'lucide-react';
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
      <div className="bg-gray-800 rounded-lg border border-gray-700 w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">Edit Nomination</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0 text-gray-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <Label htmlFor="nominationName" className="text-sm font-medium text-gray-300">
              Nomination Name *
            </Label>
            <Input
              id="nominationName"
              value={formData.nominationName}
              onChange={(e) => handleChange('nominationName', e.target.value)}
              className="mt-1 bg-gray-700 border-gray-600 text-white"
              required
            />
          </div>

          <div>
            <Label htmlFor="description" className="text-sm font-medium text-gray-300">
              Description
            </Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => handleChange('description', e.target.value)}
              className="mt-1 bg-gray-700 border-gray-600 text-white"
              rows={3}
            />
          </div>

          <div>
            <Label htmlFor="nominationType" className="text-sm font-medium text-gray-300">
              Nomination Type *
            </Label>
            <select
              id="nominationType"
              value={formData.nominationType}
              onChange={(e) => handleChange('nominationType', e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              className="border-gray-600 text-gray-300 hover:bg-gray-700"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateNominationMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white"
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