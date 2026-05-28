'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Factory, Calendar, TrendingUp, Clock, Package } from 'lucide-react';
import { ProductionLotsTable } from '@/components/features/production-planning/ProductionLotsTable';
import { CreateProductionLotModal } from '@/components/features/production-planning/CreateProductionLotModal';
import { ProductionDashboard } from '@/components/features/production-planning/ProductionDashboard';
import { useProductionLots, useProductionDashboard } from '@/lib/api/hooks/useProductionPlanning';

export default function ProductionPlanningPage() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');

  const { data: lots = [], isLoading } = useProductionLots({
    status: statusFilter === 'all' ? undefined : statusFilter,
    priority: priorityFilter === 'all' ? undefined : priorityFilter,
  });

  const { data: dashboardData } = useProductionDashboard();

  const statusCounts = {
    planned: lots.filter((lot: any) => lot.status === 'planned').length,
    in_production: lots.filter((lot: any) => lot.status === 'in_production').length,
    completed: lots.filter((lot: any) => lot.status === 'completed').length,
    on_hold: lots.filter((lot: any) => lot.status === 'on_hold').length,
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-[1800px] mx-auto space-y-6">
        {/* PAGE HEADER */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Production Planning</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage production lots, assign vendors, and track manufacturing progress
            </p>
          </div>
          <Button onClick={() => setCreateDialogOpen(true)} className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Create Production Lot
          </Button>
        </div>

        {/* DASHBOARD CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Lots</CardTitle>
              <Factory className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{lots.length}</div>
              <p className="text-xs text-muted-foreground">
                {dashboardData?.summary?.activeLots || 0} active
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
                {Math.round((statusCounts.in_production / lots.length) * 100) || 0}% of total
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
                +12% from last month
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Efficiency</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {dashboardData?.summary?.averageEfficiency || 0}%
              </div>
              <p className="text-xs text-muted-foreground">
                Average production efficiency
              </p>
            </CardContent>
          </Card>
        </div>

        {/* MAIN CONTENT TABS */}
        <Tabs defaultValue="lots" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="lots">Production Lots</TabsTrigger>
            <TabsTrigger value="dashboard">Analytics Dashboard</TabsTrigger>
            <TabsTrigger value="calendar">Production Calendar</TabsTrigger>
          </TabsList>

          <TabsContent value="lots" className="space-y-6">
            {/* FILTERS */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Filter Production Lots</CardTitle>
                <CardDescription>
                  Filter by status, priority, or other criteria
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
                  Manage your production lots and track their progress
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ProductionLotsTable lots={lots} isLoading={isLoading} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="dashboard" className="space-y-6">
            <ProductionDashboard dashboardData={dashboardData} />
          </TabsContent>

          <TabsContent value="calendar" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Production Calendar</CardTitle>
                <CardDescription>
                  View production schedules and timelines
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center h-96 text-muted-foreground">
                  <div className="text-center space-y-2">
                    <Calendar className="h-16 w-16 mx-auto opacity-50" />
                    <p>Production Calendar View</p>
                    <p className="text-sm">Coming Soon - Gantt Chart and Calendar Integration</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* CREATE MODAL */}
        <CreateProductionLotModal
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
        />
      </div>
    </div>
  );
}