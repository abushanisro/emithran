'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { toast } from 'sonner';

import { VendorRatingEngine } from '@/components/features/supplier-nominations/VendorRatingEngine';
import { VendorStatusBadge } from '@/components/features/vendors/VendorStatusBadge';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Search, MapPin, Building2, Send, Package, FileText, TrendingUp, Award, Mail, Box, ArrowLeft, X, Check, UserCheck, Trash2, Plus } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { ListSkeleton } from '@/components/ui/loading-skeleton';
import { Mark } from '@/components/ui/status-mark';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { analyzeTrackingFeature, getFeatureStatusMessage, TrackingFeatureState } from '@/lib/api/features/tracking-feature';
import { useProcessCosts } from '@/lib/api/hooks/useProcessCosts';
import type { ProcessCostListResponse, ProcessCostRecord } from '@/lib/api/hooks/useProcessCosts';
import { useProcesses } from '@/lib/api/hooks/useProcesses';
import { useCreateRfq, useSendRfq } from '@/lib/api/hooks/useRfq';
import { useRfqTrackingRecords, useRfqTrackingStats, useInvalidateRfqTracking, useUpdateRfqTrackingStatus, useDeleteRfqTracking, useCreateRfqTracking } from '@/lib/api/hooks/useRfqTracking';
import { useSupplierNominations } from '@/lib/api/hooks/useSupplierNominations';
import { useVendors } from '@/lib/api/hooks/useVendors';
import { getRfqSummaryText, formatResponseTime, getStatusText, getStatusColor, RfqTrackingStatus } from '@/lib/api/rfq-tracking';

interface BOMPart {
  id: string;
  partNumber: string;
  description: string;
  category: string;
  process: string;
  quantity: number;
  price?: number;
  file2dPath?: string;
  file3dPath?: string;
}

// Use the real vendor interface from API - no custom mock interface needed

interface EvaluationGroupViewProps {
  projectId: string;
  bomParts: BOMPart[];
  evaluationGroupName?: string;
  onViewFile?: (part: BOMPart, fileType: '2d' | '3d') => void;
  onBack?: () => void;
}

