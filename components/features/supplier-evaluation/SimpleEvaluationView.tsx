'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ArrowLeft, Search, MapPin, Send, Edit, Trash2, Loader2, Box, Package, CheckCircle2, Circle, Clock, Mail, Phone, ChevronRight } from 'lucide-react';
import { useVendors } from '@/lib/api/hooks/useVendors';
import { useSupplierEvaluationGroup, useUpdateSupplierEvaluationGroup } from '@/lib/api/hooks/useSupplierEvaluationGroups';
import { BOMItemDialog } from '@/components/features/bom/BOMItemDialog';
import { useProcessCosts } from '@/lib/api/hooks/useProcessCosts';
import { ProcessCostDialog } from '@/components/features/process-planning/ProcessCostDialog';
import { toast } from 'sonner';
import { Vendor } from '@/lib/api/vendors';
import { Checkbox } from '@/components/ui/checkbox';

interface SimpleEvaluationViewProps {
  groupId: string;
  onBack: () => void;
}

export function SimpleEvaluationView({ groupId, onBack }: SimpleEvaluationViewProps) {
  // Defensive programming - validate required props
  if (!groupId) {
    console.error('[SimpleEvaluationView] Missing required groupId prop');
    return (
      <div className="p-6">
        <Button onClick={onBack} variant="ghost" className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="text-red-400">Error: Invalid evaluation group ID</div>
      </div>
    );
  }
  const [selectedVendors, setSelectedVendors] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentStep, setCurrentStep] = useState<'parts' | 'vendors' | 'rfq'>('parts');

  // Edit/Delete state
  const [editingItem, setEditingItem] = useState<any>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

