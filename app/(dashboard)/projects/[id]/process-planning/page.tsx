'use client';

// Updated: Fixed functional navigation and Quick Actions - Version 3.0
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useBOMs } from '@/lib/api/hooks/useBOM';
import { useBOMItems } from '@/lib/api/hooks/useBOMItems';
import { ModelViewer } from '@/components/ui/model-viewer';
import { Viewer2D } from '@/components/ui/viewer-2d';
import { apiClient } from '@/lib/api/client';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, TrendingUp, DollarSign, Package, Cog, PieChart, BarChart3, Target, Calculator, FileDown } from 'lucide-react';

// Reset circuit breaker on page load if it's stuck
if (typeof window !== 'undefined') {
  try {
    apiClient.resetCircuitBreaker();
  } catch (error) {
    // Could not reset circuit breaker
  }
}
import { BOMSelectionCard } from '@/components/features/process-planning/BOMSelectionCard';
import { RawMaterialsSection } from '@/components/features/process-planning/RawMaterialsSection';
import { ManufacturingProcessSection } from '@/components/features/process-planning/ManufacturingProcessSection';
import { PackagingLogisticsSection } from '@/components/features/process-planning/PackagingLogisticsSection';
import { ProcuredPartsSection } from '@/components/features/process-planning/ProcuredPartsSection';
import { BomCostReport } from '@/components/features/process-planning/BomCostReport';
import { ProjectBomCostSummary } from '@/components/features/process-planning/ProjectBomCostSummary';
import { CostDataProvider, useCostData } from '@/lib/providers/cost-data-provider';
import { costEngine } from '@/lib/services/cost-engine';
import { CostAnalysisEngine } from '@/components/features/cost-analysis/CostAnalysisEngine';
import { BomCostReportWrapper } from '@/components/features/cost-analysis/BomCostReportWrapper';
import { WorkflowNavigation } from '@/components/features/workflow/WorkflowNavigation';

