'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft,
  Calendar,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  DollarSign
} from 'lucide-react';
import { VendorAssignment } from '@/components/features/production-planning/VendorAssignment';
import { ProcessPlanning } from '@/components/features/production-planning/ProcessPlanning';
import { ScheduleView } from '@/components/features/production-planning/ScheduleView';
import { ProductionEntry } from '@/components/features/production-planning/ProductionEntry';
import { RemarksIssues } from '@/components/features/production-planning/RemarksIssues';
import { IntegratedMonitoringBOM } from '@/components/features/production-planning/IntegratedMonitoringBOM';
import { productionPlanningApi } from '@/lib/api/production-planning';

interface LotDetailPageProps {
  params: Promise<{ lotId: string }>;
}

const LotDetailPage = ({ params }: LotDetailPageProps) => {
  const router = useRouter();
  const [lot, setLot] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [lotId, setLotId] = useState<string>('');
  const [tabClickCounts, setTabClickCounts] = useState<Record<string, number>>({});

  // Track tab clicks for analytics and user behavior with schedule name tracking
  const trackTabClick = (tabValue: string, currentLotId: string) => {
    const timestamp = new Date().toISOString();
    const sessionId = typeof window !== 'undefined' ? window.sessionStorage.getItem('sessionId') || 'anonymous' : 'anonymous';
    
    // Update local state for immediate feedback
    setTabClickCounts(prev => ({
      ...prev,
      [tabValue]: (prev[tabValue] || 0) + 1
    }));

    // Enhanced tracking data with schedule details
    const trackingData = {
      event: 'tab_click',
      tab: tabValue,
      lotId: currentLotId,
      lotNumber: lot?.lotNumber || 'Unknown',
      scheduleName: tabValue === 'schedule' ? `${lot?.bomName || 'Unknown'}_${lot?.lotNumber || currentLotId}_Schedule` : null,
      bomName: lot?.bomName || 'Unknown',
      bomVersion: lot?.bomVersion || 'Unknown',
      quantity: lot?.quantity || 0,
      status: lot?.status || 'Unknown',
      priority: lot?.priority || 'Unknown',
      timestamp,
      sessionId,
      userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'server'
    };

    // Log to console for now (replace with actual analytics service)

// Store in localStorage for persistence
    if (typeof window !== 'undefined') {
      const existing = JSON.parse(localStorage.getItem('scheduleTrackingAnalytics') || '[]');
      existing.push(trackingData);
      // Keep only last 100 entries to prevent storage bloat
      if (existing.length > 100) {
        existing.splice(0, existing.length - 100);
      }
      localStorage.setItem('scheduleTrackingAnalytics', JSON.stringify(existing));
    }

    // Enhanced Schedule name tracking
    if (tabValue === 'schedule') {
      const scheduleTrackingEvent = {
        event: 'schedule_name_tracking',
        scheduleName: `${lot?.bomName || 'Unknown'}_${lot?.lotNumber || currentLotId}_Schedule`,
        scheduleIdentifier: {
          lotId: currentLotId,
          lotNumber: lot?.lotNumber || 'Unknown',
          bomName: lot?.bomName || 'Unknown', 
          bomVersion: lot?.bomVersion || 'v1.0',
          type: lot?.type || 'unknown',
          quantity: lot?.quantity || 0
        },
        scheduleContext: {
          startDate: lot?.startDate || null,
          endDate: lot?.endDate || null,
          status: lot?.status || 'Unknown',
          priority: lot?.priority || 'Unknown',
          progress: lot?.progress || 0
        },
        clickCount: (tabClickCounts.schedule || 0) + 1,
        timestamp,
        sessionId
      };

// Store schedule-specific tracking separately
      if (typeof window !== 'undefined') {
        const scheduleHistory = JSON.parse(localStorage.getItem('scheduleNameHistory') || '[]');
        scheduleHistory.push(scheduleTrackingEvent);
        if (scheduleHistory.length > 50) {
          scheduleHistory.splice(0, scheduleHistory.length - 50);
        }
        localStorage.setItem('scheduleNameHistory', JSON.stringify(scheduleHistory));
        
        // Also track unique schedule names accessed
        const uniqueSchedules = JSON.parse(localStorage.getItem('uniqueScheduleNames') || '[]');
        const scheduleName = scheduleTrackingEvent.scheduleName;
        if (!uniqueSchedules.includes(scheduleName)) {
          uniqueSchedules.push(scheduleName);
          localStorage.setItem('uniqueScheduleNames', JSON.stringify(uniqueSchedules));
          
        }
      }
    }
  };

  useEffect(() => {
    const initializeParams = async () => {
      const resolvedParams = await params;
      setLotId(resolvedParams.lotId);
    };
    
    initializeParams();
  }, [params]);

  useEffect(() => {
    if (!lotId) return;
    
    const fetchLotDetails = async () => {
      try {
        setLoading(true);
        
        // Fetch lot details
        
        const lotResponse = await productionPlanningApi.getProductionLotById(lotId) as any;

// Fetch processes for this lot
        
        const processesRaw = await productionPlanningApi.getProcessesByLot(lotId);
        const processesResponse: any[] = Array.isArray(processesRaw) ? processesRaw : [];

        // Calculate real statistics from processes and subtasks
        const processCount = processesResponse.length;
        const completedProcesses = processesResponse.filter((p: any) => p.status === 'COMPLETED').length;
        const inProgressProcesses = processesResponse.filter((p: any) => p.status === 'IN_PROGRESS').length;
        
        // Include subtasks in progress calculation for more granular tracking
        let totalTasks = processCount;
        let completedTasks = completedProcesses;
        
        processesResponse.forEach((process: any) => {
          const subtasks = process.subtasks || [];
          totalTasks += subtasks.length;
          completedTasks += subtasks.filter((st: any) => st.status === 'COMPLETED').length;
        });
        
        // Calculate progress percentage based on total tasks (processes + subtasks)
        const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
        
        console.log('Progress Calculation:', {
          processCount,
          completedProcesses,
          totalTasks,
          completedTasks,
          progress: `${progress}%`
        });
        
        // Calculate total estimated hours from all processes and subtasks
        const totalEstimatedHours = processesResponse.reduce((total: number, process: any) => {
          const processHours = process.estimated_hours || process.estimatedHours || 0;
          const subtaskHours = (process.subtasks || []).reduce((subSum: number, subtask: any) => 
            subSum + (subtask.estimated_hours || subtask.estimatedHours || 0), 0);
          return total + processHours + subtaskHours;
        }, 0) || 0;
        
        // Calculate actual hours (if tracking is implemented)
        const totalActualHours = processesResponse.reduce((total: number, process: any) => {
          const processHours = process.actual_hours || process.actualHours || 0;
          const subtaskHours = (process.subtasks || []).reduce((subSum: number, subtask: any) => 
            subSum + (subtask.actual_hours || subtask.actualHours || 0), 0);
          return total + processHours + subtaskHours;
        }, 0) || 0;
        
        // Calculate material costs from BOM requirements
        let totalMaterialCost = 0;
        processesResponse.forEach((process: any) => {
          (process.subtasks || []).forEach((subtask: any) => {
            (subtask.bom_requirements || subtask.bomRequirements || []).forEach((bomPart: any) => {
              const quantity = bomPart.required_quantity || bomPart.requiredQuantity || 0;
              const unitCost = bomPart.unit_cost || bomPart.unitCost || 0;
              totalMaterialCost += quantity * unitCost;
            });
          });
        });
        
        const realLotData = {
          id: lotResponse?.id || lotId,
          lotNumber: lotResponse?.lot_number || lotResponse?.lotNumber || `LOT-${lotId.slice(0, 8)}`,
          type: lotResponse?.lot_type || lotResponse?.type || 'production',
          bomName: lotResponse?.bom_name || lotResponse?.bomName,
          bomVersion: lotResponse?.bom_version || lotResponse?.bomVersion,
          quantity: lotResponse?.quantity,
          status: lotResponse?.status?.toUpperCase(),
          priority: lotResponse?.priority?.toUpperCase(),
          startDate: lotResponse?.start_date || lotResponse?.startDate || new Date().toISOString().split('T')[0],
          endDate: lotResponse?.due_date || lotResponse?.dueDate || lotResponse?.endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          progress: progress,
          totalCost: totalMaterialCost,
          materialCost: totalMaterialCost,
          processCount: processCount,
          completedProcesses: completedProcesses,
          inProgressProcesses: inProgressProcesses,
          totalTasks: totalTasks,
          completedTasks: completedTasks,
          totalEstimatedHours: totalEstimatedHours,
          totalActualHours: totalActualHours
        };
        
        setLot(realLotData);
        setLoading(false);
      } catch (error) {
        console.error('Error fetching lot details:', error);
        // Fallback to basic data if API fails
        // Show error state instead of fallback data
        console.error('Failed to fetch lot data:', error);
        setLot(null);
        setLoading(false);
      }
    };

    fetchLotDetails();
  }, [lotId]);

  const getStatusColor = (status: string) => {
    const colors = {
      PLANNED: 'bg-blue-100 text-blue-600',
      IN_PROGRESS: 'bg-yellow-100 text-yellow-600',
      COMPLETED: 'bg-green-100 text-green-600',
      ON_HOLD: 'bg-red-100 text-red-600'
    };
    return colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-600';
  };

  const getPriorityColor = (priority: string) => {
    const colors = {
      HIGH: 'bg-red-100 text-red-600',
      MEDIUM: 'bg-yellow-100 text-yellow-600',
      LOW: 'bg-green-100 text-green-600'
    };
    return colors[priority as keyof typeof colors] || 'bg-gray-100 text-gray-600';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!lot) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <AlertTriangle className="h-16 w-16 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">Lot Not Found</h2>
        <p className="text-muted-foreground mb-4">The requested lot could not be found.</p>
        <Button onClick={() => router.back()}>Go Back</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => router.back()}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{lot.lotNumber}</h1>
            <Badge variant="secondary" className="text-xs">
              {lot.type}
            </Badge>
          </div>
          <p className="text-muted-foreground">
            {lot.bomName} v{lot.bomVersion} • {lot.quantity} units
          </p>
        </div>
      </div>

      {/* INTEGRATED MONITORING & MATERIALS - TOP OF LOT DETAIL */}
      <div className="mb-6">
        <IntegratedMonitoringBOM lotId={lotId} />
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <Badge className={getStatusColor(lot.status)}>
              {lot.status || 'Status not set'}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Priority</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <Badge className={getPriorityColor(lot.priority)}>
              {lot.priority || 'Priority not set'}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Progress</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Progress value={lot.progress || 0} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {lot.totalTasks > 0 
                  ? `${lot.completedTasks || 0} / ${lot.totalTasks || 0} tasks (${lot.completedProcesses || 0} / ${lot.processCount || 0} processes)`
                  : 'Processes are being set up'
                }
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <div className="text-2xl font-bold">${(lot.totalCost || 0).toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">
                {lot.totalCost > 0 
                  ? `Material: $${(lot.materialCost || 0).toLocaleString()}`
                  : 'Cost calculation in progress'
                }
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Hours</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <div className="text-2xl font-bold">{lot.totalEstimatedHours || 0}h</div>
              <p className="text-xs text-muted-foreground">
                Estimated: {lot.totalEstimatedHours || 0}h | Actual: {lot.totalActualHours || 0}h
              </p>
              <p className="text-xs text-blue-600">
                View detailed breakdown in Tracking tab
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Timeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="text-center">
              <p className="text-sm font-medium">Start Date</p>
              <p className="text-sm text-muted-foreground">
                {new Date(lot.startDate).toLocaleDateString()}
              </p>
            </div>
            <Separator orientation="horizontal" className="flex-1 mx-4" />
            <div className="text-center">
              <p className="text-sm font-medium">End Date</p>
              <p className="text-sm text-muted-foreground">
                {new Date(lot.endDate).toLocaleDateString()}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Content Tabs */}
      <Tabs defaultValue="vendors" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="vendors" onClick={() => trackTabClick('vendors', lotId)}>Vendors</TabsTrigger>
          <TabsTrigger value="processes" onClick={() => trackTabClick('processes', lotId)}>Processes</TabsTrigger>
          <TabsTrigger 
            value="schedule" 
            onClick={() => trackTabClick('schedule', lotId)}
            className="relative"
            title={`Tracking: ${lot?.bomName || 'Unknown'}_${lot?.lotNumber || lotId}_Schedule`}
          >
            Tracking
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full animate-pulse" />
            {(tabClickCounts['schedule'] ?? 0) > 0 && (
              <span className="absolute -bottom-1 -right-1 text-xs bg-primary text-primary-foreground px-1 rounded-full min-w-[16px] h-4 flex items-center justify-center">
                {tabClickCounts.schedule}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="production" onClick={() => trackTabClick('production', lotId)}>Production</TabsTrigger>
          <TabsTrigger value="remarks" onClick={() => trackTabClick('remarks', lotId)}>Remarks</TabsTrigger>
        </TabsList>

        <TabsContent value="vendors">
          <VendorAssignment lotId={lotId} />
        </TabsContent>

        <TabsContent value="processes">
          <ProcessPlanning lotId={lotId} />
        </TabsContent>

        <TabsContent value="schedule">
          <ScheduleView lotId={lotId} />
        </TabsContent>

        <TabsContent value="production">
          <ProductionEntry lotId={lotId} />
        </TabsContent>

        <TabsContent value="remarks">
          <RemarksIssues lotId={lotId} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default LotDetailPage;