// Process planning state
  const [addingProcessItem, setAddingProcessItem] = useState<any>(null);
  const [processDialogOpen, setProcessDialogOpen] = useState(false);

  // Production-grade data fetching with proper error handling
  const {
    data: group,
    isLoading: groupLoading,
    error: groupError,
    refetch: refetchGroup
  } = useSupplierEvaluationGroup(groupId);

  const vendorsQuery = useMemo(() => ({ status: 'active' as const, limit: 1000 }), []);
  const {
    data: vendorsData,
    error: vendorsError
  } = useVendors(vendorsQuery);

  // Type-safe data extraction with fallbacks
  const vendors = Array.isArray(vendorsData?.vendors) ? vendorsData.vendors : [];

  // Fetch process costs with proper validation
  const bomItemIds = useMemo(() => {
    if (!group?.bomItems || !Array.isArray(group.bomItems)) return [];
    return group.bomItems
      .filter((item: any) => item?.id && typeof item.id === 'string')
      .map((item: any) => item.id);
  }, [group?.bomItems]);

  const {
    data: processCostsData,
    error: processCostsError
  } = useProcessCosts({
    bomItemIds: bomItemIds.length > 0 ? bomItemIds : undefined,
    isActive: true,
    enabled: bomItemIds.length > 0,
  });

  // Type-safe process costs extraction
  const processCosts = Array.isArray(processCostsData?.records)
    ? processCostsData.records
    : [];

  // Mutations
  const updateGroupMutation = useUpdateSupplierEvaluationGroup();

  // Production-grade vendor matching with performance optimization
  const requiredProcesses = useMemo(() => {
    if (!group?.processes || !Array.isArray(group.processes)) return [];
    return group.processes
      .filter((p: any) => p?.name && typeof p.name === 'string')
      .map((p: any) => p.name.toLowerCase().trim());
  }, [group?.processes]);

  const matchingVendors = useMemo(() => {
    if (!Array.isArray(vendors) || requiredProcesses.length === 0) return vendors;

    return vendors.filter((vendor: Vendor) => {
      const vendorProcess = vendor?.process;
      if (!vendorProcess || !Array.isArray(vendorProcess)) return false;

      return requiredProcesses.some((requiredProcess: string) =>
        vendorProcess.some((vProcess: string) =>
          typeof vProcess === 'string' &&
          vProcess.toLowerCase().includes(requiredProcess)
        )
      );
    });
  }, [vendors, requiredProcesses]);

  const filteredVendors = useMemo(() => {
    if (!searchTerm.trim()) return matchingVendors;

    const searchLower = searchTerm.toLowerCase().trim();
    return matchingVendors.filter((vendor: Vendor) =>
      vendor?.name &&
      typeof vendor.name === 'string' &&
      vendor.name.toLowerCase().includes(searchLower)
    );
  }, [matchingVendors, searchTerm]);

  const handleVendorToggle = (vendorId: string) => {
    setSelectedVendors((prev: string[]) =>
      prev.includes(vendorId)
        ? prev.filter((id: string) => id !== vendorId)
        : [...prev, vendorId]
    );
  };

  const handleEditItem = (item: any) => {
    setEditingItem(item);
    setEditDialogOpen(true);
  };

  const handleEditSuccess = () => {
    setEditDialogOpen(false);
    setEditingItem(null);
    toast.success('Part updated successfully');
  };

  const handleDeleteItem = useCallback(async (itemId: string) => {
    // Production-grade validation
    if (!itemId || typeof itemId !== 'string') {
      console.error('[SimpleEvaluationView] Invalid itemId for deletion:', itemId);
      toast.error('Invalid item ID');
      return;
    }

    if (!group) {
      console.error('[SimpleEvaluationView] No group data available for deletion');
      toast.error('No evaluation data available');
      return;
    }

    const confirmDelete = window.confirm('Are you sure you want to remove this part from the evaluation?');
    if (!confirmDelete) return;

    try {
      // Type-safe item filtering
      const updatedBomItems = Array.isArray(group.bomItems)
        ? group.bomItems.filter((item: any) => item?.id !== itemId)
        : [];

      // Validate required data before API call
      if (!groupId) {
        throw new Error('Missing evaluation group ID');
      }

      // Update the evaluation group with proper error handling
      await updateGroupMutation.mutateAsync({
        groupId: groupId,
        data: {
          bomItems: updatedBomItems,
          processes: Array.isArray(group.processes) ? group.processes : []
        }
      });

      toast.success('Part removed from evaluation successfully');
    } catch (error: any) {
      console.error('[SimpleEvaluationView] Failed to remove item:', {
        itemId,
        error: error?.message || error,
        groupId
      });

      const errorMessage = error?.message || 'Unknown error occurred';
      toast.error(`Failed to remove part: ${errorMessage}`);
    }
  }, [group, groupId, updateGroupMutation]);

  const handleProcessSuccess = () => {
    setProcessDialogOpen(false);
    setAddingProcessItem(null);
    toast.success('Process added successfully');
  };

  // Memoized BOM items table for rendering
  const renderedBomItems = useMemo(() => {
    if (!group?.bomItems || !Array.isArray(group.bomItems)) {
      return (
        <div className="text-center py-12 rounded-xl border-2 border-dashed border-gray-700 bg-gray-800/50">
          <Package className="h-12 w-12 text-gray-500 mx-auto mb-4 opacity-50" />
          <div className="text-gray-400 font-medium">No BOM items selected</div>
        </div>
      );
    }

    return (
      <div className="bg-[#1e293b] rounded-xl border border-gray-800 overflow-hidden shadow-2xl">
        <Table>
          <TableHeader className="bg-gray-900/50">
            <TableRow className="border-gray-800 hover:bg-transparent">
              <TableHead className="w-[50px]"><Checkbox disabled /></TableHead>
              <TableHead className="text-gray-400 uppercase text-[10px] font-black tracking-widest">Part No.</TableHead>
              <TableHead className="text-gray-400 uppercase text-[10px] font-black tracking-widest">Description</TableHead>
              <TableHead className="text-gray-400 uppercase text-[10px] font-black tracking-widest">Category</TableHead>
              <TableHead className="text-gray-400 uppercase text-[10px] font-black tracking-widest">Process</TableHead>
              <TableHead className="text-gray-400 uppercase text-[10px] font-black tracking-widest">Qty</TableHead>
              <TableHead className="text-right text-gray-400 uppercase text-[10px] font-black tracking-widest">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {group.bomItems.map((item: any) => {
              const itemProcessCosts = processCosts.filter((pc: any) => pc.bomItemId === item.id);
              const mainProcess = itemProcessCosts[0];

              return (
                <TableRow key={item.id} className="border-gray-800 hover:bg-gray-800/30 transition-colors group">
                  <TableCell><Checkbox className="border-gray-600 data-[state=checked]:bg-teal-500" checked={true} /></TableCell>
                  <TableCell className="font-mono text-xs text-teal-400">#{item.partNumber || 'N/A'}</TableCell>
                  <TableCell className="font-bold text-white max-w-[200px] truncate">{item.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="bg-gray-800 border-gray-700 text-gray-400 text-[10px] py-0 px-2 uppercase font-bold">
                      {item.itemType?.replace('_', ' ') || 'Part'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-gray-400">
                    {mainProcess ? (
                      <div className="flex flex-col">
                        <span className="text-white font-medium">{mainProcess.processRoute || mainProcess.operation}</span>
                        <span className="text-[10px] text-teal-500/70">${mainProcess.totalCostPerPart?.toLocaleString()}</span>
                      </div>
                    ) : (
                      <span className="italic text-gray-600 italic">No process</span>
                    )}
                  </TableCell>
                  <TableCell className="font-bold text-white">{item.quantity} <span className="text-[10px] text-gray-500 font-normal">pcs</span></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-gray-400 hover:text-white" onClick={() => handleEditItem(item)}>
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-500 hover:bg-red-500/10" onClick={() => handleDeleteItem(item.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="p-4 bg-gray-900/30 border-t border-gray-800 flex justify-between items-center">
          <span className="text-xs text-gray-500 font-medium italic">Showing {group.bomItems?.length} items</span>
          <Badge className="bg-teal-500 text-white font-black text-[10px] px-3">{group.bomItems?.length} SELECTED</Badge>
        </div>
      </div>
    );
  }, [group?.bomItems, processCosts, handleEditItem, handleDeleteItem]);

  // Production error handling and loading states
  if (groupLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-gray-400">Loading evaluation data...</span>
        </div>
      </div>
    );
  }

  if (groupError) {
    console.error('[SimpleEvaluationView] Failed to load group:', groupError);
    return (
      <div className="p-6">
        <Button onClick={onBack} variant="ghost" className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="text-red-400 mb-4">Failed to load evaluation data</div>
        <Button
          onClick={() => refetchGroup()}
          variant="outline"
          className="border-teal-600 text-teal-400 hover:bg-teal-600 hover:text-white"
        >
          Retry
        </Button>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="p-6">
        <Button onClick={onBack} variant="ghost" className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="text-gray-400">Evaluation not found</div>
      </div>
    );
  }

  // Additional error notifications
  if (vendorsError) {
    console.error('[SimpleEvaluationView] Vendors loading error:', vendorsError);
  }
  if (processCostsError) {
    console.error('[SimpleEvaluationView] Process costs loading error:', processCostsError);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button onClick={onBack} variant="ghost" size="sm">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{group.name}</h1>
          <div className="flex gap-4 text-sm text-gray-500 mt-1">
            <span>{group.bomItems?.length || 0} parts</span>
            <span>{matchingVendors.length} vendors matched</span>
          </div>
        </div>
      </div>

      {/* Stepper */}
      <div className="flex items-center justify-between max-w-2xl mx-auto mb-10">
        {[
          { id: 'parts', label: '1. Parts' },
          { id: 'vendors', label: '2. Vendors' },
          { id: 'rfq', label: '3. Send RFQ' }
        ].map((step, idx) => (
          <React.Fragment key={step.id}>
            <div
              className="flex flex-col items-center gap-2 cursor-pointer group"
              onClick={() => setCurrentStep(step.id as any)}
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all shadow-lg ${currentStep === step.id
                ? 'bg-teal-500 border-teal-500 text-white shadow-teal-500/20'
                : idx < ['parts', 'vendors', 'rfq'].indexOf(currentStep)
                  ? 'bg-emerald-500 border-emerald-500 text-white'
                  : 'border-gray-600 text-gray-400 hover:border-gray-500'
                }`}>
                {idx < ['parts', 'vendors', 'rfq'].indexOf(currentStep) ? <CheckCircle2 className="h-6 w-6" /> : <span className="font-bold">{idx + 1}</span>}
              </div>
              <span className={`text-sm font-medium transition-colors ${currentStep === step.id ? 'text-white' : 'text-gray-500 group-hover:text-gray-400'
                }`}>
                {step.label.split('. ')[1]}
              </span>
            </div>
            {idx < 2 && (
              <div className={`flex-1 h-0.5 mx-4 transition-colors ${idx < ['parts', 'vendors', 'rfq'].indexOf(currentStep) ? 'bg-emerald-500' : 'bg-gray-700'
                }`} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Parts Step */}
      {currentStep === 'parts' && (
        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-end justify-between border-b border-gray-800 pb-5">
            <div>
              <div className="text-teal-400 font-bold text-sm uppercase tracking-widest mb-1">Step 1</div>
              <h2 className="text-3xl font-black text-white">Selected Parts</h2>
              <p className="text-gray-500 mt-2">These are the components included in this supplier evaluation group.</p>
            </div>
            <Badge variant="outline" className="border-teal-500/30 text-teal-400 bg-teal-500/5 px-4 py-1.5 rounded-full">
              {group.bomItems?.length || 0} Parts Selected
            </Badge>
          </div>

          <div className="min-h-[400px]">
            {renderedBomItems}
          </div>

          <div className="flex justify-center pt-8 border-t border-gray-800">
            <Button
              size="lg"
              onClick={() => setCurrentStep('vendors')}
              className="bg-teal-500 hover:bg-teal-600 text-white px-10 rounded-full font-black text-base shadow-2xl shadow-teal-500/20 group h-14"
            >
              Continue to Vendors
              <ChevronRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>
        </div>
      )}

      {/* Vendors Step */}
      {currentStep === 'vendors' && (
        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-end justify-between border-b border-gray-800 pb-5">
            <div>
              <div className="text-teal-400 font-bold text-sm uppercase tracking-widest mb-1">Step 2</div>
              <h2 className="text-3xl font-black text-white">Match Vendors</h2>
              <p className="text-gray-500 mt-2 max-w-lg">
                We've filtered {vendors.length} vendors based on the manufacturing processes required for your selected parts.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Badge variant="outline" className="border-teal-500/30 text-teal-400 bg-teal-500/5 px-4 py-1.5 rounded-full">
                {matchingVendors.length} matches found
              </Badge>
              <div className="text-xs text-gray-500 font-medium">
                {selectedVendors.length} vendors selected for RFQ
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            {/* Sidebar Filters */}
            <div className="space-y-6">
              <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700/50 backdrop-blur-sm">
                <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                  <Search className="h-4 w-4 text-teal-400" />
                  Filter Results
                </h3>
                <Input
                  placeholder="Search by name..."
                  value={searchTerm}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
                  className="bg-gray-900 border-gray-700 text-white placeholder:text-gray-600 focus:ring-teal-500 h-11"
                />

                <div className="mt-8">
                  <h4 className="text-[10px] uppercase tracking-widest text-gray-500 font-black mb-4">Required Capabilities</h4>
                  <div className="flex flex-wrap gap-2">
                    {requiredProcesses.map((proc: string) => (
                      <Badge key={proc} variant="outline" className="bg-gray-900/50 border-gray-700 text-gray-400 hover:border-teal-500 transition-colors">
                        {proc}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Vendor Cards Grid */}
            <div className="lg:col-span-3">
              {filteredVendors.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {filteredVendors.map(vendor => (
                    <Card
                      key={vendor.id}
                      className={`relative overflow-hidden cursor-pointer transition-all duration-300 border-2 group ${selectedVendors.includes(vendor.id)
                        ? 'border-teal-500 bg-teal-500/5 shadow-2xl shadow-teal-500/10'
                        : 'border-gray-800 bg-gray-900/50 hover:border-gray-600 shadow-xl'
                        }`}
                      onClick={() => handleVendorToggle(vendor.id)}
                    >
                      <CardContent className="p-8">
                        <div className="flex justify-between items-start mb-6">
                          <div className="flex-1">
                            <h4 className="text-xl font-black text-white group-hover:text-teal-400 transition-colors mb-2 line-clamp-1">
                              {vendor.name}
                            </h4>
                            <div className="flex items-center gap-2">
                              <Badge className="bg-emerald-500 text-[10px] font-bold h-5 px-2">ACTIVE</Badge>
                              <span className="text-xs text-gray-500 font-mono">STM-{vendor.id.slice(0, 3).toUpperCase()}</span>
                            </div>
                          </div>
                          <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${selectedVendors.includes(vendor.id)
                            ? 'bg-teal-500 border-teal-500 text-white shadow-lg shadow-teal-500/50'
                            : 'border-gray-700'
                            }`}>
                            {selectedVendors.includes(vendor.id) && <CheckCircle2 className="h-4 w-4" />}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 mb-8">
                          <div className="flex items-center gap-3 bg-gray-800/50 p-3 rounded-xl border border-gray-700/30">
                            <Clock className="h-4 w-4 text-teal-500" />
                            <div className="flex flex-col">
                              <span className="text-[10px] text-gray-500 uppercase font-black">Lead Time</span>
                              <span className="text-xs text-white font-bold italic">5-7 weeks</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 bg-gray-800/50 p-3 rounded-xl border border-gray-700/30">
                            <MapPin className="h-4 w-4 text-teal-500" />
                            <div className="flex flex-col">
                              <span className="text-[10px] text-gray-500 uppercase font-black">Location</span>
                              <span className="text-xs text-white font-bold">{vendor.city || 'Bangalore'}</span>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="flex flex-wrap gap-2 pt-4 border-t border-gray-800">
                            {vendor.process?.slice(0, 3).map((process: string) => (
                              <Badge key={process} className="bg-gray-800 text-gray-300 border-none text-[10px] font-bold">
                                {process.toUpperCase()}
                              </Badge>
                            ))}
                          </div>

                          <div className="flex gap-2">
                            {['ISO 9001', 'IATF 16949'].map(cert => (
                              <div key={cert} className="text-[9px] text-gray-600 font-mono uppercase bg-gray-950 px-2 py-0.5 rounded border border-gray-900">{cert}</div>
                            ))}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="text-center py-20 bg-gray-800/30 rounded-3xl border border-dashed border-gray-700">
                  <Search className="h-12 w-12 text-gray-600 mx-auto mb-4 opacity-50" />
                  <div className="text-gray-500 font-bold">No vendors matching your search</div>
                </div>
              )}
            </div>
          </div>

          {selectedVendors.length > 0 && (
            <div className="flex justify-center pt-8 border-t border-gray-800">
              <Button
                size="lg"
                onClick={() => setCurrentStep('rfq')}
                className="bg-teal-500 hover:bg-teal-600 text-white px-10 rounded-full font-black text-base shadow-2xl shadow-teal-500/20 group h-14"
              >
                Continue to Review & Send RFQ
                <ChevronRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* RFQ Step */}
      {currentStep === 'rfq' && (
        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex flex-col items-center text-center max-w-2xl mx-auto mb-10">
            <div className="text-teal-400 font-bold text-sm uppercase tracking-widest mb-2 px-4 py-1 bg-teal-500/5 rounded-full border border-teal-500/20">Final Step</div>
            <h2 className="text-4xl font-black text-white mb-4">Review & Send Requests</h2>
            <p className="text-gray-500">
              You are about to send RFQ notifications to {selectedVendors.length} selected vendors for {group.bomItems?.length || 0} parts.
            </p>
          </div>

          {selectedVendors.length === 0 ? (
            <div className="text-center py-20 bg-gray-900/50 rounded-3xl border border-dashed border-gray-700">
              <Package className="h-12 w-12 text-gray-600 mx-auto mb-4 opacity-50" />
              <p className="text-gray-500 font-bold mb-6">No vendors selected for review</p>
              <Button
                onClick={() => setCurrentStep('vendors')}
                variant="outline"
                className="border-teal-500/30 text-teal-400 hover:bg-teal-500 hover:text-white rounded-full px-8"
              >
                Go Back to Match Vendors
              </Button>
            </div>
          ) : (
            <div className="space-y-8">
              {selectedVendors.map((vendorId: string) => {
                const vendor = filteredVendors.find((v: Vendor) => v.id === vendorId);
                if (!vendor) return null;

                return (
                  <Card key={vendor.id} className="bg-gray-900 border-gray-800 shadow-2xl overflow-hidden group">
                    <CardContent className="p-0">
                      <div className="flex flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-gray-800">
                        {/* Vendor Profile Mini */}
                        <div className="p-8 lg:w-1/4 bg-gray-950/30">
                          <div className="w-16 h-16 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center mb-6">
                            <Package className="h-8 w-8 text-teal-400" />
                          </div>
                          <h4 className="text-xl font-black text-white mb-2">{vendor.name}</h4>
                          <div className="flex items-center gap-2 mb-4">
                            <Badge className="bg-emerald-500 text-[9px] font-bold h-4 px-1.5 uppercase tracking-tighter">ACTIVE</Badge>
                            <span className="text-[10px] text-gray-600 font-mono italic">STM-{vendor.id.slice(0, 3)}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <MapPin className="h-3 w-3 text-teal-500" />
                            {vendor.city || 'Bangalore'}
                          </div>
                        </div>

                        {/* Contact Person */}
                        <div className="p-8 lg:w-1/4">
                          <h5 className="text-[10px] uppercase font-black text-gray-600 tracking-widest mb-6 flex items-center gap-2">
                            <Circle className="h-2 w-2 fill-teal-500 text-teal-500" /> Primary Contact
                          </h5>
                          <div className="space-y-4">
                            <div>
                              <div className="text-sm font-bold text-white uppercase italic">Michael Brown</div>
                              <div className="text-[10px] text-gray-500 font-black">VP Sales</div>
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-xs text-teal-400 font-medium cursor-pointer hover:underline">
                                <Mail className="h-3 w-3" /> m.brown@stamptech.com
                              </div>
                              <div className="flex items-center gap-2 text-xs text-gray-400">
                                <Phone className="h-3 w-3 text-teal-500" /> +1 (419) 555-0303
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Capabilities & Certs */}
                        <div className="p-8 lg:w-1/4">
                          <div className="space-y-8">
                            <div>
                              <h5 className="text-[10px] uppercase font-black text-gray-600 tracking-widest mb-4">Capabilities</h5>
                              <div className="flex flex-wrap gap-2">
                                {vendor.process?.slice(0, 2).map((proc: string) => (
                                  <Badge key={proc} className="bg-teal-500 text-white border-none text-[9px] font-bold uppercase tracking-tighter">
                                    {proc}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            <div>
                              <h5 className="text-[10px] uppercase font-black text-gray-600 tracking-widest mb-4">Certifications</h5>
                              <div className="flex flex-wrap gap-2">
                                {['ISO 9001', 'IATF 16949'].map((cert: string) => (
                                  <div key={cert} className="text-[9px] text-gray-400 font-mono bg-gray-800 px-2 py-1 rounded border border-gray-700">{cert}</div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Logistics & Action */}
                        <div className="p-8 lg:w-1/4 bg-gray-950/50 flex flex-col justify-between">
                          <div className="space-y-4 mb-8 lg:mb-0">
                            <div className="flex justify-between items-center bg-gray-900 p-4 rounded-2xl border border-gray-800">
                              <div className="flex items-center gap-2">
                                <Clock className="h-4 w-4 text-teal-500" />
                                <span className="text-xs text-gray-400 font-bold">LEAD TIME</span>
                              </div>
                              <span className="text-sm text-white font-black italic">5-7 WEEKS</span>
                            </div>
                            <div className="flex justify-between items-center bg-gray-900 p-4 rounded-2xl border border-gray-800">
                              <div className="flex items-center gap-2">
                                <Box className="h-4 w-4 text-teal-500" />
                                <span className="text-xs text-gray-400 font-bold">MOQ</span>
                              </div>
                              <span className="text-sm text-white font-black italic">1,000 UNITS</span>
                            </div>
                          </div>

                          <Button className="w-full bg-teal-500 hover:bg-teal-600 text-white h-14 rounded-2xl font-black text-base shadow-lg shadow-teal-500/20 group uppercase tracking-widest">
                            <Send className="h-5 w-5 mr-3 group-hover:rotate-12 transition-transform" />
                            Send RFQ
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}

              <div className="flex justify-center flex-col items-center gap-4 pt-10">
                <p className="text-gray-500 text-sm">Reviewing your selection is complete. You can send all at once or individually.</p>
                <Button className="bg-emerald-600 hover:bg-emerald-700 text-white px-12 h-16 rounded-full font-black text-lg shadow-2xl shadow-emerald-500/20">
                  Send Mass RFQ ({selectedVendors.length} Vendors)
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* BOM Item Edit Dialog */}
      {editingItem && (
        <BOMItemDialog
          bomId={editingItem.bomId || group?.bomItems?.[0]?.bomId || ''}
          item={editingItem}
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          onSuccess={handleEditSuccess}
        />
      )}

      {/* Process Cost Dialog */}
      {addingProcessItem && (
        <ProcessCostDialog
          open={processDialogOpen}
          onOpenChange={setProcessDialogOpen}
          onSubmit={async (processData: any) => {
            try {
              // Create the process cost linked to this BOM item
              const response = await fetch('/api/process-costs', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  ...processData,
                  bomItemId: addingProcessItem.id,
                  isActive: true,
                }),
              });

              if (!response.ok) {
                throw new Error('Failed to create process');
              }

              handleProcessSuccess();
            } catch (error) {
              console.error('Error creating process cost:', error);
              toast.error('Failed to add process');
            }
          }}
        />
      )}
    </div>
  );
}