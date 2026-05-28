'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Building2,
  CheckCircle,
  Award,
  Factory,
  X,
  Package,
  ChevronDown,
  ChevronUp,
  Search
} from 'lucide-react';
import { toast } from 'sonner';
import { useCreateSupplierNomination } from '@/lib/api/hooks/useSupplierNominations';
import { useVendors } from '@/lib/api/hooks/useVendors';
import { useRfqTrackingRecords } from '@/lib/api/hooks/useRfqTracking';
import { useSupplierEvaluations } from '@/lib/api/hooks/useSupplierEvaluation';
import { useBOMs } from '@/lib/api/hooks/useBOM';
import { useBOMItems } from '@/lib/api/hooks/useBOMItems';
import {
  NominationType,
  type CreateSupplierNominationData
} from '@/lib/api/supplier-nominations';

interface CreateNominationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  evaluationGroupId?: string;
  onSuccess?: (nominationId: string) => void;
}

export function CreateNominationDialog({
  open,
  onOpenChange,
  projectId,
  evaluationGroupId,
  onSuccess
}: CreateNominationDialogProps) {
  const [nominationName, setNominationName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);
  const [selectedBomId, setSelectedBomId] = useState<string>('');
  const [showBomParts, setShowBomParts] = useState(false);
  const [selectedBomPartIds, setSelectedBomPartIds] = useState<string[]>([]);
  const [bomPartsSearchTerm, setBomPartsSearchTerm] = useState('');

  const createNominationMutation = useCreateSupplierNomination();

  // Static queries to prevent re-renders
  const { data: vendorsResponse } = useVendors({ status: 'active', limit: 1000 });
  const { data: rfqTrackingRecords = [] } = useRfqTrackingRecords(projectId);
  const { data: supplierEvaluations = [] } = useSupplierEvaluations({ projectId });
  const { data: bomsData } = useBOMs({ projectId });
  const { data: bomItemsData } = useBOMItems(selectedBomId);
  
  const boms = bomsData?.boms || [];
  const bomItems = bomItemsData?.items || [];

  // Filter BOM items based on search
  const filteredBomItems = useMemo(() => {
    if (!bomPartsSearchTerm) return bomItems;
    
    return bomItems.filter(item => 
      item.name?.toLowerCase().includes(bomPartsSearchTerm.toLowerCase()) ||
      item.partNumber?.toLowerCase().includes(bomPartsSearchTerm.toLowerCase()) ||
      item.material?.toLowerCase().includes(bomPartsSearchTerm.toLowerCase())
    );
  }, [bomItems, bomPartsSearchTerm]);

  const vendors = vendorsResponse?.vendors || [];

  // Create a mapping of BOM part to vendors who received RFQs (similar to BomPartNominationDialog)
  const bomPartVendorMap = useMemo(() => {
    const partVendorMap = new Map<string, Array<{
      vendorId: string;
      vendorName: string;
      vendorEmail?: string;
      responded: boolean;
      quoteAmount?: number;
      leadTimeDays?: number;
      rfqCount: number;
    }>>();
    
    // Only process if we have RFQ data and BOM items
    if (!rfqTrackingRecords || rfqTrackingRecords.length === 0 || !bomItems || bomItems.length === 0) {
      return partVendorMap;
    }
    
    rfqTrackingRecords.forEach((rfq) => {
      if (!rfq.parts || !Array.isArray(rfq.parts) || !rfq.vendors || !Array.isArray(rfq.vendors)) {
        return;
      }
      
      rfq.parts.forEach(part => {
        if (!part.partNumber && !part.description) {
          return;
        }
        
        // Try to match RFQ part with BOM item by part number or name
        const matchingBomItems = bomItems.filter(bomItem => {
          if (!bomItem.partNumber && !bomItem.name) {
            return false;
          }
          
          return (
            (bomItem.partNumber && part.partNumber && bomItem.partNumber === part.partNumber) ||
            (bomItem.name && part.description && 
             (bomItem.name.toLowerCase().includes(part.description.toLowerCase()) ||
              part.description.toLowerCase().includes(bomItem.name.toLowerCase())))
          );
        });
        
        matchingBomItems.forEach(matchingBomItem => {
          const existingVendors = partVendorMap.get(matchingBomItem.id) || [];
          
          rfq.vendors.forEach(vendor => {
            if (!vendor.id || !vendor.name) {
              return;
            }
            
            const existingVendorIndex = existingVendors.findIndex(v => v.vendorId === vendor.id);
            
            if (existingVendorIndex >= 0) {
              const existing = existingVendors[existingVendorIndex];
              if (existing) {
                existing.rfqCount++;
                if (vendor.responded && vendor.quoteAmount) {
                  existing.responded = true;
                  existing.quoteAmount = vendor.quoteAmount;
                  if (vendor.leadTimeDays !== undefined) {
                    existing.leadTimeDays = vendor.leadTimeDays;
                  }
                }
              }
            } else {
              existingVendors.push({
                vendorId: vendor.id,
                vendorName: vendor.name,
                responded: vendor.responded,
                rfqCount: 1,
                ...(vendor.email !== undefined && { vendorEmail: vendor.email }),
                ...(vendor.quoteAmount !== undefined && { quoteAmount: vendor.quoteAmount }),
                ...(vendor.leadTimeDays !== undefined && { leadTimeDays: vendor.leadTimeDays }),
              });
            }
          });
          
          partVendorMap.set(matchingBomItem.id, existingVendors);
        });
      });
    });
    
    return partVendorMap;
  }, [rfqTrackingRecords, bomItems]);

  // Get approved vendors - either BOM part-specific vendors or general approved vendors
  const approvedVendors = useMemo(() => {
    // If BOM parts are selected, get vendors who received RFQs for those specific parts
    if (selectedBomPartIds.length > 0) {
      const bomPartVendors = new Map<string, any>();
      
      selectedBomPartIds.forEach(partId => {
        const partVendors = bomPartVendorMap.get(partId) || [];
        partVendors.forEach(vendor => {
          if (!bomPartVendors.has(vendor.vendorId)) {
            // Find the full vendor object
            const fullVendor = vendors.find(v => v.id === vendor.vendorId);
            if (fullVendor) {
              bomPartVendors.set(vendor.vendorId, {
                ...fullVendor,
                rfqData: vendor
              });
            }
          }
        });
      });
      
      return Array.from(bomPartVendors.values());
    }

    // Fallback to general approved vendors (existing logic)
    const approvedVendorIds = new Set<string>();

    // Add vendors from supplier evaluations
    supplierEvaluations.forEach(evaluation => {
      if (evaluation?.status === 'completed' ||
          evaluation?.status === 'approved' ||
          evaluation?.recommendationStatus === 'recommended') {
        if (evaluation.vendorId) {
          approvedVendorIds.add(evaluation.vendorId);
        }
      }
    });

    // Add vendors from RFQ tracking
    rfqTrackingRecords.forEach(record => {
      if (record?.vendors && Array.isArray(record.vendors)) {
        record.vendors.forEach(vendor => {
          if (vendor?.id) {
            approvedVendorIds.add(vendor.id);
          }
        });
      }
    });

    return vendors.filter(vendor => vendor?.id && approvedVendorIds.has(vendor.id));
  }, [vendors, supplierEvaluations, rfqTrackingRecords, selectedBomPartIds, bomPartVendorMap, bomItems]);

  // Stable vendor stats calculation
  const vendorStats = useMemo(() => {
    const stats = new Map();
    
    // If we have BOM parts selected, use the specific RFQ data for those parts
    if (selectedBomPartIds.length > 0) {
      selectedBomPartIds.forEach(partId => {
        const partVendors = bomPartVendorMap.get(partId) || [];
        partVendors.forEach(vendor => {
          const existing = stats.get(vendor.vendorId) || { responseCount: 0, totalQuotes: 0 };
          if (vendor.responded && vendor.quoteAmount) {
            existing.responseCount++;
            existing.totalQuotes += vendor.quoteAmount;
            existing.avgQuote = existing.totalQuotes / existing.responseCount;
          }
          existing.rfqCount = (existing.rfqCount || 0) + vendor.rfqCount;
          stats.set(vendor.vendorId, existing);
        });
      });
    } else {
      // Fallback to general RFQ stats
      rfqTrackingRecords.forEach(record => {
        if (record?.vendors && Array.isArray(record.vendors)) {
          record.vendors.forEach(vendor => {
            if (vendor?.responded && vendor?.quoteAmount && vendor?.id) {
              const existing = stats.get(vendor.id) || { responseCount: 0, totalQuotes: 0 };
              existing.responseCount++;
              existing.totalQuotes += vendor.quoteAmount;
              existing.avgQuote = existing.totalQuotes / existing.responseCount;
              stats.set(vendor.id, existing);
            }
          });
        }
      });
    }
    
    return stats;
  }, [rfqTrackingRecords, selectedBomPartIds, bomPartVendorMap]);

  // Reset form when dialog closes
  React.useEffect(() => {
    if (!open) {
      setNominationName('');
      setDescription('');
      setSelectedVendorIds([]);
      setSelectedBomId('');
      setShowBomParts(false);
      setSelectedBomPartIds([]);
      setBomPartsSearchTerm('');
    }
  }, [open]);

  // Reset selected parts when BOM changes and auto-show BOM parts
  React.useEffect(() => {
    setSelectedBomPartIds([]);
    setBomPartsSearchTerm('');
    // Automatically show BOM parts when a BOM is selected
    if (selectedBomId) {
      setShowBomParts(true);
    }
  }, [selectedBomId]);

  const handleVendorToggle = useCallback((vendorId: string) => {
    setSelectedVendorIds(prev => {
      if (prev.includes(vendorId)) {
        return prev.filter(id => id !== vendorId);
      } else {
        // Check if already at maximum limit of 4 vendors
        if (prev.length >= 4) {
          toast.error('Maximum 4 vendors allowed per nomination');
          return prev;
        }
        return [...prev, vendorId];
      }
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    const allVendorIds = approvedVendors.map(v => v.id).filter(Boolean);
    setSelectedVendorIds(prev => {
      if (prev.length === Math.min(allVendorIds.length, 4)) {
        // Deselect all
        return [];
      } else {
        // Select up to 4 vendors
        const limitedVendorIds = allVendorIds.slice(0, 4);
        if (allVendorIds.length > 4) {
          toast.info('Selected first 4 vendors (maximum limit)');
        }
        return limitedVendorIds;
      }
    });
  }, [approvedVendors]);

  const handleBomPartToggle = useCallback((bomPartId: string) => {
    setSelectedBomPartIds(prev => {
      if (prev.includes(bomPartId)) {
        return prev.filter(id => id !== bomPartId);
      } else {
        return [...prev, bomPartId];
      }
    });
  }, []);

  const handleSelectAllBomParts = useCallback(() => {
    const allFilteredBomPartIds = filteredBomItems.map(item => item.id);
    setSelectedBomPartIds(prev => {
      // Check if all filtered items are selected
      const allFilteredSelected = allFilteredBomPartIds.every(id => prev.includes(id));
      
      if (allFilteredSelected) {
        // Remove all filtered items from selection
        return prev.filter(id => !allFilteredBomPartIds.includes(id));
      } else {
        // Add all filtered items to selection
        const newSelection = [...prev];
        allFilteredBomPartIds.forEach(id => {
          if (!newSelection.includes(id)) {
            newSelection.push(id);
          }
        });
        return newSelection;
      }
    });
  }, [filteredBomItems]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!nominationName.trim()) {
      toast.error('Please enter a nomination name');
      return;
    }

    if (selectedVendorIds.length === 0) {
      toast.error('Please select at least one vendor');
      return;
    }

    // Only include selected BOM parts if any are selected
    const selectedBomItems = selectedBomPartIds.length > 0 
      ? bomItems.filter(item => selectedBomPartIds.includes(item.id))
      : [];

    const formData: CreateSupplierNominationData = {
      nominationName: nominationName.trim(),
      description: description.trim(),
      nominationType: NominationType.MANUFACTURER,
      projectId,
      ...(evaluationGroupId !== undefined && { evaluationGroupId }),
      vendorIds: selectedVendorIds,
      ...(selectedBomItems.length > 0 && {
        bomParts: selectedBomItems.map(item => ({
          bomItemId: item.id,
          bomItemName: item.name,
          quantity: item.quantity,
          vendorIds: selectedVendorIds,
          ...(item.partNumber !== undefined && { partNumber: item.partNumber }),
          ...(item.material !== undefined && { material: item.material }),
        }))
      })
    };

    try {
      const result = await createNominationMutation.mutateAsync(formData);
      
      if (result?.id) {
        onSuccess?.(result.id);
      }
      onOpenChange(false);
      const successMessage = selectedBomItems.length > 0 
        ? `Supplier nomination created with ${selectedBomItems.length} BOM parts and ${selectedVendorIds.length} vendors`
        : 'Supplier nomination created successfully';
      toast.success(successMessage);
    } catch (error: any) {
      const errorMessage = error?.message || error?.response?.data?.error?.message || error?.response?.data?.message || 'Failed to create nomination';
      toast.error(errorMessage);
    }
  };

  const getVendorTypeIcon = (vendorType?: string) => {
    switch (vendorType?.toLowerCase()) {
      case 'oem':
        return <Award className="h-4 w-4 text-blue-400" />;
      case 'manufacturer':
        return <Factory className="h-4 w-4 text-green-400" />;
      default:
        return <Building2 className="h-4 w-4 text-gray-400" />;
    }
  };

  const getReliabilityBadge = (stats: any) => {
    if (!stats) return null;

    const responseRate = stats.responseCount || 0;
    if (responseRate >= 3) {
      return <Badge variant="outline" className="border-green-500 text-green-400">Highly Reliable</Badge>;
    } else if (responseRate >= 2) {
      return <Badge variant="outline" className="border-yellow-500 text-yellow-400">Reliable</Badge>;
    }
    return <Badge variant="outline" className="border-gray-500 text-gray-400">New Vendor</Badge>;
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 z-50 bg-black/80"
        onClick={() => onOpenChange(false)}
      />
      
      {/* Modal Content */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div 
          className="bg-gray-800 border border-gray-700 rounded-lg shadow-lg max-w-4xl w-full max-h-[90vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-700">
            <div>
              <h2 className="text-xl font-semibold text-white">Create Supplier Nomination</h2>
              <p className="text-sm text-gray-400 mt-1">
                Create a new supplier nomination from approved RFQ vendors for evaluation and scoring.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-gray-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Nomination Name *
                </label>
                <Input
                  value={nominationName}
                  onChange={(e) => setNominationName(e.target.value)}
                  placeholder="e.g., Q2 2026 OEM Selection"
                  className="bg-gray-700 border-gray-600 text-white"
                  required
                  maxLength={255}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Description
                </label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter nomination description and objectives..."
                  className="bg-gray-700 border-gray-600 text-white"
                  rows={3}
                  maxLength={1000}
                />
              </div>

              {/* BOM Selection */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-medium text-gray-300">
                    BOM Selection (Optional)
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowBomParts(!showBomParts)}
                    className="text-gray-400 hover:text-white"
                  >
                    {showBomParts ? (
                      <>
                        <ChevronUp className="h-4 w-4 mr-1" />
                        Hide BOM Parts
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-4 w-4 mr-1" />
                        Show BOM Parts
                      </>
                    )}
                  </Button>
                </div>

                {boms.length > 0 ? (
                  <div className="space-y-3">
                    <select
                      value={selectedBomId}
                      onChange={(e) => setSelectedBomId(e.target.value)}
                      className="w-full bg-gray-700 border-gray-600 text-white rounded-md px-3 py-2"
                    >
                      <option value="">Select a BOM (optional)</option>
                      {boms.map((bom) => (
                        <option key={bom.id} value={bom.id}>
                          {bom.name} - {bom.description || 'No description'}
                        </option>
                      ))}
                    </select>

                    {selectedBomId && showBomParts && (
                      <Card className="bg-gray-700 border-gray-600">
                        <CardContent className="p-4">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Package className="h-4 w-4 text-blue-400" />
                                <h4 className="text-sm font-medium text-white">
                                  BOM Parts ({bomItems.length})
                                </h4>
                              </div>
                              {filteredBomItems.length > 0 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={handleSelectAllBomParts}
                                  className="text-xs text-blue-400 hover:text-blue-300"
                                >
                                  {filteredBomItems.every(item => selectedBomPartIds.includes(item.id)) ? 'Deselect All' : 'Select All'}
                                </Button>
                              )}
                            </div>

                            {bomItems.length > 0 && (
                              <div className="relative">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <Input
                                  placeholder="Search BOM parts..."
                                  value={bomPartsSearchTerm}
                                  onChange={(e) => setBomPartsSearchTerm(e.target.value)}
                                  className="pl-9 bg-gray-600 border-gray-500 text-white text-sm"
                                />
                              </div>
                            )}
                          </div>
                          
                          {bomItems.length === 0 ? (
                            <p className="text-sm text-gray-400 mt-3">No parts found in this BOM</p>
                          ) : filteredBomItems.length === 0 ? (
                            <p className="text-sm text-gray-400 mt-3">No parts match your search criteria</p>
                          ) : (
                            <div className="space-y-2 max-h-64 overflow-y-auto mt-3">
                              {filteredBomItems.map((item) => {
                                const isSelected = selectedBomPartIds.includes(item.id);
                                return (
                                  <div 
                                    key={item.id} 
                                    className={`p-3 rounded cursor-pointer transition-all ${
                                      isSelected 
                                        ? 'bg-blue-900/50 border border-blue-500' 
                                        : 'bg-gray-800 border border-gray-700 hover:border-gray-600'
                                    }`}
                                    onClick={() => handleBomPartToggle(item.id)}
                                  >
                                    <div className="flex items-start gap-3">
                                      <div className={`w-4 h-4 mt-0.5 rounded border-2 flex items-center justify-center ${
                                        isSelected 
                                          ? 'bg-blue-600 border-blue-600' 
                                          : 'border-gray-400 bg-transparent'
                                      }`}>
                                        {isSelected && (
                                          <CheckCircle className="w-3 h-3 text-white" />
                                        )}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="font-medium text-gray-200 text-sm truncate">
                                          {item.name}
                                        </div>
                                        <div className="text-xs text-gray-400 mt-1">
                                          Part: {item.partNumber || '—'} | Qty: {item.quantity} {item.unit || ''} | Material: {item.material || '—'}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          
                          {selectedBomPartIds.length > 0 && (
                            <div className="mt-3 p-2 bg-blue-900/20 border border-blue-700 rounded">
                              <div className="text-xs text-blue-400">
                                {selectedBomPartIds.length} part(s) selected for nomination
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">No BOMs available for this project</p>
                )}
              </div>

              <div>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-medium text-white">
                    {selectedBomPartIds.length > 0 
                      ? `Select Vendors for BOM Parts (${approvedVendors.length} available with RFQs)`
                      : `Select Approved Vendors (${approvedVendors.length} available)`
                    }
                  </h3>
                  {approvedVendors.length > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleSelectAll}
                      className="border-gray-600 text-gray-300 hover:bg-gray-700"
                    >
                      {selectedVendorIds.length === approvedVendors.length ? 'Deselect All' : 'Select All'}
                    </Button>
                  )}
                </div>

                {approvedVendors.length === 0 ? (
                  <Card className="bg-gray-700 border-gray-600">
                    <CardContent className="p-6 text-center">
                      <div className="text-gray-400 mb-2">
                        {selectedBomPartIds.length > 0 
                          ? `No vendors found with RFQs for ${selectedBomPartIds.length} selected BOM parts`
                          : "No approved vendors found"
                        }
                      </div>
                      <div className="text-sm text-gray-500">
                        {selectedBomPartIds.length > 0
                          ? `Check: 1) RFQs sent for selected parts, 2) Part numbers match in RFQ tracking, 3) Try different BOM parts`
                          : "Complete RFQ evaluations first to nominate vendors"
                        }
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-96 overflow-y-auto">
                    {approvedVendors.map((vendor) => {
                      if (!vendor?.id) return null;

                      const stats = vendorStats.get(vendor.id);
                      const isSelected = selectedVendorIds.includes(vendor.id);
                      const isDisabled = !isSelected && selectedVendorIds.length >= 4;

                      return (
                        <Card
                          key={vendor.id}
                          className={`transition-all duration-200 ${
                            isDisabled 
                              ? 'bg-gray-800 border-gray-700 opacity-50 cursor-not-allowed'
                              : isSelected
                                ? 'bg-blue-900/50 border-blue-500 cursor-pointer'
                                : 'bg-gray-700 border-gray-600 hover:border-gray-500 cursor-pointer'
                            }`}
                          onClick={() => !isDisabled && handleVendorToggle(vendor.id)}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between">
                              <div className="flex items-start gap-3">
                                <div className={`w-4 h-4 mt-1 rounded border-2 flex items-center justify-center ${
                                  isDisabled 
                                    ? 'cursor-not-allowed border-gray-600 bg-gray-700'
                                    : isSelected 
                                      ? 'bg-blue-600 border-blue-600 cursor-pointer' 
                                      : 'border-gray-400 bg-transparent cursor-pointer'
                                }`}>
                                  {isSelected && (
                                    <CheckCircle className="w-3 h-3 text-white" />
                                  )}
                                </div>
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    {getVendorTypeIcon(vendor.vendorType)}
                                    <h4 className="font-medium text-white">{vendor.name || 'Unknown Vendor'}</h4>
                                  </div>

                                  <div className="space-y-2">
                                    {vendor.companyEmail && (
                                      <p className="text-sm text-gray-400">{vendor.companyEmail}</p>
                                    )}

                                    <div className="flex flex-wrap gap-2">
                                      {getReliabilityBadge(stats)}

                                      {stats && (
                                        <Badge variant="secondary" className="text-xs">
                                          {stats.responseCount || 0} RFQ responses
                                          {stats.rfqCount && ` (${stats.rfqCount} RFQs)`}
                                        </Badge>
                                      )}
                                      
                                      {vendor.rfqData && (
                                        <Badge variant="outline" className="text-xs border-blue-500 text-blue-400">
                                          BOM Part RFQ
                                        </Badge>
                                      )}
                                    </div>

                                    {vendor.process && Array.isArray(vendor.process) && vendor.process.length > 0 && (
                                      <div className="flex flex-wrap gap-1">
                                        {vendor.process.slice(0, 3).map((process: string, idx: number) => (
                                          <Badge key={idx} variant="outline" className="text-xs border-gray-500 text-gray-400">
                                            {process}
                                          </Badge>
                                        ))}
                                        {vendor.process.length > 3 && (
                                          <Badge variant="outline" className="text-xs border-gray-500 text-gray-400">
                                            +{vendor.process.length - 3} more
                                          </Badge>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {isSelected && (
                                <CheckCircle className="h-5 w-5 text-blue-400 flex-shrink-0" />
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>

              {selectedVendorIds.length > 0 && (
                <div className="p-4 bg-blue-900/20 border border-blue-700 rounded-lg">
                  <div className="text-sm text-blue-400">
                    <strong>{selectedVendorIds.length} of 4</strong> vendor(s) selected for nomination
                    {selectedVendorIds.length === 4 && (
                      <span className="ml-2 text-yellow-400">(Maximum reached)</span>
                    )}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  className="border-gray-600 text-gray-300 hover:bg-gray-700"
                  disabled={createNominationMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    createNominationMutation.isPending ||
                    selectedVendorIds.length === 0 ||
                    !nominationName.trim()
                  }
                  className="bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                >
                  {createNominationMutation.isPending ? 'Creating...' : 'Create Nomination'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}