'use client';

import { useState, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  X, 
  Package, 
  Users, 
  Award,
  Factory,
  Building2,
  CheckCircle2,
  AlertCircle,
  Search
} from 'lucide-react';
import { toast } from 'sonner';

// API imports
import { useCreateSupplierNomination } from '@/lib/api/hooks/useSupplierNominations';
import { useBOMItems, type BOMItem } from '@/lib/api/hooks/useBOMItems';
import { useRfqTrackingRecords } from '@/lib/api/hooks/useRfqTracking';
import { 
  NominationType,
  type CreateSupplierNominationData 
} from '@/lib/api/supplier-nominations';
import type { RfqTrackingRecord, RfqTrackingVendor } from '@/lib/api/rfq-tracking';

interface BomPartNominationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  selectedBomId?: string;
  onSuccess?: (nominationId: string) => void;
}

interface SelectedBomPart {
  bomItemId: string;
  bomItemName: string;
  partNumber?: string;
  material?: string;
  quantity: number;
  vendorIds: string[];
}

interface VendorForPart {
  vendorId: string;
  vendorName: string;
  vendorEmail?: string;
  responded: boolean;
  quoteAmount?: number;
  leadTimeDays?: number;
  rfqCount: number; // Number of RFQs this vendor received for this part
}

export function BomPartNominationDialog({
  open,
  onOpenChange,
  projectId,
  selectedBomId,
  onSuccess
}: BomPartNominationDialogProps) {
  const [nominationName, setNominationName] = useState('');
  const [activeTab, setActiveTab] = useState('parts');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedParts, setSelectedParts] = useState<SelectedBomPart[]>([]);
  
  const createNominationMutation = useCreateSupplierNomination();
  
  // Fetch BOM items if BOM is selected
  const { data: bomItemsData } = useBOMItems(selectedBomId);
  const bomItems = bomItemsData?.items || [];
  
  // Fetch RFQ tracking records for the project
  const { data: rfqRecords = [] } = useRfqTrackingRecords(projectId);
  
  // Create a mapping of BOM part to vendors who received RFQs
  const bomPartVendorMap = useMemo(() => {
    const partVendorMap = new Map<string, VendorForPart[]>();
    
    rfqRecords.forEach((rfq: RfqTrackingRecord) => {
      rfq.parts.forEach(part => {
        // Try to match RFQ part with BOM item by part number or name
        const matchingBomItem = bomItems.find(bomItem => 
          bomItem.partNumber === part.partNumber ||
          bomItem.name.toLowerCase().includes(part.description.toLowerCase()) ||
          part.description.toLowerCase().includes(bomItem.name.toLowerCase())
        );
        
        if (matchingBomItem) {
          const existingVendors = partVendorMap.get(matchingBomItem.id) || [];
          
          rfq.vendors.forEach(vendor => {
            const existingVendorIndex = existingVendors.findIndex(v => v.vendorId === vendor.id);
            
            if (existingVendorIndex >= 0) {
              // Update existing vendor - increment RFQ count
              existingVendors[existingVendorIndex].rfqCount++;
              if (vendor.responded && vendor.quoteAmount) {
                existingVendors[existingVendorIndex].responded = true;
                existingVendors[existingVendorIndex].quoteAmount = vendor.quoteAmount;
                existingVendors[existingVendorIndex].leadTimeDays = vendor.leadTimeDays;
              }
            } else {
              // Add new vendor
              existingVendors.push({
                vendorId: vendor.id,
                vendorName: vendor.name,
                vendorEmail: vendor.email,
                responded: vendor.responded,
                quoteAmount: vendor.quoteAmount,
                leadTimeDays: vendor.leadTimeDays,
                rfqCount: 1
              });
            }
          });
          
          partVendorMap.set(matchingBomItem.id, existingVendors);
        }
      });
    });
    
    return partVendorMap;
  }, [rfqRecords, bomItems]);
  
  // Get vendors for a specific BOM part
  const getVendorsForPart = useCallback((bomItemId: string): VendorForPart[] => {
    return bomPartVendorMap.get(bomItemId) || [];
  }, [bomPartVendorMap]);
  
  // Filter BOM items based on search
  const filteredBomItems = useMemo(() => {
    if (!searchTerm) return bomItems;
    
    return bomItems.filter(item => 
      item.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.partNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.material?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [bomItems, searchTerm]);
  
  // Reset form when dialog opens/closes
  const resetForm = useCallback(() => {
    setNominationName('');
    setActiveTab('parts');
    setSearchTerm('');
    setSelectedParts([]);
  }, []);
  
  // Handle dialog close
  const handleClose = useCallback(() => {
    resetForm();
    onOpenChange(false);
  }, [resetForm, onOpenChange]);
  
  // Handle part selection
  const handlePartSelect = useCallback((bomItem: BOMItem, isSelected: boolean) => {
    setSelectedParts(prev => {
      if (isSelected) {
        // Add part with no vendors initially selected
        const newPart: SelectedBomPart = {
          bomItemId: bomItem.id,
          bomItemName: bomItem.name,
          partNumber: bomItem.partNumber,
          material: bomItem.material,
          quantity: bomItem.quantity,
          vendorIds: []
        };
        return [...prev, newPart];
      } else {
        // Remove part
        return prev.filter(part => part.bomItemId !== bomItem.id);
      }
    });
  }, []);
  
  // Handle vendor selection for a specific part
  const handleVendorSelect = useCallback((bomItemId: string, vendorId: string, isSelected: boolean) => {
    setSelectedParts(prev => 
      prev.map(part => {
        if (part.bomItemId === bomItemId) {
          const vendorIds = isSelected 
            ? [...part.vendorIds, vendorId]
            : part.vendorIds.filter(id => id !== vendorId);
          
          return { ...part, vendorIds };
        }
        return part;
      })
    );
  }, []);
  
  // Validation
  const canSubmit = useMemo(() => {
    return nominationName.trim() && 
           selectedParts.length > 0 && 
           selectedParts.every(part => 
             part.vendorIds.length > 0 && 
             getVendorsForPart(part.bomItemId).length > 0
           );
  }, [nominationName, selectedParts, getVendorsForPart]);
  
  // Handle form submission
  const handleSubmit = async () => {
    if (!canSubmit) {
      toast.error('Please complete all required fields');
      return;
    }
    
    try {
      // Get all unique vendor IDs from selected parts
      const allVendorIds = Array.from(
        new Set(selectedParts.flatMap(part => part.vendorIds))
      );
      
      // Prepare BOM parts data for the nomination
      const bomPartsData = selectedParts.map(part => ({
        bomItemId: part.bomItemId,
        bomItemName: part.bomItemName,
        partNumber: part.partNumber,
        material: part.material,
        quantity: part.quantity,
        vendorIds: part.vendorIds
      }));
      
      const formData: CreateSupplierNominationData = {
        nominationName: nominationName.trim(),
        description: `BOM part-wise nomination for ${selectedParts.length} parts: ${selectedParts.map(p => p.bomItemName).join(', ')}`,
        nominationType: NominationType.MANUFACTURER,
        projectId,
        vendorIds: allVendorIds,
        bomParts: bomPartsData
      };
      
      const result = await createNominationMutation.mutateAsync(formData);
      
      if (result?.id) {
        onSuccess?.(result.id);
        toast.success(`Nomination created for ${selectedParts.length} BOM parts with ${allVendorIds.length} vendors`);
        handleClose();
      }
    } catch (error: any) {
      console.error('Create nomination error:', error);
      const errorMessage = error?.message || 'Failed to create nomination';
      toast.error(errorMessage);
    }
  };

if (!open) return null;
  
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/80" onClick={handleClose} />
      
      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div 
          className="bg-white border border-border rounded-lg shadow-lg max-w-6xl w-full max-h-[90vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-border bg-muted/50">
            <div>
              <h2 className="text-xl font-semibold">Create BOM Part-wise Nomination</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Select BOM parts and assign approved vendors for nomination
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={handleClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          
          {/* Content */}
          <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
            <div className="space-y-6">
              {/* Nomination Name */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  Nomination Name *
                </label>
                <Input
                  value={nominationName}
                  onChange={(e) => setNominationName(e.target.value)}
                  placeholder="e.g., Q2 2026 Manufacturing Partners - BOM Selection"
                  className="max-w-lg"
                  required
                />
              </div>
              
              {/* Tabs */}
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                  <TabsTrigger value="parts" className="flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    Select BOM Parts
                  </TabsTrigger>
                  <TabsTrigger value="vendors" className="flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Assign Vendors
                  </TabsTrigger>
                  <TabsTrigger value="review" className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    Review & Submit
                  </TabsTrigger>
                </TabsList>
                
                {/* Tab 1: Select BOM Parts */}
                <TabsContent value="parts" className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-medium">
                      Select BOM Parts ({filteredBomItems.length} available)
                    </h3>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search parts..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-9 w-64"
                      />
                    </div>
                  </div>
                  
                  {filteredBomItems.length === 0 ? (
                    <Card>
                      <CardContent className="p-8 text-center">
                        <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <p className="text-muted-foreground">
                          {bomItems.length === 0 
                            ? 'No BOM items found. Please select a BOM first.' 
                            : 'No parts match your search criteria.'
                          }
                        </p>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {filteredBomItems.map((item) => {
                        const isSelected = selectedParts.some(part => part.bomItemId === item.id);
                        
                        return (
                          <Card 
                            key={item.id}
                            className={`cursor-pointer transition-all ${
                              isSelected ? 'ring-2 ring-primary' : 'hover:shadow-md'
                            }`}
                            onClick={() => handlePartSelect(item, !isSelected)}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-start gap-3">
                                <Checkbox 
                                  checked={isSelected}
                                  onChange={() => handlePartSelect(item, !isSelected)}
                                />
                                <div className="flex-1 min-w-0">
                                  <h4 className="font-medium truncate">{item.name}</h4>
                                  <div className="grid grid-cols-2 gap-2 mt-2 text-sm text-muted-foreground">
                                    <div>
                                      <span className="font-medium">Part #:</span>
                                      <br />{item.partNumber || '—'}
                                    </div>
                                    <div>
                                      <span className="font-medium">Qty:</span>
                                      <br />{item.quantity} {item.unit}
                                    </div>
                                    <div className="col-span-2">
                                      <span className="font-medium">Material:</span>
                                      <br />{item.material || '—'}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                  
                  <div className="flex justify-between">
                    <Badge variant="outline">
                      {selectedParts.length} parts selected
                    </Badge>
                    <Button 
                      onClick={() => setActiveTab('vendors')}
                      disabled={selectedParts.length === 0}
                    >
                      Next: Assign Vendors
                    </Button>
                  </div>
                </TabsContent>
                
                {/* Tab 2: Assign Vendors */}
                <TabsContent value="vendors" className="space-y-4">
                  <h3 className="text-lg font-medium">
                    Assign Vendors to Selected Parts
                  </h3>
                  
                  {selectedParts.length === 0 ? (
                    <Card>
                      <CardContent className="p-8 text-center">
                        <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <p className="text-muted-foreground">
                          Please select BOM parts first
                        </p>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-6">
                      {selectedParts.map((part) => (
                        <Card key={part.bomItemId}>
                          <CardHeader>
                            <CardTitle className="text-base">
                              {part.bomItemName}
                              <Badge variant="outline" className="ml-2">
                                {part.partNumber || 'No Part #'}
                              </Badge>
                            </CardTitle>
                            <p className="text-sm text-muted-foreground">
                              Material: {part.material || 'Not specified'} | 
                              Quantity: {part.quantity}
                            </p>
                          </CardHeader>
                          <CardContent>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {getVendorsForPart(part.bomItemId).map((vendor) => {
                                const isSelected = part.vendorIds.includes(vendor.vendorId);
                                
                                return (
                                  <Card 
                                    key={vendor.vendorId}
                                    className={`cursor-pointer transition-all ${
                                      isSelected ? 'ring-2 ring-primary' : 'hover:shadow-sm'
                                    }`}
                                    onClick={() => handleVendorSelect(part.bomItemId, vendor.vendorId, !isSelected)}
                                  >
                                    <CardContent className="p-3">
                                      <div className="flex items-start gap-3">
                                        <Checkbox 
                                          checked={isSelected}
                                          onChange={() => handleVendorSelect(part.bomItemId, vendor.vendorId, !isSelected)}
                                        />
                                        <div className="flex-1">
                                          <div className="flex items-center gap-2 mb-2">
                                            <Building2 className="h-4 w-4 text-blue-400" />
                                            <span className="font-medium">{vendor.vendorName}</span>
                                            {vendor.responded && (
                                              <Badge variant="outline" className="text-xs border-green-500 text-green-400">
                                                Responded
                                              </Badge>
                                            )}
                                          </div>
                                          <div className="space-y-1 text-xs text-muted-foreground">
                                            {vendor.vendorEmail && (
                                              <div>Email: {vendor.vendorEmail}</div>
                                            )}
                                            <div className="flex items-center gap-4">
                                              <span>RFQs: {vendor.rfqCount}</span>
                                              {vendor.quoteAmount && (
                                                <span>Quote: ${vendor.quoteAmount.toLocaleString()}</span>
                                              )}
                                              {vendor.leadTimeDays && (
                                                <span>Lead: {vendor.leadTimeDays}d</span>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </CardContent>
                                  </Card>
                                );
                              })}
                            </div>
                            
                            {getVendorsForPart(part.bomItemId).length === 0 && (
                              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                <div className="flex items-center gap-2 text-blue-700">
                                  <AlertCircle className="h-4 w-4" />
                                  <span className="text-sm">No RFQs found for this part. Send RFQs to vendors first to enable nominations.</span>
                                </div>
                              </div>
                            )}
                            
                            {getVendorsForPart(part.bomItemId).length > 0 && part.vendorIds.length === 0 && (
                              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                                <div className="flex items-center gap-2 text-yellow-700">
                                  <AlertCircle className="h-4 w-4" />
                                  <span className="text-sm">Please select at least one vendor for this part</span>
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                  
                  <div className="flex justify-between">
                    <Button variant="outline" onClick={() => setActiveTab('parts')}>
                      Back: Select Parts
                    </Button>
                    <Button 
                      onClick={() => setActiveTab('review')}
                      disabled={selectedParts.some(part => 
                        part.vendorIds.length === 0 || getVendorsForPart(part.bomItemId).length === 0
                      )}
                    >
                      Next: Review & Submit
                    </Button>
                  </div>
                </TabsContent>
                
                {/* Tab 3: Review & Submit */}
                <TabsContent value="review" className="space-y-4">
                  <h3 className="text-lg font-medium">Review Nomination</h3>
                  
                  <Card>
                    <CardHeader>
                      <CardTitle>Nomination Summary</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <span className="font-medium">Name:</span> {nominationName}
                      </div>
                      <div>
                        <span className="font-medium">BOM Parts:</span> {selectedParts.length}
                      </div>
                      <div>
                        <span className="font-medium">Total Vendors:</span> {
                          new Set(selectedParts.flatMap(part => part.vendorIds)).size
                        }
                      </div>
                      
                      <div className="pt-4 border-t">
                        <h4 className="font-medium mb-3">Part-Vendor Assignments:</h4>
                        <div className="space-y-3">
                          {selectedParts.map((part) => {
                            const partVendors = getVendorsForPart(part.bomItemId);
                            return (
                              <div key={part.bomItemId} className="p-3 bg-muted/50 rounded-lg">
                                <div className="font-medium">{part.bomItemName}</div>
                                <div className="text-sm text-muted-foreground mt-1">
                                  <span className="font-medium">Part #:</span> {part.partNumber || '—'} | 
                                  <span className="font-medium"> Qty:</span> {part.quantity}
                                </div>
                                <div className="text-sm text-muted-foreground mt-1">
                                  <span className="font-medium">Selected Vendors:</span> {
                                    part.vendorIds.map(vendorId => {
                                      const vendor = partVendors.find(v => v.vendorId === vendorId);
                                      return vendor?.vendorName || vendorId;
                                    }).join(', ')
                                  }
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  
                  <div className="flex justify-between">
                    <Button variant="outline" onClick={() => setActiveTab('vendors')}>
                      Back: Assign Vendors
                    </Button>
                    <Button 
                      onClick={handleSubmit}
                      disabled={!canSubmit || createNominationMutation.isPending}
                      className="min-w-32"
                    >
                      {createNominationMutation.isPending ? 'Creating...' : 'Create Nomination'}
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}