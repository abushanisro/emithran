'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RemarksApi } from '@/lib/api/remarks';
import { RemarkStatus } from '@/types/remarks';
import { productionPlanningApi } from '@/lib/api/production-planning';
import { apiClient } from '@/lib/api/client';
import {
  useIntegratedDashboard,
  useProductionMonitoring,
  useLotMaterials,
  useProductionAlerts,
  useUpdateMaterialStatus,
  useResolveAlert,
  useRefreshDashboard,
  useInitializeLotMaterials,
} from '@/lib/api/hooks/useIntegratedProduction';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertTriangle,
  CheckCircle,
  Target,
  Activity,
  Package,
  Users,
  Flag,
  RefreshCw,
  Search,
  Plus,
  Edit,
  Eye,
  AlertCircle,
  ChevronRight,
  ChevronDown
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";



interface BOMItem {
  id: string;
  partNumber: string;
  partName: string;
  description: string;
  unitQuantity: number;
  totalQuantity: number;
  receivedQuantity: number;
  inspectedQuantity: number;
  approvedQuantity: number;
  rejectedQuantity: number;
  consumedQuantity: number;
  unit: string;
  materialType: string;
  assignedVendor: string | null;
  vendorName: string | null;
  materialStatus: 'PLANNING' | 'ORDERED' | 'SHIPPED' | 'RECEIVED' | 'INSPECTED' | 'APPROVED' | 'IN_USE' | 'DEPLETED';
  trackingHistory: TrackingHistory[];
  estimatedCost: number;
  actualCost: number | null;
  deliveryDate: string | null;
  receivedDate: string | null;
  criticality: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  alerts: PartAlert[];
  processImpact: string[];
}

interface TrackingHistory {
  id: string;
  partId: string;
  action: 'ORDERED' | 'SHIPPED' | 'RECEIVED' | 'INSPECTED' | 'APPROVED' | 'REJECTED' | 'CONSUMED' | 'RETURNED';
  quantity: number;
  date: string;
  performedBy: string;
  performedByName: string;
  notes: string;
  batchNumber?: string;
  location?: string;
}

interface PartAlert {
  id: string;
  type: 'DELAY' | 'SHORTAGE' | 'QUALITY' | 'REORDER' | 'EXPIRY';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  createdAt: string;
  resolved: boolean;
  affectedProcesses?: string[];
}

interface IntegratedMonitoringBOMProps {
  lotId: string;
}