// Chart components - using a simple chart implementation
const CustomPieChart = ({ data, colors }: { data: any[], colors: string[] }) => {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  let currentAngle = 0;
  
  return (
    <div className="relative w-48 h-48 mx-auto">
      <svg width="192" height="192" className="transform -rotate-90">
        {data.map((item, index) => {
          const percentage = item.value / total;
          const angle = percentage * 360;
          const startAngle = currentAngle;
          const endAngle = currentAngle + angle;
          
          const startX = 96 + 80 * Math.cos((startAngle - 90) * Math.PI / 180);
          const startY = 96 + 80 * Math.sin((startAngle - 90) * Math.PI / 180);
          const endX = 96 + 80 * Math.cos((endAngle - 90) * Math.PI / 180);
          const endY = 96 + 80 * Math.sin((endAngle - 90) * Math.PI / 180);
          
          const largeArcFlag = angle > 180 ? 1 : 0;
          
          const pathData = [
            `M 96 96`,
            `L ${startX} ${startY}`,
            `A 80 80 0 ${largeArcFlag} 1 ${endX} ${endY}`,
            'Z'
          ].join(' ');
          
          currentAngle += angle;
          
          return (
            <path
              key={index}
              d={pathData}
              fill={colors[index % colors.length]}
              className="hover:opacity-80 transition-opacity"
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-bold">₹{total.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Total</p>
        </div>
      </div>
    </div>
  );
};

const CustomBarChart = ({ data, colors }: { data: any[], colors: string[] }) => {
  const maxValue = Math.max(...data.map(item => item.value));
  
  return (
    <div className="space-y-3">
      {data.map((item, index) => (
        <div key={index} className="flex items-center gap-3">
          <div className="w-24 text-xs font-medium truncate">{item.name}</div>
          <div className="flex-1 relative">
            <div className="bg-muted rounded-full h-6 relative overflow-hidden">
              <div 
                className="h-full rounded-full transition-all duration-300 flex items-center justify-end pr-2"
                style={{ 
                  width: `${(item.value / maxValue) * 100}%`,
                  backgroundColor: colors[index % colors.length]
                }}
              >
                <span className="text-xs font-medium text-white">
                  ₹{item.value.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
          <div className="w-16 text-xs text-right">
            {((item.value / maxValue) * 100).toFixed(1)}%
          </div>
        </div>
      ))}
    </div>
  );
};

function ProcessPlanningPageContent() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const [selectedBomId, setSelectedBomId] = useState<string>('');
  const [selectedPartNumber, setSelectedPartNumber] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [file3dUrl, setFile3dUrl] = useState<string | null>(null);
  const [file2dUrl, setFile2dUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');

  // Edit mode states for part details
  const [isEditingPartDetails, setIsEditingPartDetails] = useState(false);
  const [editablePartData, setEditablePartData] = useState({
    partNumber: '',
    name: '',
    description: '',
    itemType: 'child_part',
    material: '',
    quantity: '',
    unit: '',
    annualVolume: '',
    unitWeight: '',
    unitCost: '',
    length: '',
    width: '',
    height: '',
    toleranceGrade: 'IT8',
    surfaceFinish: 'Ra 3.2 μm',
    heatTreatment: 'As Required',
    hardness: '',
    leadTime: '15-20',
    revision: 'Rev A',
    qualityStandard: 'ISO 9001:2015',
    inspectionLevel: 'Level II',
  });

const handleModelMeasurements = (_data: any) => {
    
  };

  // Fetch data with loading and error states - force fresh data with higher limit
  const { data: bomsData, isLoading: bomsLoading, error: bomsError, refetch: refetchBOMs } = useBOMs({ 
    projectId,
    limit: 50,  // Increase limit to ensure we get all BOMs
    page: 1     // Ensure we start from page 1
  });
  const boms = bomsData?.boms || [];
  

  // Force refetch on mount to ensure fresh data
  useEffect(() => {
    // Clear any cached queries and refetch
    refetchBOMs();
  }, [projectId, refetchBOMs]);

  const { data: bomItemsData, isLoading: bomItemsLoading, error: bomItemsError } = useBOMItems(selectedBomId);
  const bomItems = bomItemsData?.items || [];
  const selectedItem = bomItems.find((item) => item.partNumber === selectedPartNumber);

  // Clear measurements when item changes and initialize editable data
  useEffect(() => {
    // Clear measurements/cache when item changes
    if (selectedItem) {
      setEditablePartData({
        partNumber: String(selectedItem.partNumber || selectedItem.id || ''),
        name: String(selectedItem.name || ''),
        description: String(selectedItem.description || ''),
        itemType: String(selectedItem.itemType || 'child_part'),
        material: String(selectedItem.material || selectedItem.materialGrade || ''),
        quantity: String(selectedItem.quantity || ''),
        unit: String(selectedItem.unit || ''),
        annualVolume: String(selectedItem.annualVolume || ''),
        unitWeight: String(selectedItem.unitWeight || ''),
        unitCost: String(selectedItem.unitCost || ''),
        length: String(selectedItem.length || ''),
        width: String(selectedItem.width || ''),
        height: String(selectedItem.height || ''),
        toleranceGrade: String(selectedItem.toleranceGrade || 'IT8'),
        surfaceFinish: String(selectedItem.surfaceFinish || 'Ra 3.2 μm'),
        heatTreatment: String(selectedItem.heatTreatment || 'As Required'),
        hardness: String(selectedItem.hardness || ''),
        leadTime: String(selectedItem.leadTime || '15-20'),
        revision: String(selectedItem.revision || 'Rev A'),
        qualityStandard: String(selectedItem.qualityStandard || 'ISO 9001:2015'),
        inspectionLevel: String(selectedItem.inspectionLevel || 'Level II'),
      });
    } else {
      // Initialize with empty strings if no item is selected
      setEditablePartData({
        partNumber: '',
        name: '',
        description: '',
        itemType: 'child_part',
        material: '',
        quantity: '',
        unit: '',
        annualVolume: '',
        unitWeight: '',
        unitCost: '',
        length: '',
        width: '',
        height: '',
        toleranceGrade: 'IT8',
        surfaceFinish: 'Ra 3.2 μm',
        heatTreatment: 'As Required',
        hardness: '',
        leadTime: '15-20',
        revision: 'Rev A',
        qualityStandard: 'ISO 9001:2015',
        inspectionLevel: 'Level II',
      });
    }
  }, [selectedItem?.id]);

  const handleBomChange = (bomId: string) => {
    setSelectedBomId(bomId);
    setSelectedPartNumber('');
    setSearchTerm('');
    setStatusFilter('all');
    setTypeFilter('all');
  };

// Quick Action handlers

// Navigation handlers
  const tabs = ['overview', 'process', 'costing'];
  const currentTabIndex = tabs.indexOf(activeTab);

  const handlePrevious = () => {
    if (currentTabIndex > 0) {
      const prevTab = tabs[currentTabIndex - 1];
      if (prevTab) setActiveTab(prevTab);
    }
  };

  const handleNext = () => {
    if (currentTabIndex < tabs.length - 1) {
      const nextTab = tabs[currentTabIndex + 1];
      if (nextTab) setActiveTab(nextTab);
    }
  };

  // Handlers for part details editing
  const handleEditPartDetails = () => {
    setIsEditingPartDetails(true);
  };

  const handleSavePartDetails = () => {
    
    setIsEditingPartDetails(false);
    // Here you would typically call an API to update the BOM item
  };

  const handleCancelEdit = () => {
    if (selectedItem) {
      setEditablePartData({
        partNumber: String(selectedItem.partNumber || selectedItem.id || ''),
        name: String(selectedItem.name || ''),
        description: String(selectedItem.description || ''),
        itemType: String(selectedItem.itemType || 'child_part'),
        material: String(selectedItem.material || selectedItem.materialGrade || ''),
        quantity: String(selectedItem.quantity || ''),
        unit: String(selectedItem.unit || ''),
        annualVolume: String(selectedItem.annualVolume || ''),
        unitWeight: String(selectedItem.unitWeight || ''),
        unitCost: String(selectedItem.unitCost || ''),
        length: String(selectedItem.length || ''),
        width: String(selectedItem.width || ''),
        height: String(selectedItem.height || ''),
        toleranceGrade: String(selectedItem.toleranceGrade || 'IT8'),
        surfaceFinish: String(selectedItem.surfaceFinish || 'Ra 3.2 μm'),
        heatTreatment: String(selectedItem.heatTreatment || 'As Required'),
        hardness: String(selectedItem.hardness || ''),
        leadTime: String(selectedItem.leadTime || '15-20'),
        revision: String(selectedItem.revision || 'Rev A'),
        qualityStandard: String(selectedItem.qualityStandard || 'ISO 9001:2015'),
        inspectionLevel: String(selectedItem.inspectionLevel || 'Level II'),
      });
    }
    setIsEditingPartDetails(false);
  };

  // Load file URLs
  useEffect(() => {
    if (!selectedItem) {
      setFile3dUrl(null);
      setFile2dUrl(null);
      return;
    }

    const loadFile3dUrl = async () => {
      try {
        if (selectedItem.file3dPath) {
          const response = await apiClient.get<{ url: string }>(`/bom-items/${selectedItem.id}/file-url/3d`);
          setFile3dUrl(response.url);
        } else {
          setFile3dUrl(null);
        }
      } catch (error) {
        setFile3dUrl(null);
      }
    };

    const loadFile2dUrl = async () => {
      try {
        if (selectedItem.file2dPath) {
          const response = await apiClient.get<{ url: string }>(`/bom-items/${selectedItem.id}/file-url/2d`);
          setFile2dUrl(response.url);
        } else {
          setFile2dUrl(null);
        }
      } catch (error) {
        setFile2dUrl(null);
      }
    };

    loadFile3dUrl();
    loadFile2dUrl();
  }, [selectedItem]);

  // Transform BOM items to match BOMSelectionCard expected format
  // Only transform the selected BOM with its items
  const transformedBoms = boms.map(bom => ({
    ...bom,
    items: bom.id === selectedBomId ? bomItems.map(item => ({
      id: item.id,
      partNumber: item.partNumber || item.id,
      description: item.name || item.description || '',
      itemType: (item.itemType || 'child_part') as 'assembly' | 'sub_assembly' | 'child_part',
      status: 'pending' as const, // You can map this from your actual data if available
    })) : [], // Empty array for non-selected BOMs
  }));

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-[1800px] mx-auto space-y-6">
        {/* PAGE HEADER */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/projects/${projectId}`)}
              className="flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Manufacturing Engineering Platform</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Integrated workflow for process planning, costing, and project management
              </p>
            </div>
          </div>
          {selectedPartNumber && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Active Part:</span>
              <Badge variant="default" className="text-xs">
                {selectedPartNumber}
              </Badge>
            </div>
          )}
        </div>

        {/* WORKFLOW NAVIGATION */}
        <WorkflowNavigation 
          currentModuleId={activeTab === 'overview' ? 'bom' : activeTab === 'process' ? 'process' : 'costing'}
          projectId={projectId}
        />

        {/* TAB INTERFACE */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <div className="flex items-center justify-between">
            <TabsList className="grid grid-cols-3 h-10">
              <TabsTrigger value="overview" className="text-xs">
                Project Overview
              </TabsTrigger>
              <TabsTrigger value="process" className="text-xs">
                Process Planning
              </TabsTrigger>
              <TabsTrigger value="costing" className="text-xs">
                Cost Analysis
              </TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3"
                onClick={handlePrevious}
                disabled={currentTabIndex === 0}
              >
                Previous
              </Button>
              <Button
                size="sm"
                className="h-8 px-3"
                onClick={handleNext}
                disabled={currentTabIndex === tabs.length - 1}
              >
                Next →
              </Button>
            </div>
          </div>

          {/* TAB 1: PROJECT OVERVIEW - For OEM Engineers */}
          <TabsContent value="overview" className="space-y-6">
            {/* Project Stats Cards - Compact */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
              <Card className="border-l-4 border-l-blue-500">
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">Total BOMs</p>
                  <p className="text-lg font-bold">{boms.length}</p>
                </CardContent>
              </Card>

              <Card className="border-l-4 border-l-green-500">
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">Parts Ready</p>
                  <p className="text-lg font-bold">{bomItems.length}</p>
                </CardContent>
              </Card>

              <Card className="border-l-4 border-l-yellow-500">
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">In Progress</p>
                  <p className="text-lg font-bold">0</p>
                </CardContent>
              </Card>

              <Card className="border-l-4 border-l-primary">
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">Project Progress</p>
                  <p className="text-lg font-bold">0%</p>
                </CardContent>
              </Card>
            </div>

            {/* Loading State */}
            {bomsLoading && (
              <div className="bg-card border border-border rounded-lg p-8 text-center">
                <p className="text-muted-foreground">Loading BOMs...</p>
              </div>
            )}

            {/* Error State */}
            {bomsError && (
              <div className="bg-destructive/10 border border-destructive rounded-lg p-4">
                <p className="text-destructive">Error loading BOMs: {bomsError.message}</p>
              </div>
            )}

            {/* BOM SELECTION CARD WITH FILTERS - HIGHLIGHTED */}
            {!bomsLoading && !bomsError && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2">
                  <div className="border-2 border-primary/50 rounded-lg bg-primary/5 p-1">
                    <BOMSelectionCard
                      boms={transformedBoms}
                      selectedBomId={selectedBomId}
                      selectedPartNumber={selectedPartNumber}
                      searchTerm={searchTerm}
                      statusFilter={statusFilter}
                      typeFilter={typeFilter}
                      onBomChange={handleBomChange}
                      onPartChange={setSelectedPartNumber}
                      onSearchChange={setSearchTerm}
                      onStatusFilterChange={setStatusFilter}
                      onTypeFilterChange={setTypeFilter}
                    />
                  </div>
                </div>

                {/* Quick Actions & BOM Info - Compact */}
                <div className="space-y-3">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Quick Actions</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <Button className="w-full justify-start" variant="outline" size="sm">
                        Create New BOM
                      </Button>
                      <Button className="w-full justify-start" variant="outline" size="sm">
                        Batch Process
                      </Button>
                      <Button className="w-full justify-start" variant="outline" size="sm">
                        Export Report
                      </Button>
                    </CardContent>
                  </Card>

                </div>
              </div>
            )}

            {/* BOM Items Loading State */}
            {selectedBomId && bomItemsLoading && (
              <div className="bg-card border border-border rounded-lg p-8 text-center">
                <p className="text-muted-foreground">Loading BOM items...</p>
              </div>
            )}

            {/* BOM Items Error State */}
            {selectedBomId && bomItemsError && (
              <div className="bg-destructive/10 border border-destructive rounded-lg p-4">
                <p className="text-destructive">Error loading BOM items: {bomItemsError.message}</p>
              </div>
            )}

            {/* DETAILED BOM INFORMATION SECTION */}
            {selectedBomId && !bomItemsLoading && !bomItemsError && bomItems.length > 0 && (
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle className="text-lg">BOM Details - {boms.find(b => b.id === selectedBomId)?.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Complete breakdown of all parts and components in this BOM
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {bomItems.map((item, index) => (
                      <div
                        key={item.id}
                        className={`rounded-lg border bg-card text-card-foreground shadow-sm border-l-4 ${item.itemType === 'assembly' ? 'border-l-emerald-500' :
                            item.itemType === 'sub_assembly' ? 'border-l-blue-500' : 'border-l-amber-500'
                          }`}
                      >
                        <div className="p-4">
                          <div className="flex flex-col md:flex-row items-start justify-between gap-4">
                            <div className="flex items-start gap-4 flex-1 w-full">
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2 mb-2">
                                  <span className="text-sm font-bold text-muted-foreground">#{index + 1}</span>
                                  <h3 className="text-lg font-semibold text-foreground truncate">
                                    {item.name || item.partNumber || `Item ${index + 1}`}
                                  </h3>
                                  <Badge
                                    variant="outline"
                                    className={`text-xs ${item.itemType === 'assembly' ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20' :
                                        item.itemType === 'sub_assembly' ? 'bg-blue-500/10 text-blue-700 border-blue-500/20' :
                                          'bg-amber-500/10 text-amber-700 border-amber-500/20'
                                      }`}
                                  >
                                    {item.itemType === 'assembly' ? 'Assembly' :
                                      item.itemType === 'sub_assembly' ? 'Sub-Assembly' : 'Child Part'}
                                  </Badge>
                                </div>

                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-3">
                                  <div className="text-sm">
                                    <p className="text-muted-foreground text-xs mb-1">Part Number</p>
                                    <p className="font-medium text-foreground">{item.partNumber || '—'}</p>
                                  </div>
                                  <div className="text-sm">
                                    <p className="text-muted-foreground text-xs mb-1">Quantity</p>
                                    <p className="font-medium text-foreground">{item.quantity} {item.unit}</p>
                                  </div>
                                  <div className="text-sm">
                                    <p className="text-muted-foreground text-xs mb-1">Annual Volume</p>
                                    <p className="font-medium text-foreground">{item.annualVolume?.toLocaleString() || '—'}</p>
                                  </div>
                                  <div className="text-sm">
                                    <p className="text-muted-foreground text-xs mb-1">Material</p>
                                    <p className="font-medium text-foreground" title={item.materialGrade || '—'}>
                                      {item.materialGrade || item.material || '—'}
                                    </p>
                                  </div>
                                  <div className="text-sm">
                                    <p className="text-muted-foreground text-xs mb-1">Status</p>
                                    <Badge variant="secondary" className="text-xs">
                                      Pending
                                    </Badge>
                                  </div>
                                </div>

                                {item.description && (
                                  <div className="text-sm mt-3">
                                    <p className="text-muted-foreground text-xs mb-1">Description</p>
                                    <p className="font-medium text-foreground">{item.description}</p>
                                  </div>
                                )}

                                {/* Additional Technical Details */}
                                <div className="mt-3 pt-3 border-t border-border">
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                                    <div>
                                      <p className="text-muted-foreground mb-1">3D Model</p>
                                      <p className="font-medium text-foreground">
                                        {item.file3dPath ? '✓ Available' : '— Not Available'}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-muted-foreground mb-1">2D Drawing</p>
                                      <p className="font-medium text-foreground">
                                        {item.file2dPath ? '✓ Available' : '— Not Available'}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-muted-foreground mb-1">Procurement</p>
                                      <p className="font-medium text-foreground">
                                        {item.itemType === 'child_part' ? 'Manufacturing' : 'Assembly'}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-muted-foreground mb-1">Priority</p>
                                      <Badge variant="outline" className="text-xs">
                                        {item.itemType === 'assembly' ? 'High' : 'Medium'}
                                      </Badge>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 w-full md:w-auto justify-end">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setSelectedPartNumber(item.partNumber || item.id);
                                  setActiveTab('process');
                                }}
                                className={`${selectedPartNumber === (item.partNumber || item.id) ? 'bg-primary text-primary-foreground' : ''}`}
                              >
                                {selectedPartNumber === (item.partNumber || item.id) ? 'Selected' : 'Select'}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* TAB 2: PROCESS PLANNING - For Process Engineers */}
          <TabsContent value="process" className="space-y-4">
            {selectedPartNumber && selectedItem ? (
              <>
                {/* Selected Part Details Card - Compact & Editable */}
                <Card className="border-l-4 border-l-green-500">
                  <CardHeader className="bg-green-500 py-2 px-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-white text-sm font-semibold">
                        Complete BOM Details & Process Planning
                      </CardTitle>
                      {!isEditingPartDetails ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleEditPartDetails}
                          className="h-6 px-2 text-xs text-white hover:bg-white/20"
                        >
                          Edit All
                        </Button>
                      ) : (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleSavePartDetails}
                            className="h-6 px-2 text-xs text-white hover:bg-white/20"
                          >
                            Save
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleCancelEdit}
                            className="h-6 px-2 text-xs text-white hover:bg-white/20"
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="p-3">

                    {/* Basic Information */}
                    <div className="mb-3">
                      <h4 className="text-xs font-semibold text-foreground mb-2 uppercase tracking-wide">Basic Information</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <div>
                          <label className="text-xs text-muted-foreground">Part Number</label>
                          {isEditingPartDetails ? (
                            <Input
                              value={editablePartData.partNumber}
                              onChange={(e) => setEditablePartData(prev => ({ ...prev, partNumber: e.target.value }))}
                              className="h-7 text-xs"
                            />
                          ) : (
                            <p className="text-xs font-medium">{editablePartData.partNumber}</p>
                          )}
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Part Name</label>
                          {isEditingPartDetails ? (
                            <Input
                              value={editablePartData.name}
                              onChange={(e) => setEditablePartData(prev => ({ ...prev, name: e.target.value }))}
                              className="h-7 text-xs"
                            />
                          ) : (
                            <p className="text-xs font-medium">{editablePartData.name || '—'}</p>
                          )}
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Item Type</label>
                          {isEditingPartDetails ? (
                            <select
                              value={editablePartData.itemType}
                              onChange={(e) => setEditablePartData(prev => ({ ...prev, itemType: e.target.value }))}
                              className="h-7 w-full text-xs border rounded px-2"
                            >
                              <option value="child_part">Child Part</option>
                              <option value="sub_assembly">Sub Assembly</option>
                              <option value="assembly">Assembly</option>
                            </select>
                          ) : (
                            <Badge variant="outline" className="text-xs h-5">
                              {editablePartData.itemType.replace('_', ' ').toUpperCase()}
                            </Badge>
                          )}
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Material</label>
                          {isEditingPartDetails ? (
                            <Input
                              value={editablePartData.material}
                              onChange={(e) => setEditablePartData(prev => ({ ...prev, material: e.target.value }))}
                              className="h-7 text-xs"
                            />
                          ) : (
                            <p className="text-xs font-medium">{editablePartData.material || '—'}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Technical Specifications */}
                    <div className="mb-3">
                      <h4 className="text-xs font-semibold text-foreground mb-2 uppercase tracking-wide">Technical Specs</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <div>
                          <label className="text-xs text-muted-foreground">Quantity</label>
                          {isEditingPartDetails ? (
                            <Input
                              value={editablePartData.quantity}
                              onChange={(e) => setEditablePartData(prev => ({ ...prev, quantity: e.target.value }))}
                              className="h-7 text-xs"
                            />
                          ) : (
                            <p className="text-xs font-medium">{editablePartData.quantity || '—'}</p>
                          )}
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Unit</label>
                          {isEditingPartDetails ? (
                            <Input
                              value={editablePartData.unit}
                              onChange={(e) => setEditablePartData(prev => ({ ...prev, unit: e.target.value }))}
                              className="h-7 text-xs"
                            />
                          ) : (
                            <p className="text-xs font-medium">{editablePartData.unit || '—'}</p>
                          )}
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Annual Volume</label>
                          {isEditingPartDetails ? (
                            <Input
                              value={editablePartData.annualVolume}
                              onChange={(e) => setEditablePartData(prev => ({ ...prev, annualVolume: e.target.value }))}
                              className="h-7 text-xs"
                            />
                          ) : (
                            <p className="text-xs font-medium">{editablePartData.annualVolume ? Number(editablePartData.annualVolume).toLocaleString() : '—'}</p>
                          )}
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Unit Weight (kg)</label>
                          {isEditingPartDetails ? (
                            <Input
                              value={editablePartData.unitWeight}
                              onChange={(e) => setEditablePartData(prev => ({ ...prev, unitWeight: e.target.value }))}
                              className="h-7 text-xs"
                            />
                          ) : (
                            <p className="text-xs font-medium">{editablePartData.unitWeight || '—'}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Dimensions */}
                      <div>
                        <h4 className="text-xs font-semibold text-foreground mb-2 uppercase tracking-wide">Dimensions (mm)</h4>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-muted-foreground">Length</label>
                            {isEditingPartDetails ? (
                              <Input
                                value={editablePartData.length}
                                onChange={(e) => setEditablePartData(prev => ({ ...prev, length: e.target.value }))}
                                className="h-7 text-xs"
                              />
                            ) : (
                              <p className="text-xs font-medium">{editablePartData.length || '—'}</p>
                            )}
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Width</label>
                            {isEditingPartDetails ? (
                              <Input
                                value={editablePartData.width}
                                onChange={(e) => setEditablePartData(prev => ({ ...prev, width: e.target.value }))}
                                className="h-7 text-xs"
                              />
                            ) : (
                              <p className="text-xs font-medium">{editablePartData.width || '—'}</p>
                            )}
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Height</label>
                            {isEditingPartDetails ? (
                              <Input
                                value={editablePartData.height}
                                onChange={(e) => setEditablePartData(prev => ({ ...prev, height: e.target.value }))}
                                className="h-7 text-xs"
                              />
                            ) : (
                              <p className="text-xs font-medium">{editablePartData.height || '—'}</p>
                            )}
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Tolerance</label>
                            {isEditingPartDetails ? (
                              <Input
                                value={editablePartData.toleranceGrade}
                                onChange={(e) => setEditablePartData(prev => ({ ...prev, toleranceGrade: e.target.value }))}
                                className="h-7 text-xs"
                              />
                            ) : (
                              <p className="text-xs font-medium">{editablePartData.toleranceGrade}</p>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Manufacturing */}
                      <div>
                        <h4 className="text-xs font-semibold text-foreground mb-2 uppercase tracking-wide">Manufacturing</h4>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-muted-foreground">Surface Finish</label>
                            {isEditingPartDetails ? (
                              <Input
                                value={editablePartData.surfaceFinish}
                                onChange={(e) => setEditablePartData(prev => ({ ...prev, surfaceFinish: e.target.value }))}
                                className="h-7 text-xs"
                              />
                            ) : (
                              <p className="text-xs font-medium">{editablePartData.surfaceFinish}</p>
                            )}
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Heat Treatment</label>
                            {isEditingPartDetails ? (
                              <Input
                                value={editablePartData.heatTreatment}
                                onChange={(e) => setEditablePartData(prev => ({ ...prev, heatTreatment: e.target.value }))}
                                className="h-7 text-xs"
                              />
                            ) : (
                              <p className="text-xs font-medium">{editablePartData.heatTreatment}</p>
                            )}
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Hardness (HRC)</label>
                            {isEditingPartDetails ? (
                              <Input
                                value={editablePartData.hardness}
                                onChange={(e) => setEditablePartData(prev => ({ ...prev, hardness: e.target.value }))}
                                className="h-7 text-xs"
                              />
                            ) : (
                              <p className="text-xs font-medium">{editablePartData.hardness || '—'}</p>
                            )}
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Lead Time</label>
                            {isEditingPartDetails ? (
                              <Input
                                value={editablePartData.leadTime}
                                onChange={(e) => setEditablePartData(prev => ({ ...prev, leadTime: e.target.value }))}
                                className="h-7 text-xs"
                              />
                            ) : (
                              <p className="text-xs font-medium">{editablePartData.leadTime}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Bottom Row - Cost, Quality, Files */}
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <h4 className="text-xs font-semibold text-foreground mb-2 uppercase tracking-wide">Cost & Quality</h4>
                        <div className="space-y-1">
                          <div>
                            <label className="text-xs text-muted-foreground">Unit Cost (₹)</label>
                            {isEditingPartDetails ? (
                              <Input
                                value={editablePartData.unitCost}
                                onChange={(e) => setEditablePartData(prev => ({ ...prev, unitCost: e.target.value }))}
                                className="h-7 text-xs"
                              />
                            ) : (
                              <p className="text-xs font-medium">₹{editablePartData.unitCost || '—'}</p>
                            )}
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Quality Standard</label>
                            {isEditingPartDetails ? (
                              <Input
                                value={editablePartData.qualityStandard}
                                onChange={(e) => setEditablePartData(prev => ({ ...prev, qualityStandard: e.target.value }))}
                                className="h-7 text-xs"
                              />
                            ) : (
                              <p className="text-xs font-medium">{editablePartData.qualityStandard}</p>
                            )}
                          </div>
                        </div>
                      </div>

                      <div>
                        <h4 className="text-xs font-semibold text-foreground mb-2 uppercase tracking-wide">Documentation</h4>
                        <div className="space-y-1">
                          <div>
                            <label className="text-xs text-muted-foreground">Revision</label>
                            {isEditingPartDetails ? (
                              <Input
                                value={editablePartData.revision}
                                onChange={(e) => setEditablePartData(prev => ({ ...prev, revision: e.target.value }))}
                                className="h-7 text-xs"
                              />
                            ) : (
                              <p className="text-xs font-medium">{editablePartData.revision}</p>
                            )}
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Inspection Level</label>
                            {isEditingPartDetails ? (
                              <Input
                                value={editablePartData.inspectionLevel}
                                onChange={(e) => setEditablePartData(prev => ({ ...prev, inspectionLevel: e.target.value }))}
                                className="h-7 text-xs"
                              />
                            ) : (
                              <Badge variant="outline" className="text-xs h-5">
                                {editablePartData.inspectionLevel}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>

                      <div>
                        <h4 className="text-xs font-semibold text-foreground mb-2 uppercase tracking-wide">Files</h4>
                        <div className="space-y-1">
                          <div className="flex items-center gap-1">
                            <Badge variant={selectedItem?.file3dPath ? "default" : "secondary"} className="text-xs h-5">
                              3D {selectedItem?.file3dPath ? '✓' : '✗'}
                            </Badge>
                            {selectedItem?.file3dPath && (
                              <span className="text-xs text-muted-foreground">
                                {selectedItem.file3dPath.split('.').pop()?.toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <Badge variant={selectedItem?.file2dPath ? "default" : "secondary"} className="text-xs h-5">
                              2D {selectedItem?.file2dPath ? '✓' : '✗'}
                            </Badge>
                            {selectedItem?.file2dPath && (
                              <span className="text-xs text-muted-foreground">
                                {selectedItem.file2dPath.split('.').pop()?.toUpperCase()}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Description - Full Width */}
                    {(selectedItem?.description || isEditingPartDetails) && (
                      <div className="mt-3">
                        <label className="text-xs font-medium text-muted-foreground">Description</label>
                        {isEditingPartDetails ? (
                          <Input
                            value={editablePartData.description}
                            onChange={(e) => setEditablePartData(prev => ({ ...prev, description: e.target.value }))}
                            className="h-7 text-xs mt-1"
                            placeholder="Enter part description"
                          />
                        ) : (
                          <p className="text-xs text-foreground bg-muted/30 p-2 rounded mt-1">
                            {editablePartData.description || 'No description available'}
                          </p>
                        )}
                      </div>
                    )}

                  </CardContent>
                </Card>

                {/* 3D MODEL & 2D DRAWING VIEWERS */}
                <div className="border border-border rounded-lg overflow-hidden shadow-md">
                  <div className="bg-primary p-3">
                    <h2 className="text-sm font-semibold text-primary-foreground">3D Model & 2D Drawing Viewers</h2>
                  </div>
                  <div className="bg-card p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* 3D Viewer */}
                      <div>
                        <h3 className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">3D Model (.STEP)</h3>
                        <div className="aspect-square bg-secondary border border-border rounded flex items-center justify-center overflow-hidden">
                          {selectedItem.file3dPath && file3dUrl ? (
                            <ModelViewer
                              fileUrl={file3dUrl}
                              fileName={selectedItem.file3dPath.split('/').pop() || selectedItem.name || 'model'}
                              fileType={selectedItem.file3dPath.split('.').pop() || 'step'}
                              bomItemId={selectedItem.id}
                              onMeasurements={handleModelMeasurements}
                            />
                          ) : (
                            <div className="text-center text-muted-foreground">
                              <p className="text-sm">No 3D file available</p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 2D Viewer */}
                      <div>
                        <h3 className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">2D Drawing (PDF/Image)</h3>
                        <div className="aspect-square bg-secondary border border-border rounded flex items-center justify-center overflow-hidden">
                          {selectedItem.file2dPath && file2dUrl ? (
                            <Viewer2D
                              fileUrl={file2dUrl}
                              fileName={selectedItem.file2dPath.split('/').pop() || selectedItem.name || 'drawing'}
                              fileType={
                                selectedItem.file2dPath.toLowerCase().endsWith('.pdf')
                                  ? 'pdf'
                                  : ['.png', '.jpg', '.jpeg', '.webp'].some((ext) =>
                                    selectedItem.file2dPath?.toLowerCase().endsWith(ext)
                                  )
                                    ? 'img'
                                    : 'other'
                              }
                            />
                          ) : (
                            <div className="text-center text-muted-foreground">
                              <p className="text-sm">No 2D drawing available</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Raw Materials Section */}
                <RawMaterialsSection bomItemId={selectedItem.id} />

                {/* Manufacturing Process Section */}
                <ManufacturingProcessSection bomItemId={selectedItem.id} />

                {/* Packaging & Logistics Section */}
                <PackagingLogisticsSection bomItemId={selectedItem.id} />

{/* Procured Parts Section */}
                <ProcuredPartsSection bomItemId={selectedItem.id} />
              </>
            ) : (
              <div className="text-center py-8 bg-card border-2 border-dashed border-border rounded-lg">
                <p className="text-sm font-medium text-muted-foreground mb-1">No Part Selected</p>
                <p className="text-xs text-muted-foreground">
                  Go to Project Overview tab to select a part for process planning
                </p>
              </div>
            )}
          </TabsContent>

          {/* TAB 3: COST ANALYSIS - For Cost Engineers */}
          <TabsContent value="costing" className="space-y-6">
            {selectedBomId ? (
              <div className="space-y-6">
                {/* Cost Analysis Engine - Overview and Charts */}
                <CostAnalysisEngine 
                  bomId={selectedBomId}
                  bomName={boms.find(b => b.id === selectedBomId)?.name || "Assembly"}
                  itemCount={bomItems.length || 2}
                />
                
                {/* Detailed BOM Cost Report - Part-by-Part Breakdown */}
                <div className="border-t border-border pt-6">
                  <div className="mb-4">
                    <h3 className="text-lg font-semibold text-foreground">Detailed BOM Cost Breakdown</h3>
                    <p className="text-sm text-muted-foreground">
                      Comprehensive part-by-part cost analysis with raw materials, processes, and margins
                    </p>
                  </div>
                  <BomCostReportWrapper 
                    bomId={selectedBomId} 
                    bomName={boms.find(b => b.id === selectedBomId)?.name || "Assembly"} 
                  />
                </div>
              </div>
            ) : (
              <Card>
                <CardContent className="py-12">
                  <div className="text-center">
                    <DollarSign className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold text-foreground mb-2">Select a BOM to Start Cost Analysis</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Go to Project Overview to select a BOM and the cost analysis engine will automatically calculate comprehensive cost breakdowns
                    </p>
                    <Button 
                      onClick={() => setActiveTab('overview')}
                      variant="outline"
                      className="mx-auto"
                    >
                      Go to Project Overview
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// Wrapper component with CostDataProvider
export default function ProcessPlanningPage() {
  return (
    <CostDataProvider>
      <ProcessPlanningPageContent />
    </CostDataProvider>
  );
}
