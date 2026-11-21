'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Search, Plus, Building2 } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { useVendors } from '@/lib/api/hooks/useVendors';

interface VendorSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectVendors: (vendorIds: string[]) => Promise<void>;
  selectedVendorIds?: string[];
}

export function VendorSelectionModal({
  isOpen,
  onClose,
  onSelectVendors,
  selectedVendorIds = [],
}: VendorSelectionModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>(selectedVendorIds);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const { data: vendorsData, isLoading } = useVendors();
  const vendors = vendorsData?.vendors || [];

  // Filter vendors based on search term and exclude already selected ones
  const filteredVendors = vendors.filter(vendor => {
    const vendorLocation = [vendor.city, vendor.state].filter(Boolean).join(', ');
    const matchesSearch = vendor.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         vendor.companyEmail?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         vendorLocation.toLowerCase().includes(searchTerm.toLowerCase());

    const notAlreadySelected = !selectedVendorIds.includes(vendor.id);

    return matchesSearch && notAlreadySelected && vendor.status === 'active';
  });

  const handleVendorToggle = (vendorId: string) => {
    setSelectedIds(prev => 
      prev.includes(vendorId)
        ? prev.filter(id => id !== vendorId)
        : [...prev, vendorId]
    );
  };

  const handleSubmit = async () => {
    if (selectedIds.length === 0) return;
    
    try {
      setIsSubmitting(true);
      await onSelectVendors(selectedIds);
      onClose();
      setSelectedIds([]);
      setSearchTerm('');
    } catch (error) {
      console.error('Failed to add vendors:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setSelectedIds([]);
    setSearchTerm('');
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Select Vendors for Evaluation
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search vendors by name, email, or location..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-muted border-border text-foreground"
            />
          </div>

          {/* Selected vendors count */}
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-brand-600 text-white">
                {selectedIds.length} vendor{selectedIds.length !== 1 ? 's' : ''} selected
              </Badge>
            </div>
          )}

          {/* Vendors list */}
          <div className="max-h-96 overflow-y-auto border border-border rounded-lg">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">
                Loading vendors...
              </div>
            ) : filteredVendors.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                {searchTerm ? 'No vendors found matching your search.' : 'No available vendors to select.'}
              </div>
            ) : (
              <div className="space-y-2 p-4">
                {filteredVendors.map(vendor => {
                  const vendorLocation = [vendor.city, vendor.state].filter(Boolean).join(', ');
                  return (
                    <div
                      key={vendor.id}
                      className="flex items-center space-x-3 p-3 rounded-lg border border-border hover:bg-accent transition-colors"
                    >
                      <Checkbox
                        id={vendor.id}
                        checked={selectedIds.includes(vendor.id)}
                        onCheckedChange={() => handleVendorToggle(vendor.id)}
                        className="border-border"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <h4 className="text-foreground font-medium truncate">
                            {vendor.name}
                          </h4>
                          {vendor.vendorType && (
                            <Badge variant="outline" className="text-xs border-border text-foreground/80">
                              {vendor.vendorType}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                          {vendor.companyEmail && <span>{vendor.companyEmail}</span>}
                          {vendorLocation && <span>{vendorLocation}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <Button
              variant="outline"
              onClick={handleClose}
              className="border-border text-foreground/80 hover:bg-accent"
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={selectedIds.length === 0 || isSubmitting}
              className="bg-brand-600 hover:bg-brand-700"
            >
              <Plus className="h-4 w-4 mr-2" />
              {isSubmitting 
                ? 'Adding...' 
                : `Add ${selectedIds.length} Vendor${selectedIds.length !== 1 ? 's' : ''}`
              }
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}