export const IntegratedMonitoringBOM = ({ lotId }: IntegratedMonitoringBOMProps) => {
  const queryClient = useQueryClient();
  const [timeRange, setTimeRange] = useState<'day' | 'week' | 'month'>('week');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterCriticality, setFilterCriticality] = useState<string>('all');
  const [selectedMaterial, setSelectedMaterial] = useState<BOMItem | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [addMaterialDialogOpen, setAddMaterialDialogOpen] = useState(false);

  // API Hooks for real data
  const {
    data: dashboardData,
    isLoading,
    error: dashboardError
  } = useIntegratedDashboard(lotId);

  // Unused hooks removed for cleanup
  useProductionMonitoring(lotId);
  useLotMaterials(lotId);
  useProductionAlerts(lotId);

  // Fetch real remarks data instead of mock alerts
  const { data: remarksData, isLoading: remarksLoading } = useQuery({
    queryKey: ['remarks', lotId],
    queryFn: () => RemarksApi.getRemarksByLot(lotId),
    enabled: !!lotId,
  });

  // Mutations
  const updateMaterialMutation = useUpdateMaterialStatus();
  const resolveAlertMutation = useResolveAlert();

  const resolveRemarkMutation = useMutation({
    mutationFn: (remarkId: string) => RemarksApi.updateRemark(remarkId, { status: 'resolved' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['remarks', lotId] });
    },
  });
  const initializeMaterialsMutation = useInitializeLotMaterials();

  // Refresh utilities
  const { refreshAll } = useRefreshDashboard(lotId);

  // Real-time updates handled by refetchInterval in queries

  // Extract data from API responses with proper structure
  // Get real production processes instead of mock dashboard data
  const { data: realProcesses, isLoading: processesLoading } = useQuery<any[]>({
    queryKey: ['processes', lotId],
    queryFn: async () => {
      const result = await productionPlanningApi.getProcessesByLot(lotId);
      return result as any[];
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Transform real processes data to timeline format
  const processProgress = (realProcesses || []).map((process: any, index: number) => {
    // Calculate progress based on subtasks
    const subtasks = process.subtasks || [];
    const completedSubtasks = subtasks.filter((st: any) => st.status === 'COMPLETED').length;
    const totalSubtasks = subtasks.length;
    const progress = totalSubtasks > 0 ? Math.round((completedSubtasks / totalSubtasks) * 100) : 0;

    // Calculate material readiness from BOM requirements
    const allBomReqs = subtasks.flatMap((st: any) => st.bom_requirements || st.bomRequirements || []);
    const readyBomReqs = allBomReqs.filter((bom: any) => bom.material_status === 'AVAILABLE' || bom.materialStatus === 'AVAILABLE').length;
    const materialReadiness = allBomReqs.length > 0 ? Math.round((readyBomReqs / allBomReqs.length) * 100) : 100;

    // Get required materials list
    const requiredMaterials = [...new Set(allBomReqs.map((bom: any) => bom.part_number || bom.partNumber))];

    // Identify bottlenecks based on real data
    const bottlenecks = [];
    if (progress < 30 && materialReadiness < 50) {
      bottlenecks.push('Insufficient material availability for process initiation');
    }
    if (materialReadiness < progress) {
      bottlenecks.push('Material procurement delays affecting production timeline');
    }

    return {
      id: process.id,
      name: process.process_name || process.processName || `Process ${index + 1}`,
      status: (process.status || 'PENDING').toUpperCase(),
      progress: progress,
      materialReadiness: materialReadiness,
      startDate: process.planned_start_date || process.plannedStartDate,
      endDate: process.planned_end_date || process.plannedEndDate,
      requiredMaterials: requiredMaterials,
      bottlenecks: bottlenecks,
      totalSubtasks: totalSubtasks,
      completedSubtasks: completedSubtasks
    };
  });

  // Get lot data including selected BOM items
  const { data: lotData, isLoading: lotLoading } = useQuery<any>({
    queryKey: ['lot', lotId],
    queryFn: () => productionPlanningApi.getProductionLotById(lotId),
    enabled: !!lotId,
  });

  // Get BOM items directly if lot has a BOM but no items
  const bomId = lotData?.data?.bomId || lotData?.bomId;
  const { data: bomData, isLoading: bomLoading } = useQuery<any>({
    queryKey: ['bom-items', bomId, lotId],
    queryFn: async () => {
      if (!bomId) {
        return null;
      }
      try {
        // Try multiple endpoints to get BOM items

        let response: any;
        // First try: the endpoint we see in the logs that's working
        try {
          response = await apiClient.get(`/bom-items?bomId=${bomId}`);
        } catch (err1) {
          try {
            // Second try: the production planning specific endpoint  
            response = await apiClient.get(`/production-planning/lots/${lotId}/bom-items`);
          } catch (err2) {
            // Third try: direct BOM endpoint
            response = await apiClient.get(`/boms/${bomId}/items`);
          }
        }

        // The response might be wrapped in data property
        return response?.data || response;
      } catch (error) {
        return null;
      }
    },
    enabled: !!bomId || !!lotId,
    retry: 1,
  });

  // Debug: Log all data sources

  // Use selected BOM items from lot as the primary source, fallback to BOM items if none selected
  const selectedBomItems = lotData?.data?.selectedBomItems || lotData?.selectedBomItems || [];
  const bomItems = dashboardData?.data?.materials || [];
  const allBomItems = lotData?.data?.bom?.items || lotData?.bom?.items || [];
  // Handle the API response structure - bomData has items array
  const directBomItems = Array.isArray(bomData) ? bomData : (bomData?.items || bomData?.data || []);


  // If no selected items but BOM has items, use all BOM items as fallback
  // Priority: selectedBomItems > allBomItems > directBomItems (only as last resort)
  let itemsToProcess = [];
  if (selectedBomItems.length > 0) {
    itemsToProcess = selectedBomItems;
  } else if (allBomItems.length > 0) {
    itemsToProcess = allBomItems;
  } else if (Array.isArray(directBomItems) && directBomItems.length > 0) {
    // Last resort: show all BOM items with a warning
    itemsToProcess = directBomItems;
  } else {
    itemsToProcess = [];
  }

  // Combine selected/BOM items with any existing material data and include subtask BOM requirements
  let materialItems = [];

  if (itemsToProcess.length > 0) {
    // Process lot-level BOM items
    materialItems = itemsToProcess.map((bomItem: any) => {
      // Check if we have material tracking data for this BOM item
      const existingMaterial = bomItems.find((m: any) =>
        (m.bom_item_id === bomItem.id) ||
        (m.bom_items?.id === bomItem.id)
      );

      // Handle both direct BOM items and selected BOM items with nested structure
      const actualBomItem = bomItem.bom_item || bomItem;

      // For selected BOM items, use partNumber as the display name if name is not available
      const displayName = actualBomItem.name || bomItem.name ||
        actualBomItem.partNumber || bomItem.partNumber ||
        actualBomItem.part_number || bomItem.part_number || 'Unknown Part';

      const partNumber = actualBomItem.partNumber || bomItem.partNumber ||
        actualBomItem.part_number || bomItem.part_number || 'N/A';

      return existingMaterial || {
        id: actualBomItem.id || bomItem.id,
        bom_item_id: actualBomItem.id || bomItem.id,
        bom_items: {
          id: actualBomItem.id || bomItem.id,
          name: displayName,
          part_number: partNumber,
          description: actualBomItem.description || bomItem.description || 'No description'
        },
        required_quantity: actualBomItem.quantity || bomItem.quantity || 1,
        approved_quantity: 0,
        consumed_quantity: 0,
        material_status: 'PLANNING',
        criticality: actualBomItem.criticality || bomItem.criticality || 'MEDIUM',
        estimated_cost: actualBomItem.unit_cost_inr || actualBomItem.unitCost || bomItem.unit_cost || bomItem.unitCost || 0,
        alerts: [],
        processImpact: []
      };
    });
  } else {
    // Fallback to existing material tracking data
    materialItems = bomItems;
  }

  // Also extract BOM requirements from process subtasks to show comprehensive tracking
  const subtaskBomItems = (realProcesses || []).flatMap((process: any) => {

    return (process.subtasks || []).flatMap((subtask: any, subtaskIndex: number) => {
      const bomRequirements = subtask.bom_requirements || subtask.bomRequirements || [];


      return bomRequirements.map((bomReq: any, bomIndex: number) => {
        const taskName = subtask.task_name || subtask.taskName || 'Unknown Task';
        const processName = process.process_name || process.processName || 'Unknown Process';

        // Determine which section this belongs to based on task name or process name
        let sectionName = 'Process';
        if (taskName.toLowerCase().includes('inspection') || taskName.includes('[Inspection]') ||
          processName.toLowerCase().includes('inspection')) {
          sectionName = 'Inspection';
        } else if (taskName.toLowerCase().includes('raw') || taskName.includes('[Raw Material]') ||
          processName.toLowerCase().includes('raw')) {
          sectionName = 'Raw Material';
        } else if (taskName.toLowerCase().includes('pack') || taskName.includes('[Packing]') ||
          processName.toLowerCase().includes('pack')) {
          sectionName = 'Packing';
        }

        return {
          id: bomReq.id || bomReq.bom_item_id || `subtask-${subtask.id}-${bomReq.part_number || bomReq.partNumber}-${bomIndex}`,
          bom_item_id: bomReq.bom_item_id || bomReq.id,
          bom_items: {
            id: bomReq.bom_item_id || bomReq.id,
            name: bomReq.part_name || bomReq.partName || bomReq.name || bomReq.bom_item?.name || bomReq.part_number || bomReq.partNumber || 'Subtask BOM Part',
            part_number: bomReq.part_number || bomReq.partNumber || bomReq.bom_item?.part_number || 'N/A',
            description: bomReq.description || bomReq.bom_item?.description || `Required for ${sectionName} - ${taskName}`
          },
          required_quantity: bomReq.required_quantity || bomReq.requiredQuantity || bomReq.quantity || 0,
          approved_quantity: bomReq.available_quantity || bomReq.availableQuantity || 0,
          consumed_quantity: bomReq.consumed_quantity || bomReq.consumedQuantity || 0,
          material_status: bomReq.material_status || bomReq.status || (bomReq.available_quantity > 0 ? 'AVAILABLE' : 'PLANNING'),
          criticality: bomReq.criticality || 'MEDIUM',
          estimated_cost: bomReq.unit_cost || bomReq.unitCost || 0,
          alerts: [],
          processImpact: [`${sectionName} - ${taskName}`],
          subtaskId: subtask.id,
          processId: process.id,
          sectionName: sectionName,
          taskName: taskName,
          isSubtaskBom: true // Flag to identify this comes from subtask
        };
      });
    });
  });


  // Merge lot-level BOM items with subtask BOM items, avoiding duplicates
  const allUniqueMaterialItems = [...materialItems];
  subtaskBomItems.forEach((subtaskBom: any) => {
    const existing = allUniqueMaterialItems.find((item: any) =>
      item.bom_items?.part_number === subtaskBom.bom_items?.part_number ||
      item.id === subtaskBom.id
    );
    if (!existing) {
      allUniqueMaterialItems.push(subtaskBom);
    }
  });

  // Use the combined list
  materialItems = allUniqueMaterialItems;

  // Debug logging to understand data structure

  // Use real remarks data instead of mock alerts
  const integratedAlerts = (remarksData || []).map((remark: any) => ({
    id: remark.id,
    title: remark.title,
    description: remark.description || 'No description provided',
    impact: 'Production may be affected if not addressed',
    suggestedAction: 'Please review and take appropriate action',
    severity: remark.priority || 'MEDIUM',
    type: remark.remark_type || 'GENERAL',
    source: 'REMARKS',
    status: remark.status || RemarkStatus.OPEN,
    createdAt: remark.created_at,
    relatedItems: remark.bom_part_id ? [`${remark.bom_part_id}`] : []
  })).filter((alert: any) => alert.status === RemarkStatus.OPEN); // Only show open remarks

  const loading = isLoading || remarksLoading || processesLoading || lotLoading || bomLoading;

  const handleRefresh = async () => {
    refreshAll();
  };

  // Handle material status updates


  // Handle showing add materials dialog
  const handleShowAddMaterialDialog = () => {
    setAddMaterialDialogOpen(true);
  };

  // Handle adding/initializing materials from BOM
  const handleAddMaterials = async () => {
    try {
      await initializeMaterialsMutation.mutateAsync(lotId);
      // Refresh the dashboard to show new materials
      refreshAll();
      setAddMaterialDialogOpen(false);
    } catch (error) {
    }
  };

  // Handle alert resolution
  const handleResolveAlert = async (alertId: string, _notes: string) => {
    try {
      // Resolve the remark instead of mock alert
      await resolveRemarkMutation.mutateAsync(alertId);
    } catch (error) {
    }
  };

  // Error handling
  if (dashboardError) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Error Loading Dashboard</h2>
          <p className="text-muted-foreground mb-4">Failed to load production data</p>
          <Button onClick={() => refreshAll()}>Retry</Button>
        </div>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    const colors = {
      PLANNED: 'bg-blue-100 text-blue-600',
      IN_PROGRESS: 'bg-yellow-100 text-yellow-600',
      COMPLETED: 'bg-green-100 text-green-600',
      BLOCKED: 'bg-red-100 text-red-600',
      PLANNING: 'bg-gray-100 text-gray-600',
      ORDERED: 'bg-blue-100 text-blue-600',
      SHIPPED: 'bg-purple-100 text-purple-600',
      RECEIVED: 'bg-yellow-100 text-yellow-600',
      INSPECTED: 'bg-orange-100 text-orange-600',
      APPROVED: 'bg-green-100 text-green-600',
      IN_USE: 'bg-emerald-100 text-emerald-600',
      DEPLETED: 'bg-red-100 text-red-600'
    };
    return colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-600';
  };

  const getSeverityColor = (severity: string) => {
    const colors = {
      LOW: 'bg-green-100 text-green-600',
      MEDIUM: 'bg-yellow-100 text-yellow-600',
      HIGH: 'bg-orange-100 text-orange-600',
      CRITICAL: 'bg-red-100 text-red-600'
    };
    return colors[severity as keyof typeof colors] || 'bg-gray-100 text-gray-600';
  };

  const getAlertTypeIcon = (type: string) => {
    switch (type) {
      case 'MATERIAL': return <Package className="h-4 w-4" />;
      case 'PROCESS': return <Activity className="h-4 w-4" />;
      case 'QUALITY': return <CheckCircle className="h-4 w-4" />;
      case 'EQUIPMENT': return <Users className="h-4 w-4" />;
      default: return <Flag className="h-4 w-4" />;
    }
  };

  const toggleRowExpansion = (itemId: string) => {
    const newExpanded = new Set(expandedRows);
    if (expandedRows.has(itemId)) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedRows(newExpanded);
  };

  const filteredBOMItems = materialItems.filter(item => {
    // Use safe field access with fallbacks
    const partName = item.bom_items?.name || item.partName || '';
    const partNumber = item.bom_items?.part_number || item.partNumber || '';
    const materialStatus = item.material_status || item.materialStatus || '';
    const criticality = item.criticality || '';

    const matchesSearch = partName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      partNumber.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'all' || materialStatus.toUpperCase() === filterStatus;
    const matchesCriticality = filterCriticality === 'all' || criticality.toUpperCase() === filterCriticality;
    return matchesSearch && matchesStatus && matchesCriticality;
  });

  // Calculate real-time metrics from actual data instead of relying on potentially faulty backend metrics
  const totalProgress = processProgress.length > 0
    ? Math.round(processProgress.reduce((sum: number, p: any) => sum + (p.progress || 0), 0) / processProgress.length)
    : 0;

  const materialReadiness = materialItems.length > 0
    ? Math.round(materialItems.reduce((sum: number, item: any) => {
      const required = item.required_quantity || 0;
      const approved = item.approved_quantity || 0;
      return sum + (required > 0 ? (approved / required) * 100 : 0);
    }, 0) / materialItems.length)
    : 0;

  const criticalAlerts = integratedAlerts.filter(a => a.severity === 'CRITICAL').length;
  const highAlerts = integratedAlerts.filter(a => a.severity === 'HIGH').length;
  const blockedProcesses = processProgress.filter((p: any) => p.status === 'BLOCKED').length;

  const totalEstimatedCost = materialItems.reduce((sum: number, item: any) => sum + (item.estimated_cost || 0), 0);
  const totalActualCost = materialItems.reduce((sum: number, item: any) => sum + (item.actual_cost || item.estimated_cost || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Refresh */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Integrated Production Monitoring & Materials</h2>
          <p className="text-muted-foreground">Real-time production insights with BOM material tracking</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={timeRange} onValueChange={(value: any) => setTimeRange(value)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Today</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={updateMaterialMutation.isPending || resolveAlertMutation.isPending}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${updateMaterialMutation.isPending ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Integrated Key Metrics Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Production Progress</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold mb-2">{totalProgress}%</div>
            <Progress value={totalProgress} className="h-2 mb-2" />
            <p className="text-xs text-muted-foreground">
              {processProgress.filter((p: any) => p.status === 'COMPLETED').length} of {processProgress.length} processes complete
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Material Readiness</CardTitle>
            <Package className={`h-4 w-4 ${materialReadiness >= 80 ? 'text-green-500' : materialReadiness >= 60 ? 'text-yellow-500' : 'text-red-500'}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${materialReadiness >= 80 ? 'text-green-600' : materialReadiness >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
              {materialReadiness}%
            </div>
            <p className="text-xs text-muted-foreground">
              {materialItems.length === 0 ? 'No materials initialized' :
                `Average across ${materialItems.length} materials`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Blocked Processes</CardTitle>
            {blockedProcesses > 0 ?
              <AlertTriangle className="h-4 w-4 text-red-500" /> :
              <CheckCircle className="h-4 w-4 text-green-500" />
            }
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${blockedProcesses > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {blockedProcesses}
            </div>
            <p className="text-xs text-muted-foreground">
              {blockedProcesses > 0 ? 'Need immediate attention' :
                processProgress.length === 0 ? 'No processes configured' : 'All processes active'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Critical Alerts</CardTitle>
            <AlertTriangle className={`h-4 w-4 ${criticalAlerts > 0 ? 'text-red-500' : highAlerts > 0 ? 'text-orange-500' : 'text-green-500'}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${criticalAlerts > 0 ? 'text-red-600' : highAlerts > 0 ? 'text-orange-600' : 'text-green-600'}`}>
              {integratedAlerts.length}
            </div>
            <p className="text-xs text-muted-foreground">
              {integratedAlerts.length === 0 ? 'No active issues' : `${criticalAlerts} critical, ${highAlerts} high priority`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Material Cost</CardTitle>
            <div className="text-green-600">₹</div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{totalActualCost.toLocaleString()}</div>
            <p className={`text-xs ${totalActualCost <= totalEstimatedCost ? 'text-green-600' : 'text-red-600'}`}>
              {totalActualCost > 0 && totalEstimatedCost > 0 ?
                `${((totalActualCost - totalEstimatedCost) / totalEstimatedCost * 100).toFixed(1)}% vs estimate` :
                totalEstimatedCost > 0 ? 'Based on estimates' : 'No cost data available'
              }
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Integrated Dashboard */}
      <Tabs defaultValue="materials" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="materials">Material Tracking</TabsTrigger>
          <TabsTrigger value="alerts">Integrated Alerts</TabsTrigger>
        </TabsList>

        <TabsContent value="materials" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <CardTitle>Material Inventory & Tracking</CardTitle>
                  <CardDescription>
                    Comprehensive material tracking with production impact
                  </CardDescription>
                </div>
                <Button
                  className="flex items-center gap-2"
                  onClick={handleShowAddMaterialDialog}
                >
                  <Plus className="h-4 w-4" />
                  Initialize Materials
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {/* Show warning if displaying all BOM items instead of selected ones */}
              {selectedBomItems.length === 0 && allBomItems.length === 0 && directBomItems.length > 0 && (
                <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-yellow-600" />
                    <span className="text-sm font-medium text-yellow-900">
                      Showing all BOM items
                    </span>
                  </div>
                  <p className="text-xs text-yellow-800 mt-1">
                    No specific BOM items were selected during lot creation. Showing all {directBomItems.length} items from the BOM as fallback.
                  </p>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-4 mb-6">
                <div className="flex-1">
                  <Label htmlFor="search">Search Materials</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="search"
                      placeholder="Search by part name, number..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 sm:w-96">
                  <div>
                    <Label>Status</Label>
                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                      <SelectTrigger>
                        <SelectValue placeholder="All statuses" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="PLANNING">Planning</SelectItem>
                        <SelectItem value="ORDERED">Ordered</SelectItem>
                        <SelectItem value="APPROVED">Approved</SelectItem>
                        <SelectItem value="IN_USE">In Use</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Criticality</Label>
                    <Select value={filterCriticality} onValueChange={setFilterCriticality}>
                      <SelectTrigger>
                        <SelectValue placeholder="All levels" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Levels</SelectItem>
                        <SelectItem value="CRITICAL">Critical</SelectItem>
                        <SelectItem value="HIGH">High</SelectItem>
                        <SelectItem value="MEDIUM">Medium</SelectItem>
                        <SelectItem value="LOW">Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"></TableHead>
                      <TableHead>Material Details</TableHead>
                      <TableHead>Quantities</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Process Impact</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Alerts</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredBOMItems.map((item: any) => (
                      <React.Fragment key={item.id}>
                        <TableRow className="hover:bg-muted/50">
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="p-0 h-auto"
                              onClick={() => toggleRowExpansion(item.id)}
                            >
                              {expandedRows.has(item.id) ?
                                <ChevronDown className="h-4 w-4" /> :
                                <ChevronRight className="h-4 w-4" />
                              }
                            </Button>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <div className="font-medium">{item.bom_items?.name || item.partName || 'Unknown'}</div>
                              <div className="text-sm text-muted-foreground">{item.bom_items?.part_number || item.partNumber || 'N/A'}</div>
                              <div className="flex gap-1 flex-wrap">
                                <Badge className={`text-xs ${getSeverityColor(item.criticality || 'medium')}`} variant="outline">
                                  {(item.criticality || 'medium').toUpperCase()}
                                </Badge>
                                {item.isSubtaskBom && (
                                  <Badge variant="secondary" className="text-xs">
                                    Subtask BOM
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1 text-sm">
                              <div className="flex justify-between">
                                <span>Required:</span>
                                <span className="font-semibold">{item.required_quantity || 0}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Available:</span>
                                <span className="font-semibold text-green-600">{item.approved_quantity || 0}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Used:</span>
                                <span className="font-semibold text-blue-600">{item.consumed_quantity || 0}</span>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className={getStatusColor(item.material_status || 'planning')}>
                              {(item.material_status || 'planning').toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              {item.processImpact && item.processImpact.length > 0 ? (
                                item.processImpact.map((processName: string, index: number) => {
                                  const process = processProgress.find((p: any) => p.name === processName || processName.includes(p.name));
                                  return (
                                    <Badge
                                      key={`${item.id || item.partNumber}-${processName}-${index}`}
                                      variant="outline"
                                      className={`text-xs ${process ? getStatusColor(process.status) : 'bg-blue-100 text-blue-600'}`}
                                      title={processName}
                                    >
                                      {processName.length > 20 ? `${processName.substring(0, 20)}...` : processName}
                                    </Badge>
                                  );
                                })
                              ) : item.isSubtaskBom ? (
                                <Badge variant="outline" className="text-xs bg-blue-100 text-blue-600">
                                  Subtask Requirement
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">No process assignment</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {item.vendors?.name || item.vendorName || 'Not assigned'}
                          </TableCell>
                          <TableCell>
                            {(item.alerts || []).filter((a: any) => !a.resolved).length > 0 ? (
                              <div className="flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4 text-red-600" />
                                <span className="text-sm font-semibold text-red-800">
                                  {(item.alerts || []).filter((a: any) => !a.resolved).length}
                                </span>
                              </div>
                            ) : (
                              <CheckCircle className="h-4 w-4 text-green-600" />
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setSelectedMaterial(item)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button size="sm" variant="ghost">
                                <Edit className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>

                        {expandedRows.has(item.id) && (
                          <TableRow>
                            <TableCell colSpan={8}>
                              <div className="bg-muted/30 rounded-lg p-4 space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                  <div>
                                    <h4 className="font-medium mb-2">Description</h4>
                                    <p className="text-sm text-muted-foreground">{item.bom_items?.description || item.description || 'No description'}</p>
                                  </div>
                                  <div>
                                    <h4 className="font-medium mb-2">Timeline</h4>
                                    <div className="space-y-1 text-sm">
                                      {item.received_date && (
                                        <div>Received: {new Date(item.received_date).toLocaleDateString()}</div>
                                      )}
                                      {item.expected_delivery_date && (
                                        <div>Expected: {new Date(item.expected_delivery_date).toLocaleDateString()}</div>
                                      )}
                                    </div>
                                  </div>
                                  <div>
                                    <h4 className="font-medium mb-2">Cost</h4>
                                    <div className="space-y-1 text-sm">
                                      <div>Estimated: ₹{(item.estimated_cost || 0).toLocaleString()}</div>
                                      {item.actual_cost && (
                                        <div>Actual: ₹{item.actual_cost.toLocaleString()}</div>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {(item.alerts || []).filter((a: any) => !a.resolved).length > 0 && (
                                  <div>
                                    <h4 className="font-medium mb-2">Active Alerts</h4>
                                    <div className="space-y-2">
                                      {(item.alerts || []).filter((a: any) => !a.resolved).map((alert: any) => (
                                        <div key={alert.id} className="flex items-start gap-3 text-sm p-3 bg-white border rounded">
                                          <AlertCircle className="h-4 w-4 text-orange-600 flex-shrink-0 mt-0.5" />
                                          <div className="flex-1">
                                            <div className="font-semibold">{alert.type}</div>
                                            <div>{alert.message}</div>
                                            {alert.affectedProcesses && (
                                              <div className="text-muted-foreground mt-1">
                                                Affects: {alert.affectedProcesses.join(', ')}
                                              </div>
                                            )}
                                          </div>
                                          <Badge className={getSeverityColor(alert.severity)}>
                                            {alert.severity}
                                          </Badge>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>

                {/* Show message when no materials are available */}
                {filteredBOMItems.length === 0 && materialItems.length === 0 && (
                  <div className="text-center py-8">
                    <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <div className="text-lg font-medium mb-2">No Materials Found</div>
                    <div className="text-muted-foreground space-y-1">
                      <p>This production lot doesn't have any BOM items configured yet.</p>
                      <p>Click "Initialize Materials" to set up material tracking for this lot.</p>
                      {bomId && (
                        <p className="text-xs mt-2">BOM ID: {bomId}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Integrated Production & Material Alerts</CardTitle>
              <CardDescription>
                Unified view of production and material issues requiring attention
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Show message when no materials are available */}
              {materialItems.length === 0 && (
                <div className="text-center py-8">
                  <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <div className="text-lg font-medium mb-2">No Materials Found</div>
                  <div className="text-muted-foreground space-y-1">
                    <p>This production lot doesn't have any BOM items configured yet.</p>
                    <p>Click "Initialize Materials" to set up material tracking for this lot.</p>
                    {bomId && (
                      <p className="text-xs mt-2">BOM ID: {bomId}</p>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-4">
                {integratedAlerts.map((alert) => (
                  <div key={alert.id} className="border border-l-4 border-l-orange-500 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        {getAlertTypeIcon(alert.type)}
                        <div>
                          <h3 className="font-medium">{alert.title}</h3>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge className={getSeverityColor(alert.severity)}>
                              {alert.severity}
                            </Badge>
                            <Badge variant="outline">
                              {alert.source}
                            </Badge>
                            <Badge variant="outline">
                              {alert.type}
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(alert.createdAt).toLocaleDateString()}
                      </div>
                    </div>

                    <div className="space-y-2 text-sm mb-3">
                      <div>
                        <span className="font-medium">Description:</span> {alert.description}
                      </div>
                      <div>
                        <span className="font-medium">Impact:</span> {alert.impact}
                      </div>
                      <div className="bg-blue-50 border border-blue-200 rounded p-2">
                        <span className="font-medium text-blue-800">Suggested Action:</span>
                        <span className="text-blue-700"> {alert.suggestedAction}</span>
                      </div>
                    </div>

                    {alert.relatedItems && alert.relatedItems.length > 0 && (
                      <div className="mb-3">
                        <span className="font-medium text-sm">Related Items:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {alert.relatedItems.map(item => (
                            <Badge key={item} variant="outline" className="text-xs">
                              {item}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleResolveAlert(alert.id, 'Resolved from dashboard')}
                        disabled={resolveRemarkMutation.isPending}
                      >
                        {resolveRemarkMutation.isPending ? 'Resolving...' : 'Resolve'}
                      </Button>
                      <Button size="sm" variant="outline">
                        View Details
                      </Button>
                    </div>
                  </div>
                ))}

                {integratedAlerts.length === 0 && (
                  <div className="text-center py-8">
                    <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
                    <div className="text-lg font-medium mb-2">No Active Issues</div>
                    <div className="text-muted-foreground">
                      All remarks have been resolved or no issues have been reported
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>

      {/* Material Detail Modal */}
      {selectedMaterial && (
        <Dialog open={!!selectedMaterial} onOpenChange={() => setSelectedMaterial(null)}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                {selectedMaterial.partName} - Production Impact View
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center p-3 bg-blue-50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">{selectedMaterial.totalQuantity}</div>
                  <div className="text-sm text-muted-foreground">Required</div>
                </div>
                <div className="text-center p-3 bg-green-50 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">{selectedMaterial.approvedQuantity}</div>
                  <div className="text-sm text-muted-foreground">Available</div>
                </div>
                <div className="text-center p-3 bg-orange-50 rounded-lg">
                  <div className="text-2xl font-bold text-orange-600">{selectedMaterial.consumedQuantity}</div>
                  <div className="text-sm text-muted-foreground">Consumed</div>
                </div>
                <div className="text-center p-3 bg-purple-50 rounded-lg">
                  <div className="text-2xl font-bold text-purple-600">
                    {selectedMaterial.totalQuantity - selectedMaterial.consumedQuantity}
                  </div>
                  <div className="text-sm text-muted-foreground">Remaining</div>
                </div>
              </div>

              <div>
                <h4 className="font-medium mb-3">Process Impact Analysis</h4>
                <div className="space-y-2">
                  {selectedMaterial.processImpact.map((processName: string) => {
                    const process = processProgress.find((p: any) => p.name === processName);
                    return process ? (
                      <div key={processName} className="flex items-center justify-between p-3 border rounded">
                        <div>
                          <div className="font-medium">{processName}</div>
                          <div className="text-sm text-muted-foreground">
                            Progress: {process.progress}% | Material Readiness: {process.materialReadiness}%
                          </div>
                        </div>
                        <Badge className={getStatusColor(process.status)}>
                          {process.status}
                        </Badge>
                      </div>
                    ) : null;
                  })}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedMaterial(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Add Material Dialog */}
      <Dialog open={addMaterialDialogOpen} onOpenChange={setAddMaterialDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Initialize Materials from Selected BOM Items
            </DialogTitle>
            <DialogDescription>
              This will initialize material tracking for the BOM items that are selected for this production lot.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="p-4 bg-blue-50 rounded-lg border">
              <div className="flex items-center gap-2 mb-2">
                <Package className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-medium text-blue-900">What this will do:</span>
              </div>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• Load only the selected BOM items for this production lot</li>
                <li>• Calculate required quantities based on production quantity</li>
                <li>• Set up material tracking for selected items only</li>
                <li>• Enable vendor assignment and status tracking</li>
              </ul>
            </div>

            {materialItems.length > 0 && (
              <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-600" />
                  <span className="text-sm font-medium text-yellow-900">
                    {materialItems.length} materials already loaded
                  </span>
                </div>
                <p className="text-xs text-yellow-800 mt-1">
                  This will refresh and update existing materials with any BOM changes.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddMaterialDialogOpen(false)}
              disabled={initializeMaterialsMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddMaterials}
              disabled={initializeMaterialsMutation.isPending}
              className="flex items-center gap-2"
            >
              {initializeMaterialsMutation.isPending ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Adding Materials...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Add Materials
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};