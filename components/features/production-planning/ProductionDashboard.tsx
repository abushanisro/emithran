'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  TrendingUp,
  Package,
  Factory,
  Clock,
  AlertCircle,
  CheckCircle,
  BarChart3
} from '@/components/ui/icons';
import { Progress } from '@/components/ui/progress';

interface ProductionDashboardProps {
  dashboardData: any;
}

export function ProductionDashboard({ dashboardData }: ProductionDashboardProps) {
  const summary = dashboardData?.summary || {};
  const recentLots = dashboardData?.lots || [];

  const efficiencyColor = (efficiency: number) => {
    if (efficiency >= 90) return 'text-green-600';
    if (efficiency >= 70) return 'text-yellow-600';
    return 'text-red-600';
  };

  const statusConfig = {
    planned: { color: 'bg-primary/10 text-primary', icon: Clock },
    in_production: { color: 'bg-green-100 text-green-800', icon: Factory },
    completed: { color: 'bg-green-200 text-green-900', icon: CheckCircle },
    on_hold: { color: 'bg-yellow-100 text-yellow-800', icon: AlertCircle },
    cancelled: { color: 'bg-red-100 text-red-800', icon: AlertCircle },
  } as const;

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Production</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary.overallProduction?.toLocaleString() || 0}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <TrendingUp className="h-3 w-3 text-green-600" />
              <span className="text-green-600">+12.5%</span>
              vs last month
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Lots</CardTitle>
            <Factory className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.activeLots || 0}</div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>of {summary.totalLots || 0} total lots</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Efficiency</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${efficiencyColor(summary.averageEfficiency || 0)}`}>
              {summary.averageEfficiency || 0}%
            </div>
            <Progress value={summary.averageEfficiency || 0} className="mt-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Quality Rate</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {summary.overallProduction && summary.overallRejected
                ? Math.round(((summary.overallProduction - summary.overallRejected) / summary.overallProduction) * 100)
                : 0}%
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>{summary.overallRejected || 0} rejected units</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Production Status Overview */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Production Status</CardTitle>
            <CardDescription>Current status of all production lots</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-brand-500 rounded-full"></div>
                  <span className="text-sm">Planned</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{summary.plannedLots || 0}</span>
                  <Progress
                    value={summary.totalLots ? (summary.plannedLots / summary.totalLots) * 100 : 0}
                    className="w-16"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <span className="text-sm">In Production</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{summary.activeLots || 0}</span>
                  <Progress
                    value={summary.totalLots ? (summary.activeLots / summary.totalLots) * 100 : 0}
                    className="w-16"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-700 rounded-full"></div>
                  <span className="text-sm">Completed</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{summary.completedLots || 0}</span>
                  <Progress
                    value={summary.totalLots ? (summary.completedLots / summary.totalLots) * 100 : 0}
                    className="w-16"
                  />
                </div>
              </div>

              <div className="pt-4 border-t">
                <div className="text-sm text-muted-foreground">
                  Total Lots: <span className="font-semibold">{summary.totalLots || 0}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Recent Production Lots */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Production Lots</CardTitle>
            <CardDescription>Latest production lots and their status</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentLots.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No production lots found</p>
                </div>
              ) : (
                recentLots.map((lot: any) => {
                  const StatusIcon = statusConfig[lot.status as keyof typeof statusConfig]?.icon || Clock;
                  const statusColor = statusConfig[lot.status as keyof typeof statusConfig]?.color || 'bg-muted text-foreground';

                  return (
                    <div key={lot.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <StatusIcon className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="font-semibold text-sm">{lot.lotNumber}</div>
                          <div className="text-xs text-muted-foreground">
                            {lot.productionQuantity?.toLocaleString()} units
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={`text-xs ${statusColor} border-0`}>
                          {lot.status.replace('_', ' ').toUpperCase()}
                        </Badge>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Performance Metrics */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Performance Metrics</CardTitle>
          <CardDescription>Key production performance indicators</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">On-Time Delivery</span>
                <span className="text-sm font-bold text-green-600">87%</span>
              </div>
              <Progress value={87} className="h-2" />
              <p className="text-xs text-muted-foreground">
                Based on planned vs actual delivery dates
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Resource Utilization</span>
                <span className="text-sm font-bold text-primary">72%</span>
              </div>
              <Progress value={72} className="h-2" />
              <p className="text-xs text-muted-foreground">
                Machine and labor utilization rate
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">First Pass Yield</span>
                <span className="text-sm font-bold text-green-600">94%</span>
              </div>
              <Progress value={94} className="h-2" />
              <p className="text-xs text-muted-foreground">
                Products passed without rework
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Quick Actions</CardTitle>
          <CardDescription>Common production planning tasks</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 border rounded-lg hover:bg-muted/50 cursor-pointer text-center">
              <Package className="h-6 w-6 mx-auto mb-2 text-primary" />
              <div className="text-sm font-semibold">Create Lot</div>
              <div className="text-xs text-muted-foreground">New production lot</div>
            </div>

            <div className="p-4 border rounded-lg hover:bg-muted/50 cursor-pointer text-center">
              <Clock className="h-6 w-6 mx-auto mb-2 text-primary" />
              <div className="text-sm font-semibold">Schedule</div>
              <div className="text-xs text-muted-foreground">Production timeline</div>
            </div>

            <div className="p-4 border rounded-lg hover:bg-muted/50 cursor-pointer text-center">
              <BarChart3 className="h-6 w-6 mx-auto mb-2 text-primary" />
              <div className="text-sm font-semibold">Reports</div>
              <div className="text-xs text-muted-foreground">Performance reports</div>
            </div>

            <div className="p-4 border rounded-lg hover:bg-muted/50 cursor-pointer text-center">
              <CheckCircle className="h-6 w-6 mx-auto mb-2 text-primary" />
              <div className="text-sm font-semibold">Quality</div>
              <div className="text-xs text-muted-foreground">Quality tracking</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}