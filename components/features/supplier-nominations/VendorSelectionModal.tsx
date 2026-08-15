'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Search, Plus, Building2 } from 'lucide-react';
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
      <DialogContent className="max-w-2xl bg-gray-800 border-gray-700">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Select Vendors for Evaluation
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search vendors by name, email, or location..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-gray-700 border-gray-600 text-white"
            />
          </div>

          {/* Selected vendors count */}
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-blue-600 text-white">
                {selectedIds.length} vendor{selectedIds.length !== 1 ? 's' : ''} selected
              </Badge>
            </div>
          )}

          {/* Vendors list */}
          <div className="max-h-96 overflow-y-auto border border-gray-600 rounded-lg">
            {isLoading ? (
              <div className="p-8 text-center text-gray-400">
                Loading vendors...
              </div>
            ) : filteredVendors.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                {searchTerm ? 'No vendors found matching your search.' : 'No available vendors to select.'}
              </div>
            ) : (
              <div className="space-y-2 p-4">
                {filteredVendors.map(vendor => {
                  const vendorLocation = [vendor.city, vendor.state].filter(Boolean).join(', ');
                  return (
                    <div
                      key={vendor.id}
                      className="flex items-center space-x-3 p-3 rounded-lg border border-gray-600 hover:bg-gray-700 transition-colors"
                    >
                      <Checkbox
                        id={vendor.id}
                        checked={selectedIds.includes(vendor.id)}
                        onCheckedChange={() => handleVendorToggle(vendor.id)}
                        className="border-gray-400"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <h4 className="text-white font-medium truncate">
                            {vendor.name}
                          </h4>
                          {vendor.vendorType && (
                            <Badge variant="outline" className="text-xs border-gray-500 text-gray-300">
                              {vendor.vendorType}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-sm text-gray-400">
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
              className="border-gray-600 text-gray-300 hover:bg-gray-700"
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={selectedIds.length === 0 || isSubmitting}
              className="bg-blue-600 hover:bg-blue-700"
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