export function EvaluationGroupView({ projectId, bomParts, evaluationGroupName, onViewFile, onBack }: EvaluationGroupViewProps) {

  // State declarations first
  const [selectedParts, setSelectedParts] = useState<string[]>([]);
  const [selectedVendors, setSelectedVendors] = useState<string[]>([]);
  const [partsSearchTerm, setPartsSearchTerm] = useState('');
  const [approveModalOpen, setApproveModalOpen] = useState<string | null>(null);
  const [selectedApproveVendors, setSelectedApproveVendors] = useState<string[]>([]);
  const [activeBomTab, setActiveBomTab] = useState('rfq');
  const [partProcesses, setPartProcesses] = useState<Record<string, string[]>>({});
  const [isSubmittingRfq, setIsSubmittingRfq] = useState(false);
  const [selectedVendorForRating, setSelectedVendorForRating] = useState<string | null>(null);
  // Remove local state - use database-backed tracking
  // const [sentRfqs, setSentRfqs] = useState<...>([]);

  // Fetch vendors from API
  const vendorsQuery = useMemo(() => ({ status: 'active' as const, limit: 1000 }), []);
  const { 
    data: vendorsResponse, 
    isLoading: isLoadingVendors 
  } = useVendors(vendorsQuery);
  
  const vendors = vendorsResponse?.vendors || [];
  
  // Fetch existing processes from process planning for all BOM items
  const bomItemIds = bomParts.map(part => part.id);
  const { data: processData } = useProcessCosts({
    bomItemIds,
    enabled: bomItemIds.length > 0,
  });
  
  // Fetch existing supplier nominations for this project
  const { data: supplierNominations, isLoading: isLoadingNominations } = useSupplierNominations(projectId);
  
  // Production-ready RFQ tracking with graceful degradation
  const { 
    data: rfqTrackingRecords = [], 
    isLoading: isLoadingTracking,
    error: trackingError 
  } = useRfqTrackingRecords(projectId);
  const { 
    data: rfqStats = { totalSent: 0, totalResponded: 0, totalCompleted: 0, avgResponseTime: 0, recentActivity: 0 },
    error: statsError 
  } = useRfqTrackingStats(projectId);
  
  // Production-ready feature detection
  const trackingFeatureStatus = analyzeTrackingFeature(
    trackingError,
    statsError,
    rfqTrackingRecords.length > 0
  );
  
  const shouldShowTracking = trackingFeatureStatus.isEnabled && rfqTrackingRecords.length > 0;
  const shouldShowFeatureNotice = !trackingFeatureStatus.isEnabled;
  const featureStatusMessage = getFeatureStatusMessage(trackingFeatureStatus);
  
  // RFQ mutations and cache invalidation
  const createRfqMutation = useCreateRfq();
  const sendRfqMutation = useSendRfq();
  const createTrackingMutation = useCreateRfqTracking();
  const updateTrackingStatusMutation = useUpdateRfqTrackingStatus(projectId);
  const deleteTrackingMutation = useDeleteRfqTracking(projectId);
  const invalidateRfqTracking = useInvalidateRfqTracking();
  
  // Pre-populate part processes from existing process planning data
  useEffect(() => {
    if (processData?.records) {
      const processMap: Record<string, string[]> = {};
      
      processData.records.forEach((processRecord: any) => {
        const bomItemId = processRecord.bomItemId;
        const processName = processRecord.description || processRecord.operation || processRecord.processGroup || 'Unknown Process';
        
        if (bomItemId && processName && processName !== 'Unknown Process') {
          if (!processMap[bomItemId]) {
            processMap[bomItemId] = [];
          }
          // Only add if not already exists
          if (!processMap[bomItemId].includes(processName)) {
            processMap[bomItemId].push(processName);
          }
        }
      });
      
      // Update partProcesses state only if different
      setPartProcesses(prev => {
        const newProcesses = { ...prev, ...processMap };
        // Check if actually different before updating
        const isDifferent = Object.keys(processMap).some(key => {
          const existing = prev[key] || [];
          const newProc = newProcesses[key] || [];
          return JSON.stringify(existing.sort()) !== JSON.stringify(newProc.sort());
        });
        
        return isDifferent ? newProcesses : prev;
      });
    }
  }, [processData]);

  // Removed vendor rating functionality - can be added later in supplier nomination

  // Overview stats
  const stats = useMemo(() => ({
    totalParts: bomParts.length,
    activeVendors: vendors.length || 0,
    availableVendors: vendors.filter(v => v.status === 'active').length || 0,
    sentRfqCount: rfqStats?.totalSent || 0,
  }), [bomParts, vendors, rfqStats]);

  // Filter parts by search and category
  const filteredParts = useMemo(() => {
    let filtered = bomParts;
    
    if (partsSearchTerm) {
      const search = partsSearchTerm.toLowerCase();
      filtered = filtered.filter(part => {
        const partProcessesList = partProcesses[part.id] || [];
        const processMatch = partProcessesList.some(process => 
          process.toLowerCase().includes(search)
        );
        
        return part.partNumber.toLowerCase().includes(search) ||
               part.description.toLowerCase().includes(search) ||
               processMatch;
      });
    }

    return filtered;
  }, [bomParts, partsSearchTerm, partProcesses]);

// Filter vendors based on selected parts and their processes
  const matchedVendors = useMemo(() => {
    if (selectedParts.length === 0) {
      return [];
    }

    // Get all processes from selected parts
    const allRequiredProcesses = selectedParts.reduce<string[]>((acc, partId) => {
      const partProcessesList = partProcesses[partId] || [];
      return [...acc, ...partProcessesList];
    }, []);

    // Remove duplicates and convert to lowercase for matching
    const uniqueProcesses = [...new Set(allRequiredProcesses.map(p => p.toLowerCase()))];

    // If no processes are defined for any selected parts, return empty array
    if (uniqueProcesses.length === 0) {
      return [];
    }

    // Filter vendors that support ANY of the required processes
    const filteredVendors = vendors.filter(vendor => {
      // Handle vendor.process as array or string
      const vendorProcesses = Array.isArray(vendor.process) 
        ? vendor.process 
        : typeof vendor.process === 'string' 
          ? [vendor.process] 
          : [];

      if (vendorProcesses.length === 0) {
        // Don't include vendors without process data
        return false;
      }

      // Check if vendor supports any of the required processes
      const matches = vendorProcesses.some((vendorProcess: string) => {
        if (!vendorProcess || typeof vendorProcess !== 'string') return false;
        
        const vp = vendorProcess.toLowerCase().trim();
        return uniqueProcesses.some(reqProcess => {
          const reqProc = reqProcess.toLowerCase().trim();
          
          // Very strict matching - only exact matches and close equivalents
          
          // 1. Exact match
          if (vp === reqProc) return true;
          
          // 2. Handle specific equivalents only
          const processEquivalents: Record<string, string[]> = {
            'cnc milling': ['cnc machining', 'milling'],
            'cnc machining': ['cnc milling', 'milling'],
            'milling': ['cnc milling', 'cnc machining'],
            'drilling': ['cnc drilling', 'hole drilling'],
            'cnc drilling': ['drilling'],
            'forging': ['hot forging', 'cold forging'],
            'hot forging': ['forging'],
            'cold forging': ['forging'],
            'deep drawing': ['sheet metal forming', 'metal forming'],
            'sheet metal forming': ['deep drawing'],
            'metal forming': ['deep drawing'],
            'turning': ['cnc turning', 'lathe turning'],
            'cnc turning': ['turning'],
            'lathe turning': ['turning']
          };
          
          // Check if required process has specific equivalents that match vendor process
          const reqEquivalents = processEquivalents[reqProc] || [];
          if (reqEquivalents.includes(vp)) return true;
          
          // Check if vendor process has specific equivalents that match required process
          const vendorEquivalents = processEquivalents[vp] || [];
          if (vendorEquivalents.includes(reqProc)) return true;
          
          // No partial matching - must be exact or defined equivalent
          return false;
        });
      });

      return matches;
    });

    return filteredVendors;
  }, [selectedParts, partProcesses, vendors]);

const handlePartToggle = (partId: string, checked: boolean) => {
    setSelectedParts(prev =>
      checked ? [...prev, partId] : prev.filter(id => id !== partId)
    );
  };

  const handleVendorToggle = (vendorId: string, checked: boolean) => {
    setSelectedVendors(prev =>
      checked ? [...prev, vendorId] : prev.filter(id => id !== vendorId)
    );
  };

  const selectedVendorData = vendors.filter(v => selectedVendors.includes(v.id));

  // RFQ tracking action handlers
  const handleCancelRfq = async (trackingId: string) => {
    if (!confirm('Are you sure you want to cancel this RFQ? This action cannot be undone.')) {
      return;
    }
    
    try {
      await deleteTrackingMutation.mutateAsync(trackingId);
      toast.success('RFQ cancelled and removed from tracking');
    } catch (error) {
      toast.error('Failed to cancel RFQ. Please try again.');
    }
  };

  const handleDeleteEvaluationRfq = async (trackingId: string) => {
    if (!confirm('Are you sure you want to delete this RFQ under evaluation?\n\nThis will permanently remove the RFQ tracking record and all evaluation data. This action cannot be undone.')) {
      return;
    }
    
    try {
      await deleteTrackingMutation.mutateAsync(trackingId);
      toast.success('RFQ evaluation deleted and removed from tracking');
    } catch (error) {
      toast.error('Failed to delete RFQ evaluation. Please try again.');
    }
  };

  const handleApproveRfq = (trackingId: string, trackingVendors: any[]) => {
    setApproveModalOpen(trackingId);
    setSelectedApproveVendors(trackingVendors.map(v => v.id));
  };

  const handleConfirmApproval = async () => {
    if (!approveModalOpen) return;
    
    try {
      await updateTrackingStatusMutation.mutateAsync({
        trackingId: approveModalOpen,
        data: { status: RfqTrackingStatus.EVALUATED }
      });
      toast.success(`RFQ approved with ${selectedApproveVendors.length} selected vendor${selectedApproveVendors.length !== 1 ? 's' : ''}`);
      setApproveModalOpen(null);
      setSelectedApproveVendors([]);
      // Cache automatically updated by mutation
    } catch (error) {
      toast.error('Failed to approve RFQ');
    }
  };

  // RFQ sending functionality
  const handleSendRfq = async () => {
    // Prevent multiple submissions
    if (isSubmittingRfq || createRfqMutation.isPending || sendRfqMutation.isPending) {
      return;
    }

    try {
      setIsSubmittingRfq(true);

      // Ensure arrays are properly formatted
      const bomItemIds = Array.isArray(selectedParts) ? selectedParts : [];
      const vendorIds = Array.isArray(selectedVendors) ? selectedVendors : [];
      
      // Validation
      if (bomItemIds.length === 0) {
        setIsSubmittingRfq(false);
        return;
      }
      
      if (vendorIds.length === 0) {
        setIsSubmittingRfq(false);
        return;
      }

// Create RFQ with comprehensive details
      const rfqData = {
        rfqName: `RFQ for ${bomItemIds.length} Part${bomItemIds.length !== 1 ? 's' : ''}`,
        projectId: projectId,
        bomItemIds: bomItemIds,
        vendorIds: vendorIds,
        quoteDeadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days from now
        selectionType: 'competitive' as const,
        buyerName: 'Procurement Team',
        emailBody: `Dear Vendor,

We are pleased to invite you to submit a competitive quotation for the manufacturing of the listed components. 

Key Requirements:
• All parts must meet specified dimensional and material requirements
• Quality certifications required (ISO 9001 or equivalent)
• Technical drawings and 3D models are provided as attachments
• Please provide detailed breakdown of costs and lead times
• Include your standard terms and conditions

We look forward to your competitive proposal and establishing a successful partnership.`,
        emailSubject: `RFQ: Manufacturing Quotation Request - ${selectedParts.length} Components`
      };

      // Create the RFQ
      const createdRfq = await createRfqMutation.mutateAsync(rfqData);

      // Send the RFQ immediately
      await sendRfqMutation.mutateAsync(createdRfq.id);

      // Create tracking record so RFQ Tracking tab shows data
      const selectedBomParts = bomParts.filter(p => selectedParts.includes(p.id));
      await createTrackingMutation.mutateAsync({
        rfqId: createdRfq.id,
        projectId,
        rfqName: rfqData.rfqName,
        rfqNumber: createdRfq.rfqNumber,
        vendors: selectedVendorData.map(v => {
          const email = v.primaryContacts?.[0]?.email || v.companyEmail;
          return {
            id: v.id,
            name: v.name,
            ...(email !== undefined ? { email } : {}),
          };
        }),
        parts: selectedBomParts.map(p => ({
          id: p.id,
          partNumber: p.partNumber,
          description: p.description,
          process: p.process,
          quantity: p.quantity,
          ...(p.file2dPath !== undefined ? { file2dPath: p.file2dPath } : {}),
          ...(p.file3dPath !== undefined ? { file3dPath: p.file3dPath } : {}),
        })),
      });

      // Show success message
      toast.success(`RFQ sent successfully to ${vendorIds.length} vendor${vendorIds.length !== 1 ? 's' : ''} for ${bomItemIds.length} part${bomItemIds.length !== 1 ? 's' : ''}.`);
      
      // Reset selections
      setSelectedParts([]);
      setSelectedVendors([]);
      
      // Automatically switch to RFQ Tracking tab
      setActiveBomTab('rfq');
      
    } catch (error) {
      toast.error('Failed to send RFQ. Please try again.');
    } finally {
      setIsSubmittingRfq(false);
    }
  };

  // Helper function to extract filename from path
  const getFileName = (filePath: string): string => {
    if (!filePath) return '';
    
    // Extract filename from path
    const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || '';
    
    // If filename has timestamp prefix (like "1234567_originalname.ext"), remove it
    if (fileName.includes('_') && /^\d+_/.test(fileName)) {
      return fileName.substring(fileName.indexOf('_') + 1);
    }
    
    return fileName;
  };

  return (
    <div className="animate-fade-in">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start gap-3">
          {onBack && (
            <Button
              variant="outline"
              size="icon"
              className="mt-0.5 h-8 w-8 shrink-0"
              aria-label="Back to evaluation groups"
              onClick={onBack}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <PageHeader
              title={evaluationGroupName ? evaluationGroupName : 'Supplier Evaluation'}
              description={evaluationGroupName
                ? 'Evaluate vendors and manage RFQs for this evaluation group'
                : 'Select BOM parts to find and evaluate vendors'}
            >
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  aria-label="Search parts and vendors"
                  placeholder="Search parts, vendors..."
                  className="h-9 w-full pl-9 sm:w-72"
                  value={partsSearchTerm}
                  onChange={(e) => setPartsSearchTerm(e.target.value)}
                />
              </div>
            </PageHeader>
          </div>
        </div>

        {/* Overview Stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Total Parts', value: stats.totalParts, hint: 'From active BOM', icon: Package, hintTone: 'text-success' },
            { label: 'Active Vendors', value: stats.activeVendors, hint: 'Database managed vendors', icon: Building2, hintTone: 'text-muted-foreground' },
            { label: 'Available Vendors', value: stats.availableVendors, hint: 'Ready for RFQ', icon: Award, hintTone: 'text-success' },
            { label: 'RFQs Sent', value: stats.sentRfqCount, hint: 'Total sent today', icon: TrendingUp, hintTone: 'text-primary' },
          ].map(({ label, value, hint, icon: Icon, hintTone }) => (
            <Card key={label}>
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">{label}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">{value}</p>
                  <p className={`mt-0.5 truncate text-xs ${hintTone}`}>{hint}</p>
                </div>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Block 1: SELECT BOM PARTS */}
        <Card className="bg-card border-border">
          <CardContent className="p-0">
            <div className="p-6 border-b border-border">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-foreground">BOM Parts</h2>
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="text-primary border-primary/40">
                    {selectedParts.length} selected
                  </Badge>
                  {selectedParts.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedParts([]);
                        setSelectedVendors([]);
                      }}
                      className="h-7 text-xs border-border text-foreground/80 hover:border-destructive/50 hover:text-destructive"
                    >
                      Clear Selection
                    </Button>
                  )}
                </div>
              </div>
              
              <Tabs value={activeBomTab} onValueChange={setActiveBomTab} className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger
                    value="rfq"
                    className="text-sm"
                  >
                    RFQ Tracking
                  </TabsTrigger>
                  <TabsTrigger
                    value="overview"
                    className="text-sm"
                  >
                    BOM & Vendor
                  </TabsTrigger>
                  <TabsTrigger
                    value="cost-analysis"
                    className="text-sm"
                  >
                    Cost Analysis
                  </TabsTrigger>
                  <TabsTrigger
                    value="evaluation"
                    className="text-sm"
                  >
                    Supplier Analysis
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="overview" className="mt-0">

            {/* Parts Table */}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10"><span className="sr-only">Select</span></TableHead>
                    <TableHead>Part No.</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Process</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Files</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredParts.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={7} className="p-12 text-center">
                        <div className="text-muted-foreground">
                          <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                          <h3 className="font-medium mb-2 text-foreground">No BOM Parts Found</h3>
                          <p className="text-sm">
                            {bomParts.length === 0 
                              ? 'No BOM parts loaded for this project'
                              : `No parts match your current search "${partsSearchTerm}"`
                            }
                          </p>
                          {bomParts.length === 0 && (
                            <p className="text-xs mt-2 text-primary">
                              Check if BOM data is properly loaded from the project
                            </p>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredParts.map((part) => (
                    <TableRow key={part.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedParts.includes(part.id)}
                          onCheckedChange={(checked) => handlePartToggle(part.id, !!checked)}
                          className="border-border data-[state=checked]:bg-primary"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-foreground">{part.partNumber}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-foreground">{part.description}</div>
                        {part.price && (
                          <div className="text-sm text-primary font-medium">${part.price.toFixed(3)}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <ProcessEditor
                          partId={part.id}
                          processes={partProcesses[part.id] || []}
                          {...(processData ? { processData } : {})}
                          onProcessesChange={(processes) => {
                            setPartProcesses(prev => ({
                              ...prev,
                              [part.id]: processes
                            }));
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="text-foreground">{part.quantity} pcs</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {part.file2dPath && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onViewFile?.(part, '2d');
                              }}
                              className="flex items-center gap-1.5 text-xs text-primary hover:text-primary hover:bg-primary/10 px-2 py-1 rounded transition-colors text-left"
                              title="View 2D Drawing"
                            >
                              <FileText className="h-3 w-3 shrink-0" />
                              <span className="truncate max-w-[120px]">{getFileName(part.file2dPath)}</span>
                            </button>
                          )}
                          {part.file3dPath && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onViewFile?.(part, '3d');
                              }}
                              className="flex items-center gap-1.5 text-xs text-primary hover:text-primary hover:bg-primary/10 px-2 py-1 rounded transition-colors text-left"
                              title="View 3D Model"
                            >
                              <Box className="h-3 w-3 shrink-0" />
                              <span className="truncate max-w-[120px]">{getFileName(part.file3dPath)}</span>
                            </button>
                          )}
                          {!part.file2dPath && !part.file3dPath && (
                            <span className="text-xs text-muted-foreground">No files</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="p-4 border-t border-border bg-card/30 text-sm text-muted-foreground">
              Showing {filteredParts.length} of {bomParts.length} parts
            </div>

            {/* Vendor Selection - Only show when parts are selected */}
            {selectedParts.length > 0 && (
              <div className="mt-6">
                <div className="p-6 border-b border-border">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-foreground">Matched Vendors</h2>
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="text-primary border-primary/40">
                        {matchedVendors.length} available
                      </Badge>
                      <Badge variant="outline" className="text-primary border-primary/50">
                        {selectedVendors.length} selected
                      </Badge>
                    </div>
                  </div>
                  
                  {/* Show what processes we're searching for */}
                  {(() => {
                    const selectedProcesses = selectedParts.reduce<string[]>((acc, partId) => {
                      const processes = partProcesses[partId] || [];
                      return [...acc, ...processes];
                    }, []);
                    const uniqueProcesses = [...new Set(selectedProcesses)];
                    return uniqueProcesses.length > 0 ? (
                      <div className="mt-4">
                        <p className="text-xs text-muted-foreground mb-2">
                          Searching for vendors with processes from {selectedParts.length} selected part{selectedParts.length !== 1 ? 's' : ''}:
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {uniqueProcesses.map(process => (
                            <Badge key={process} variant="outline" className="text-xs border-warning/40 text-warning">
                              {process}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : null;
                  })()}
                </div>

                <div className="p-6">
                  {isLoadingVendors ? (
                    <ListSkeleton rows={4} label="Loading vendors..." />
                  ) : matchedVendors.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <h3 className="font-medium mb-2 text-foreground">No vendors matched</h3>
                      <p className="text-sm">
                        {vendors.length === 0 
                          ? 'No vendors found in database'
                          : (() => {
                              const selectedProcesses = selectedParts.reduce<string[]>((acc, partId) => {
                                return [...acc, ...(partProcesses[partId] || [])];
                              }, []);
                              const uniqueProcesses = [...new Set(selectedProcesses)];
                              
                              return uniqueProcesses.length === 0 
                                ? 'Selected parts have no processes defined. Please add processes to match vendors.'
                                : `No vendors found for processes: ${uniqueProcesses.join(', ')}. Try different processes or contact support to add vendors.`;
                            })()
                        }
                      </p>
                      {selectedParts.length > 0 && (
                        <p className="text-xs mt-2 text-primary">
                          Selected parts: {selectedParts.length} | Available vendors: {vendors.length}
                        </p>
                      )}
                    </div>
                  ) : (
                    <>
                      {selectedVendors.length > 0 && (
                        <div className="mb-4 flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">
                            {selectedVendors.length} vendor{selectedVendors.length !== 1 ? 's' : ''} selected
                          </span>
                          <Button
                            className="bg-primary hover:bg-primary/90 text-primary-foreground"
                            onClick={handleSendRfq}
                            disabled={isSubmittingRfq || createRfqMutation.isPending || sendRfqMutation.isPending}
                          >
                            {(isSubmittingRfq || createRfqMutation.isPending || sendRfqMutation.isPending) ? (
                              <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent" />
                            ) : (
                              <Send className="h-4 w-4 mr-2" />
                            )}
                            {(isSubmittingRfq || createRfqMutation.isPending || sendRfqMutation.isPending) ? 'Sending…' : 'Send RFQ'}
                          </Button>
                        </div>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {matchedVendors.map((vendor) => (
                          <div
                            key={vendor.id}
                            className={`border rounded-lg p-4 cursor-pointer transition-all ${
                              selectedVendors.includes(vendor.id)
                                ? 'border-primary bg-primary/10 shadow-xs'
                                : 'border-border hover:border-primary/50 hover:shadow-xs bg-card/50 hover:bg-accent'
                            }`}
                            onClick={() => handleVendorToggle(vendor.id, !selectedVendors.includes(vendor.id))}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <h3 className="font-semibold text-foreground mb-1">{vendor.name}</h3>
                                <VendorStatusBadge status={vendor.status} />
                              </div>
                              <div className="ml-2">
                                <Checkbox
                                  checked={selectedVendors.includes(vendor.id)}
                                  onChange={() => {}}
                                  className="border-border data-[state=checked]:bg-primary"
                                />
                              </div>
                            </div>

                            <div className="mt-3 space-y-2 text-sm text-foreground/80">
                              <div className="flex items-center gap-2">
                                <MapPin className="h-4 w-4 text-primary" />
                                <span>{vendor.city && vendor.state ? `${vendor.city}, ${vendor.state}` : 'Location TBD'}</span>
                              </div>
                            </div>

                            <div className="mt-3">
                              <div className="flex flex-wrap gap-1">
                                {vendor.process?.map((cap) => {
                                  // Check if this process is a match
                                  const selectedProcesses = selectedParts.reduce<string[]>((acc, partId) => {
                                    return [...acc, ...(partProcesses[partId] || [])];
                                  }, []);
                                  const uniqueProcesses = [...new Set(selectedProcesses.map(p => p.toLowerCase()))];
                                  
                                  const isMatch = uniqueProcesses.some(reqProcess => {
                                    const vp = cap.toLowerCase().trim();
                                    const reqProc = reqProcess.toLowerCase().trim();
                                    
                                    if (vp === reqProc) return true;
                                    
                                    const processEquivalents: Record<string, string[]> = {
                                      'cnc milling': ['cnc machining', 'milling'],
                                      'cnc machining': ['cnc milling', 'milling'],
                                      'milling': ['cnc milling', 'cnc machining'],
                                      'drilling': ['cnc drilling', 'hole drilling'],
                                      'cnc drilling': ['drilling'],
                                      'forging': ['hot forging', 'cold forging'],
                                      'hot forging': ['forging'],
                                      'cold forging': ['forging'],
                                      'deep drawing': ['sheet metal forming', 'metal forming'],
                                      'sheet metal forming': ['deep drawing'],
                                      'metal forming': ['deep drawing'],
                                      'turning': ['cnc turning', 'lathe turning'],
                                      'cnc turning': ['turning'],
                                      'lathe turning': ['turning']
                                    };
                                    
                                    const reqEquivalents = processEquivalents[reqProc] || [];
                                    if (reqEquivalents.includes(vp)) return true;
                                    
                                    const vendorEquivalents = processEquivalents[vp] || [];
                                    if (vendorEquivalents.includes(reqProc)) return true;
                                    
                                    return false;
                                  });
                                  
                                  return (
                                    <Badge
                                      key={cap}
                                      variant="outline"
                                      className={`text-xs ${isMatch 
                                        ? 'border-success/40 text-success bg-success/10' 
                                        : 'border-border text-foreground/80'
                                      }`}
                                    >
                                      {cap}
                                    </Badge>
                                  );
                                }) || <span className="text-xs text-muted-foreground">No processes</span>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                    </>
                  )}
                </div>
              </div>
            )}
                </TabsContent>

                <TabsContent value="cost-analysis" className="mt-0">
                  <div className="p-6">
                    <div className="text-center py-8 text-muted-foreground">
                      <div className="text-sm">Cost Analysis Feature</div>
                      <div className="text-xs mt-1">Cost analysis functionality will be implemented here</div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="rfq" className="mt-0">
                  {/* RFQ Tracking Summary */}
                  {shouldShowTracking ? (
                    <div className="p-6">
                      <div className="flex justify-between items-center mb-6">
                        <h3 className="text-xl font-semibold text-foreground">RFQ Tracking</h3>
                        <div className="flex gap-4 text-sm">
                          {rfqStats && (
                            <>
                              <div className="text-center">
                                <div className="text-lg font-bold text-primary">{rfqStats.totalSent}</div>
                                <div className="text-xs text-muted-foreground">Total Sent</div>
                              </div>
                              <div className="text-center">
                                <div className="text-lg font-bold text-success">{rfqStats.totalResponded}</div>
                                <div className="text-xs text-muted-foreground">Responded</div>
                              </div>
                              <div className="text-center">
                                <div className="text-lg font-bold text-primary">{formatResponseTime(rfqStats.avgResponseTime)}</div>
                                <div className="text-xs text-muted-foreground">Avg Response</div>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                      
                      <div className="space-y-4">
                        {rfqTrackingRecords.length === 0 && !isLoadingTracking ? (
                          <div className="text-center py-8 text-muted-foreground">
                            <div className="text-sm">No RFQ tracking records yet</div>
                            <div className="text-xs mt-1">Send your first RFQ to see tracking information here</div>
                          </div>
                        ) : (
                          rfqTrackingRecords.map((tracking) => (
                            <div key={tracking.id} className="bg-card rounded-lg p-4 border border-border">
                            <div className="flex justify-between items-start mb-4">
                              <div>
                                <h4 className="font-medium text-foreground">{tracking.rfqName}</h4>
                                <p className="text-sm text-muted-foreground mt-1">
                                  {getRfqSummaryText(tracking)}
                                </p>
                                <p className="text-xs text-muted-foreground mt-2">
                                  RFQ #{tracking.rfqNumber} • Sent {new Date(tracking.sentAt).toLocaleString()}
                                </p>
                              </div>
                              <div className="flex items-center gap-3">
                                <Badge 
                                  className={`bg-${getStatusColor(tracking.status)}-600 text-foreground`}
                                >
                                  {getStatusText(tracking.status)}
                                </Badge>
                                
                                {/* Action Buttons */}
                                {tracking.status === 'sent' && (
                                  <div className="flex gap-2">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleCancelRfq(tracking.id)}
                                      disabled={deleteTrackingMutation.isPending}
                                      className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    >
                                      <X className="h-3 w-3 mr-1" />
                                      Cancel
                                    </Button>
                                    <Button
                                      variant="outline" 
                                      size="sm"
                                      onClick={() => handleApproveRfq(tracking.id, tracking.vendors)}
                                      disabled={updateTrackingStatusMutation.isPending}
                                      className="border-success/50 text-success hover:bg-success/10 hover:text-success"
                                    >
                                      <Check className="h-3 w-3 mr-1" />
                                      Approve
                                    </Button>
                                  </div>
                                )}
                                
                                {/* Delete button for RFQs under evaluation */}
                                {tracking.status === 'evaluated' && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleDeleteEvaluationRfq(tracking.id)}
                                    disabled={deleteTrackingMutation.isPending}
                                    className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                  >
                                    <Trash2 className="h-3 w-3 mr-1" />
                                    Delete
                                  </Button>
                                )}
                              </div>
                            </div>
                            
                            {/* Detailed Information */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {/* Vendors */}
                              <div>
                                <h5 className="text-sm font-medium text-foreground/80 mb-2 flex items-center gap-1">
                                  <Building2 className="h-4 w-4" />
                                  Vendors ({tracking.vendorCount})
                                </h5>
                                <div className="space-y-2">
                                  {tracking.vendors.map((vendor) => (
                                    <div key={vendor.id} className="bg-muted rounded p-2 text-xs">
                                      <div className="flex justify-between items-start">
                                        <div className="flex-1">
                                          <div className="text-foreground font-medium">{vendor.name}</div>
                                          {vendor.email && (
                                            <div className="text-muted-foreground flex items-center gap-1 mt-1">
                                              <Mail className="h-3 w-3" />
                                              {vendor.email}
                                            </div>
                                          )}
                                        </div>
                                        <div className="ml-2">
                                          {vendor.responded ? (
                                            <div className="text-success text-xs">
                                              <div><Mark kind="ok" /> Responded</div>
                                              {vendor.quoteAmount && (
                                                <div>${vendor.quoteAmount}</div>
                                              )}
                                              {vendor.leadTimeDays && (
                                                <div>{vendor.leadTimeDays} days</div>
                                              )}
                                            </div>
                                          ) : (
                                            <div className="text-muted-foreground text-xs">Pending</div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              
                              {/* Parts */}
                              <div>
                                <h5 className="text-sm font-medium text-foreground/80 mb-2 flex items-center gap-1">
                                  <Package className="h-4 w-4" />
                                  Parts ({tracking.partCount})
                                </h5>
                                <div className="space-y-2">
                                  {tracking.parts.map((part) => (
                                    <div key={part.id} className="bg-muted rounded p-2 text-xs">
                                      <div className="text-foreground font-medium">{part.partNumber}</div>
                                      <div className="text-muted-foreground mt-1">{part.description}</div>
                                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                                        <span className="text-xs text-muted-foreground">Qty: {part.quantity}</span>
                                        {(partProcesses[part.id] || []).map((process, index) => (
                                          <Badge key={index} variant="outline" className="text-xs border-primary/40 text-primary">
                                            {process}
                                          </Badge>
                                        ))}
                                        {part.has2dFile && (
                                          <Badge variant="outline" className="text-xs border-success/50 text-success">
                                            2D
                                          </Badge>
                                        )}
                                        {part.has3dFile && (
                                          <Badge variant="outline" className="text-xs border-primary/40 text-primary">
                                            3D
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                            
                            {/* Response Summary */}
                            {tracking.responseCount > 0 && (
                              <div className="mt-4 pt-4 border-t border-border">
                                <div className="flex justify-between text-sm">
                                  <div className="text-foreground/80">
                                    Response Rate: <span className="text-success font-medium">{Math.round((tracking.responseCount / tracking.vendorCount) * 100)}%</span>
                                  </div>
                                  {tracking.firstResponseAt && (
                                    <div className="text-muted-foreground">
                                      First response: {new Date(tracking.firstResponseAt).toLocaleDateString()}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                            </div>
                          ))
                        )}
                      </div>
                      
                      {isLoadingTracking && (
                        <ListSkeleton rows={2} label="Loading RFQ tracking data..." />
                      )}
                    </div>
                  ) : (
                    <div className="p-6">
                      <div className="text-center py-8 text-muted-foreground">
                        <Send className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <div className="text-sm">No RFQ tracking available</div>
                        <div className="text-xs mt-1">Go to BOM & Vendor tab, select parts and vendors, then click Send RFQ</div>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="evaluation" className="mt-0">
                  <div className="p-6">
                    <h3 className="text-lg font-semibold text-foreground mb-4">Vendor Rating Analysis</h3>
                    
                    {/* Vendor Selection for Rating */}
                    {matchedVendors.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <div className="text-sm">Select BOM parts first to see matched vendors for rating</div>
                        <div className="text-xs mt-1">Go to BOM & Vendor tab to select parts and vendors</div>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        <div className="bg-card rounded-lg p-4 border border-border">
                          <h4 className="text-md font-medium text-foreground mb-3">Select Vendor to Rate</h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {matchedVendors.map((vendor) => (
                              <div
                                key={vendor.id}
                                className={`border rounded-lg p-3 cursor-pointer transition-all ${
                                  selectedVendorForRating === vendor.id
                                    ? 'border-primary/40 bg-primary/10 shadow-md'
                                    : 'border-border hover:border-primary/50 bg-card/50'
                                }`}
                                onClick={() => setSelectedVendorForRating(vendor.id)}
                              >
                                <div className="font-medium text-foreground">{vendor.name}</div>
                                <div className="text-sm text-muted-foreground mt-1">{vendor.city && vendor.state ? `${vendor.city}, ${vendor.state}` : 'Location TBD'}</div>
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {vendor.process?.slice(0, 2).map((proc) => (
                                    <Badge key={proc} variant="outline" className="text-xs border-border text-foreground/80">
                                      {proc}
                                    </Badge>
                                  ))}
                                  {vendor.process && vendor.process.length > 2 && (
                                    <Badge variant="outline" className="text-xs border-border text-foreground/80">
                                      +{vendor.process.length - 2}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Vendor Rating Engine */}
                        {selectedVendorForRating && (() => {
                          const selectedVendorName = matchedVendors.find(v => v.id === selectedVendorForRating)?.name;
                          return (
                          <div className="bg-card rounded-lg border border-border">
                            {supplierNominations && supplierNominations.length > 0 && supplierNominations[0] ? (
                              <VendorRatingEngine
                                vendorId={selectedVendorForRating}
                                {...(selectedVendorName !== undefined ? { vendorName: selectedVendorName } : {})}
                                nominationId={supplierNominations[0].id} // Use the first supplier nomination
                                onScoreUpdate={(_scores) => {
                                  // Optional: Handle score updates
                                }}
                              />
                            ) : isLoadingNominations ? (
                              <ListSkeleton rows={3} label="Loading nomination data..." className="p-6" />
                            ) : (
                              <div className="p-6 text-center">
                                <div className="text-muted-foreground mb-4">
                                  <div className="text-lg font-medium">No Supplier Nomination Found</div>
                                  <div className="text-sm mt-2">
                                    A supplier nomination evaluation is required to rate vendors. 
                                    Please create one first in the Supplier Nomination module.
                                  </div>
                                </div>
                                <Button 
                                  variant="outline"
                                  onClick={() => window.open(`/projects/${projectId}/supplier-nomination`, '_blank')}
                                  className="border-primary/40 text-primary hover:bg-primary/10"
                                >
                                  Create Supplier Nomination
                                </Button>
                              </div>
                            )}
                          </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </TabsContent>

              </Tabs>
            </div>
          </CardContent>
        </Card>

{/* Block 3: REVIEW & SEND RFQ - Only show when vendors are selected */}
        {selectedVendors.length > 0 && (
          <Card className="bg-card border-border">
            <CardContent className="p-0">
              <div className="p-6 border-b border-border">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-foreground">RFQ Summary</h2>
                  <Badge variant="outline" className="text-success border-success/40">
                    {selectedVendors.length} vendor{selectedVendors.length !== 1 ? 's' : ''} ready
                  </Badge>
                </div>
              </div>

              <div className="p-6">
                {selectedVendorData.map((vendor) => (
                  <div key={vendor.id} className="bg-card/50 rounded-lg p-4 mb-4 last:mb-0 border border-border">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="p-2 rounded bg-primary/10">
                            <Building2 className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-foreground">{vendor.name}</h3>
                            <p className="text-sm text-muted-foreground">{vendor.supplierCode || 'No supplier code'}</p>
                          </div>
                          <Badge className="ml-auto bg-success text-success-foreground">
                            {vendor.status}
                          </Badge>
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <h4 className="font-medium text-foreground mb-1">CONTACT</h4>
                            <div className="text-foreground/80 space-y-1">
                              <div>{vendor.primaryContacts?.[0]?.name || 'Contact not available'}</div>
                              <div>{vendor.primaryContacts?.[0]?.email || vendor.companyEmail || 'Email not available'}</div>
                              <div>{vendor.primaryContacts?.[0]?.phone || vendor.companyPhone || 'Phone not available'}</div>
                            </div>
                          </div>
                          <div>
                            <h4 className="font-medium text-foreground mb-1">CAPABILITIES</h4>
                            <div className="flex flex-wrap gap-1">
                              {vendor.process?.map((cap) => (
                                <Badge key={cap} className="bg-primary text-primary-foreground text-xs">
                                  {cap}
                                </Badge>
                              )) || <span className="text-xs text-muted-foreground">No capabilities listed</span>}
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-4 text-sm">
                          <div>
                            <div className="text-muted-foreground">Certifications</div>
                            <div className="text-xs space-x-2">
                              {vendor.certifications?.map((cert) => (
                                <Badge key={cert} variant="outline" className="text-xs border-border text-foreground/80">
                                  {cert}
                                </Badge>
                              )) || <span className="text-xs text-muted-foreground">None listed</span>}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="ml-6 text-right">
                        <div className="text-2xl font-bold text-primary">Ready</div>
                        <div className="text-sm text-muted-foreground">{vendor.city && vendor.state ? `${vendor.city}, ${vendor.state}` : 'Location TBD'}</div>
                      </div>
                    </div>
                  </div>
                ))}

                <div className="mt-6 flex justify-end">
                  <Button 
                    className="bg-primary hover:bg-primary/90 text-primary-foreground px-8"
                    onClick={handleSendRfq}
                    disabled={isSubmittingRfq || createRfqMutation.isPending || sendRfqMutation.isPending}
                  >
                    {(isSubmittingRfq || createRfqMutation.isPending || sendRfqMutation.isPending) ? (
                      <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    {(isSubmittingRfq || createRfqMutation.isPending || sendRfqMutation.isPending) ? 'Sending RFQ...' : 'Send RFQ'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        
        {/* Production Feature Status Notice */}
        {shouldShowFeatureNotice && (
          <Card className={`mt-6 ${
            trackingFeatureStatus.state === TrackingFeatureState.MIGRATION_REQUIRED 
              ? 'bg-warning/10 border-warning/40' 
              : trackingFeatureStatus.state === TrackingFeatureState.ERROR
              ? 'bg-destructive/10 border-destructive/40'
              : 'bg-card/50 border-border/50'
          }`}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${
                    trackingFeatureStatus.state === TrackingFeatureState.MIGRATION_REQUIRED 
                      ? 'bg-warning/15' 
                      : trackingFeatureStatus.state === TrackingFeatureState.ERROR
                      ? 'bg-destructive/15'
                      : 'bg-muted-foreground/20'
                  }`}>
                    <Package className={`h-5 w-5 ${
                      trackingFeatureStatus.state === TrackingFeatureState.MIGRATION_REQUIRED 
                        ? 'text-warning' 
                        : trackingFeatureStatus.state === TrackingFeatureState.ERROR
                        ? 'text-destructive'
                        : 'text-muted-foreground'
                    }`} />
                  </div>
                  <div>
                    <h3 className={`text-lg font-semibold ${
                      trackingFeatureStatus.state === TrackingFeatureState.MIGRATION_REQUIRED 
                        ? 'text-warning' 
                        : trackingFeatureStatus.state === TrackingFeatureState.ERROR
                        ? 'text-destructive'
                        : 'text-foreground/80'
                    }`}>
                      {featureStatusMessage.title}
                    </h3>
                    <p className={`text-sm mt-1 ${
                      trackingFeatureStatus.state === TrackingFeatureState.MIGRATION_REQUIRED 
                        ? 'text-warning' 
                        : trackingFeatureStatus.state === TrackingFeatureState.ERROR
                        ? 'text-destructive'
                        : 'text-foreground/80'
                    }`}>
                      {featureStatusMessage.description}
                    </p>
                    {trackingFeatureStatus.state === TrackingFeatureState.MIGRATION_REQUIRED && (
                      <p className="text-warning text-xs mt-2">
                        Your RFQs are being sent successfully! Tracking will be available after migration.
                      </p>
                    )}
                  </div>
                </div>
                {featureStatusMessage.actionText && trackingFeatureStatus.canRetry && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      invalidateRfqTracking();
                      window.location.reload();
                    }}
                    className={`${
                      trackingFeatureStatus.state === TrackingFeatureState.MIGRATION_REQUIRED 
                        ? 'border-warning/50 text-warning hover:bg-warning/10'
                        : trackingFeatureStatus.state === TrackingFeatureState.ERROR
                        ? 'border-destructive/50 text-destructive hover:bg-destructive/10'
                        : 'border-border text-foreground/80 hover:bg-accent/10'
                    }`}
                  >
                    {featureStatusMessage.actionText}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Approve Vendor Selection Modal */}
        {approveModalOpen && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
            <Card className="bg-card border-border w-full max-w-2xl max-h-[80vh] overflow-hidden">
              <CardContent className="p-0">
                <div className="p-6 border-b border-border">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                      <UserCheck className="h-5 w-5 text-success" />
                      Approve RFQ - Select Vendors
                    </h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setApproveModalOpen(null);
                        setSelectedApproveVendors([]);
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">
                    Select which vendors you want to proceed with for this RFQ
                  </p>
                </div>

                <div className="p-6 max-h-96 overflow-y-auto">
                  {(() => {
                    const currentTracking = rfqTrackingRecords.find(t => t.id === approveModalOpen);
                    return currentTracking?.vendors.map((vendor) => (
                      <div
                        key={vendor.id}
                        className={`border rounded-lg p-4 mb-3 cursor-pointer transition-all ${
                          selectedApproveVendors.includes(vendor.id)
                            ? 'border-success bg-success/10'
                            : 'border-border hover:border-success/50 bg-card/50'
                        }`}
                        onClick={() => {
                          setSelectedApproveVendors(prev =>
                            prev.includes(vendor.id)
                              ? prev.filter(id => id !== vendor.id)
                              : [...prev, vendor.id]
                          );
                        }}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2">
                                <Checkbox
                                  checked={selectedApproveVendors.includes(vendor.id)}
                                  onChange={() => {}} // Controlled by parent click
                                  className="border-border data-[state=checked]:bg-success"
                                />
                                <h4 className="font-medium text-foreground">{vendor.name}</h4>
                              </div>
                              {vendor.responded && (
                                <Badge className="bg-success text-success-foreground text-xs">
                                  Responded
                                </Badge>
                              )}
                            </div>
                            
                            {vendor.email && (
                              <div className="text-sm text-muted-foreground flex items-center gap-1 mt-2">
                                <Mail className="h-3 w-3" />
                                {vendor.email}
                              </div>
                            )}
                            
                            {vendor.responded && (vendor.quoteAmount || vendor.leadTimeDays) && (
                              <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
                                {vendor.quoteAmount && (
                                  <div>
                                    <div className="text-muted-foreground">Quote Amount</div>
                                    <div className="font-medium text-success">${vendor.quoteAmount}</div>
                                  </div>
                                )}
                                {vendor.leadTimeDays && (
                                  <div>
                                    <div className="text-muted-foreground">Lead Time</div>
                                    <div className="font-medium text-primary">{vendor.leadTimeDays} days</div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {selectedApproveVendors.includes(vendor.id) && (
                            <div className="w-5 h-5 rounded-full bg-success flex items-center justify-center ml-3">
                              <Check className="w-3 h-3 text-white" />
                            </div>
                          )}
                        </div>
                      </div>
                    ));
                  })()}
                </div>

                <div className="p-6 border-t border-border">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                      {selectedApproveVendors.length} vendor{selectedApproveVendors.length !== 1 ? 's' : ''} selected
                    </div>
                    <div className="flex gap-3">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setApproveModalOpen(null);
                          setSelectedApproveVendors([]);
                        }}
                        className="border-border text-foreground/80"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleConfirmApproval}
                        disabled={selectedApproveVendors.length === 0 || updateTrackingStatusMutation.isPending}
                        className="bg-success hover:bg-success/90 text-success-foreground"
                      >
                        {updateTrackingStatusMutation.isPending ? (
                          <>
                            <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent" />
                            Approving...
                          </>
                        ) : (
                          <>
                            <Check className="h-4 w-4 mr-2" />
                            Approve Selected
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

    </div>
  );
}

// Process Editor Component for editable multi-process selection
interface ProcessEditorProps {
  partId: string;
  processes: string[];
  onProcessesChange: (processes: string[]) => void;
  processData?: ProcessCostListResponse; // Process planning data from useProcessCosts
}

function ProcessEditor({ partId, processes, onProcessesChange, processData }: ProcessEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');

  // Fetch processes from API
  const { data: processesResponse, isLoading: isLoadingProcesses } = useProcesses();
  const apiProcesses = processesResponse?.processes || [];

  // Get process planning data from parent component via props
  // We'll get the processData that was already fetched at the parent level

  // Get existing processes for this specific part
  const partSpecificProcesses = React.useMemo(() => {
    if (!processData?.records) return [];

    const partRecords = processData.records.filter((record: ProcessCostRecord) => record.bomItemId === partId);
    const processNames = partRecords
      .map((record: ProcessCostRecord) => record.description || record.operation || record.processGroup)
      .filter((name): name is string => !!name && name !== 'Unknown Process');

    return Array.from(new Set(processNames));
  }, [processData, partId]);

  // Combine all available processes from both sources
  const allAvailableProcesses = React.useMemo(() => {
    const processSet = new Set<string>();
    
    // Add processes from API
    apiProcesses.forEach(process => {
      if (process.processName) {
        processSet.add(process.processName);
      }
    });
    
    // Add processes from existing process planning data (all parts)
    if (processData?.records) {
      processData.records.forEach((record: ProcessCostRecord) => {
        const processName = record.description || record.operation || record.processGroup;
        if (processName && processName !== 'Unknown Process') {
          processSet.add(processName);
        }
      });
    }
    
    return Array.from(processSet).sort();
  }, [apiProcesses, processData]);

  // Filter suggestions based on input with fuzzy matching
  const getSuggestions = (input: string) => {
    // If no input, show first 8 processes
    if (!input.trim()) return allAvailableProcesses.slice(0, 8);
    
    const searchTerm = input.toLowerCase();
    
    // First try to find matches for the search term
    const matches = allAvailableProcesses.filter(process => {
      const processLower = process.toLowerCase();
      // Exact match, starts with, or contains
      return processLower === searchTerm || 
             processLower.startsWith(searchTerm) || 
             processLower.includes(searchTerm);
    });
    
    // If we have matches, return them sorted by relevance
    if (matches.length > 0) {
      return matches.sort((a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        
        if (aLower === searchTerm) return -1;
        if (bLower === searchTerm) return 1;
        if (aLower.startsWith(searchTerm)) return -1;
        if (bLower.startsWith(searchTerm)) return 1;
        return a.localeCompare(b);
      }).slice(0, 8);
    }
    
    // If no matches found, show all processes so user can see what's available
    return allAvailableProcesses.slice(0, 12);
  };

  const addProcess = (process: string) => {
    if (process.trim() && !processes.includes(process.trim())) {
      onProcessesChange([...processes, process.trim()]);
    }
    setInputValue('');
  };

  const removeProcess = (processToRemove: string) => {
    onProcessesChange(processes.filter(p => p !== processToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault();
      addProcess(inputValue);
    }
  };

  return (
    <div className="min-w-[200px]">
      {/* Display processes */}
      <div className="flex flex-wrap gap-1 mb-2">
        {processes.map((process, index) => (
          <Badge
            key={index}
            variant="outline"
            className="border-primary/40 text-primary text-xs px-2 py-1 cursor-pointer hover:bg-primary/10"
            onClick={() => removeProcess(process)}
          >
            {process}
            <X className="h-3 w-3 ml-1" />
          </Badge>
        ))}
        
        {processes.length === 0 && (
          <span className="text-muted-foreground text-xs">No processes</span>
        )}
      </div>

      {/* Add process section */}
      {isEditing ? (
        <div className="space-y-2">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type process name..."
            className="h-7 text-xs bg-card border-border text-foreground"
            autoFocus
          />
          
          {/* Quick select from intelligent suggestions */}
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {isLoadingProcesses ? (
              <span className="text-xs text-muted-foreground">Loading processes...</span>
            ) : (
              <>
                {/* Show part-specific processes first if available */}
                {partSpecificProcesses.length > 0 && (
                  <div>
                    <p className="text-xs text-primary mb-1">From this part's process planning:</p>
                    <div className="flex flex-wrap gap-1">
                      {partSpecificProcesses
                        .filter(p => !processes.includes(p))
                        .filter(p => !inputValue || p.toLowerCase().includes(inputValue.toLowerCase()))
                        .map((process) => (
                          <Badge
                            key={process}
                            variant="outline"
                            className="border-primary/40 text-primary text-xs cursor-pointer bg-primary/10"
                            onClick={() => addProcess(process)}
                          >
                            {process}
                          </Badge>
                        ))}
                    </div>
                  </div>
                )}
                
                {/* Show other available processes */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    {partSpecificProcesses.length > 0 ? 'Other available processes:' : 'Available processes:'}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {getSuggestions(inputValue)
                      .filter(p => !processes.includes(p))
                      .filter(p => !partSpecificProcesses.includes(p)) // Don't duplicate part-specific processes
                      .slice(0, 12)
                      .map((process) => (
                        <Badge
                          key={process}
                          variant="outline"
                          className="border-border text-foreground/80 text-xs cursor-pointer"
                          onClick={() => addProcess(process)}
                        >
                          {process}
                        </Badge>
                      ))}
                  </div>
                </div>
              </>
            )}
            {!isLoadingProcesses && allAvailableProcesses.length === 0 && (
              <span className="text-xs text-muted-foreground">No processes available</span>
            )}
          </div>

          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-xs"
              onClick={() => {
                if (inputValue.trim()) addProcess(inputValue);
                setIsEditing(false);
              }}
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs"
              onClick={() => {
                setIsEditing(false);
                setInputValue('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-xs border-border text-foreground/80 hover:border-primary/40 hover:text-primary"
          onClick={() => setIsEditing(true)}
        >
          <Plus className="h-3 w-3 mr-1" />
          Add Process
        </Button>
      )}
    </div>
  );
}