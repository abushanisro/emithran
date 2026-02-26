'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { WorkflowNavigation } from '@/components/features/workflow/WorkflowNavigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Factory, Calendar, TrendingUp, Clock, Package, ArrowLeft } from 'lucide-react';
import { ProductionLotsTable } from '@/components/features/production-planning/ProductionLotsTable';
import { CreateProductionLotModal } from '@/components/features/production-planning/CreateProductionLotModal';
import { ProductionDashboard } from '@/components/features/production-planning/ProductionDashboard';
import { useProductionLots, useProductionDashboard } from '@/lib/api/hooks/useProductionPlanning';
import { useProject } from '@/lib/api/hooks/useProjects';
import { useBOMs } from '@/lib/api/hooks/useBOM';
import Link from 'next/link';

interface ProductionLot {
  id: string;
  bomId: string;
  status: string;
  priority?: string;
  totalEstimatedCost: number;
  productionQuantity: number;
  [key: string]: any;
}

export default function ProjectProductionPlanningPage() {
  const params = useParams();
  const projectId = params.id as string;

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');

  // Get project details
  const { data: project } = useProject(projectId);

  // Get project BOMs to filter production lots
  const { data: bomsData } = useBOMs();
  const projectBOMs = bomsData?.boms?.filter(bom => bom.projectId === projectId) || [];
  const projectBOMIds = projectBOMs.map(bom => bom.id);

  // Get production lots (filter by project BOMs)
  const { data: allLots = [], isLoading } = useProductionLots({
    status: statusFilter === 'all' ? undefined : statusFilter,
    priority: priorityFilter === 'all' ? undefined : priorityFilter,
  });

  // Filter lots to only show ones for this project's BOMs
  const lots = allLots.filter((lot: ProductionLot) => projectBOMIds.includes(lot.bomId));

  useProductionDashboard(); // kept for potential future use / side-effects

  const statusCounts = {
    planned: lots.filter((lot: ProductionLot) => lot.status === 'planned').length,
    in_production: lots.filter((lot: ProductionLot) => lot.status === 'in_production').length,
    completed: lots.filter((lot: ProductionLot) => lot.status === 'completed').length,
    on_hold: lots.filter((lot: ProductionLot) => lot.status === 'on_hold').length,
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-[1800px] mx-auto space-y-6">
        {/* BREADCRUMB & HEADER */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Link
                href={`/projects/${projectId}`}
                className="flex items-center gap-1 hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-3 w-3" />
                Back to Project
              </Link>
              <span>/</span>
              <span>Production Planning</span>
            </div>
            <h1 className="text-2xl font-bold text-foreground">
              Production Planning - {project?.name || 'Project'}
            </h1>
            <p className="text-sm text-muted-foreground">
              Manage production lots for {project?.name || 'this project'}
            </p>
          </div>
          <Button onClick={() => setCreateDialogOpen(true)} className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Create Production Lot
          </Button>
        </div>

        {/* PROJECT INFO CARD */}
        {project && (
          <Card className="border-l-4 border-l-primary">
            <CardHeader>
              <CardTitle className="text-lg">Project Information</CardTitle>
              <CardDescription>Production planning context for this project</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Project Name</p>
                  <p className="text-sm font-semibold">{project.name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Available BOMs</p>
                  <p className="text-sm font-semibold">{projectBOMs.length} BOMs</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Production Lots</p>
                  <p className="text-sm font-semibold">{lots.length} Lots</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Location</p>
                  <p className="text-sm font-semibold">
                    {project.city && project.state ? `${project.city}, ${project.state}` :
                      project.country || 'Not specified'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* DASHBOARD CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Project Lots</CardTitle>
              <Factory className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{lots.length}</div>
              <p className="text-xs text-muted-foreground">
                from {projectBOMs.length} BOMs
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">In Production</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{statusCounts.in_production}</div>
              <p className="text-xs text-muted-foreground">
                {lots.length > 0 ? Math.round((statusCounts.in_production / lots.length) * 100) : 0}% of project lots
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Completed</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{statusCounts.completed}</div>
              <p className="text-xs text-muted-foreground">
                {lots.length > 0 ? Math.round((statusCounts.completed / lots.length) * 100) : 0}% completion rate
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Value</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                ₹{lots.reduce((sum: number, lot: ProductionLot) => sum + lot.totalEstimatedCost, 0).toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground">
                Estimated production value
              </p>
            </CardContent>
          </Card>
        </div>

        {/* MAIN CONTENT TABS */}
        <Tabs defaultValue="lots" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="lots">Production Lots</TabsTrigger>
            <TabsTrigger value="dashboard">Project Analytics</TabsTrigger>
            <TabsTrigger value="calendar">Production Schedule</TabsTrigger>
          </TabsList>

          <TabsContent value="lots" className="space-y-6">
            {/* FILTERS */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Filter Production Lots</CardTitle>
                <CardDescription>
                  Filter by status, priority, or other criteria for this project
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Status</label>
                    <div className="flex gap-2">
                      {[
                        { value: 'all', label: 'All', count: lots.length },
                        { value: 'planned', label: 'Planned', count: statusCounts.planned },
                        { value: 'in_production', label: 'In Production', count: statusCounts.in_production },
                        { value: 'completed', label: 'Completed', count: statusCounts.completed },
                        { value: 'on_hold', label: 'On Hold', count: statusCounts.on_hold },
                      ].map((status) => (
                        <Badge
                          key={status.value}
                          variant={statusFilter === status.value ? 'default' : 'outline'}
                          className="cursor-pointer hover:bg-primary/80"
                          onClick={() => setStatusFilter(status.value)}
                        >
                          {status.label} ({status.count})
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Priority</label>
                    <div className="flex gap-2">
                      {[
                        { value: 'all', label: 'All Priorities' },
                        { value: 'urgent', label: 'Urgent' },
                        { value: 'high', label: 'High' },
                        { value: 'medium', label: 'Medium' },
                        { value: 'low', label: 'Low' },
                      ].map((priority) => (
                        <Badge
                          key={priority.value}
                          variant={priorityFilter === priority.value ? 'default' : 'outline'}
                          className="cursor-pointer hover:bg-primary/80"
                          onClick={() => setPriorityFilter(priority.value)}
                        >
                          {priority.label}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* LOTS TABLE */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Production Lots</CardTitle>
                <CardDescription>
                  Production lots for {project?.name || 'this project'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {projectBOMs.length === 0 ? (
                  <div className="text-center py-12">
                    <Package className="h-16 w-16 mx-auto text-muted-foreground mb-4 opacity-50" />
                    <h3 className="text-lg font-semibold text-muted-foreground mb-2">No BOMs Available</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      This project doesn't have any BOMs yet. Create a BOM first to start production planning.
                    </p>
                    <Link href={`/projects/${projectId}/bom`}>
                      <Button>Manage BOMs</Button>
                    </Link>
                  </div>
                ) : (
                  <ProductionLotsTable lots={lots} isLoading={isLoading} />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="dashboard" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Project Production Analytics</CardTitle>
                <CardDescription>
                  Production performance metrics for {project?.name || 'this project'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {lots.length > 0 ? (
                  <ProductionDashboard dashboardData={{
                    summary: {
                      totalLots: lots.length,
                      activeLots: statusCounts.in_production,
                      completedLots: statusCounts.completed,
                      plannedLots: statusCounts.planned,
                      overallProduction: lots.reduce((sum: number, lot: ProductionLot) => sum + lot.productionQuantity, 0),
                      averageEfficiency: 85, // Calculate from actual data
                    },
                    lots: lots.slice(0, 5)
                  }} />
                ) : (
                  <div className="text-center py-12">
                    <TrendingUp className="h-16 w-16 mx-auto text-muted-foreground mb-4 opacity-50" />
                    <h3 className="text-lg font-semibold text-muted-foreground mb-2">No Production Data</h3>
                    <p className="text-sm text-muted-foreground">
                      Create some production lots to see analytics and performance metrics.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="calendar" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Production Schedule</CardTitle>
                <CardDescription>
                  Timeline view of production activities for {project?.name || 'this project'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center h-96 text-muted-foreground">
                  <div className="text-center space-y-2">
                    <Calendar className="h-16 w-16 mx-auto opacity-50" />
                    <p>Project Production Timeline</p>
                    <p className="text-sm">Coming Soon - Gantt Chart and Project Schedule View</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* CREATE MODAL - Only show project BOMs */}
        <CreateProductionLotModal
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          projectId={projectId}
        />

        {/* Workflow Navigation */}
        <WorkflowNavigation
          currentModuleId="production-planning"
          projectId={projectId}
        />
      </div>
    </div>
  );
}