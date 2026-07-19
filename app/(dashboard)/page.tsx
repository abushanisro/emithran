'use client';

import { PageHeader } from '@/components/layout/PageHeader';

import { StatusBadge } from '@/components/common/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Plus,
  ArrowRight,
  BarChart3,
  Package,
  Layers,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useProjects, useVendors, useRawMaterials, useMHRRecords, useLHR } from '@/lib/api/hooks';
import dynamic from 'next/dynamic';

// Lazy load heavy chart components
const CostChart = dynamic(() => import('@/components/features/dashboard/charts').then(mod => ({ default: mod.CostChart })), {
  loading: () => <ChartSkeleton />,
  ssr: false,
});

const StatusPieChart = dynamic(() => import('@/components/features/dashboard/charts').then(mod => ({ default: mod.StatusPieChart })), {
  loading: () => <div className="h-48"><Skeleton className="h-full w-full" /></div>,
  ssr: false,
});

const ManufacturingPerformanceChart = dynamic(() => import('@/components/features/dashboard/charts').then(mod => ({ default: mod.ManufacturingPerformanceChart })), {
  loading: () => <ChartSkeleton />,
  ssr: false,
});

const ProjectTrendChart = dynamic(() => import('@/components/features/dashboard/charts').then(mod => ({ default: mod.ProjectTrendChart })), {
  loading: () => <ChartSkeleton />,
  ssr: false,
});

const CostSavingsChart = dynamic(() => import('@/components/features/dashboard/charts').then(mod => ({ default: mod.CostSavingsChart })), {
  loading: () => <ChartSkeleton />,
  ssr: false,
});

function ChartSkeleton() {
  return <div className="h-72"><Skeleton className="h-full w-full" /></div>;
}

// Manufacturing modules with real data integration
const getManufacturingModules = (projects: any[]) => [
  {
    id: 'bom',
    title: 'BOM Management',
    description: 'Bills of Materials with assembly hierarchies and technical drawings',
    path: '/bom',
    stats: {
      active: projects.filter(p => ['draft', 'active'].includes(p.status)).length,
      total: projects.length,
      value: projects.reduce((sum, p) => sum + (Number(p.targetBomCost) || 0), 0),
    },
  },
  {
    id: 'process-planning',
    title: 'Process Planning & Costing',
    description: 'Manufacturing processes, material selection, and cost estimation',
    path: '/process-planning',
    stats: {
      active: projects.filter(p => p.status === 'active').length,
      total: projects.length,
      value: projects.reduce((sum, p) => sum + (Number(p.actualCost) || 0), 0),
    },
  },
  {
    id: 'supplier-evaluation',
    title: 'Supplier Evaluation',
    description: 'Technical feasibility assessment and supplier shortlisting',
    path: '/supplier-evaluation',
    stats: {
      active: projects.filter(p => p.status === 'active').length,
      total: projects.length,
      value: projects.reduce((sum, p) => sum + Math.max(0, (Number(p.targetBomCost) || 0) - (Number(p.actualCost) || 0)), 0),
    },
  },
  {
    id: 'supplier-nomination',
    title: 'Supplier Nomination',
    description: 'Cost analysis and weighted scoring for supplier selection',
    path: '/supplier-nominations',
    stats: {
      active: projects.filter(p => ['active', 'on_hold'].includes(p.status)).length,
      total: projects.length,
      value: projects.filter(p => p.status === 'active').reduce((sum, p) => sum + (Number(p.targetBomCost) || 0), 0),
    },
  },
  {
    id: 'production-planning',
    title: 'Production Planning',
    description: 'ISIR/FIA sample submission and PPAP lot management',
    path: '/production-planning',
    stats: {
      active: projects.filter(p => ['active', 'completed'].includes(p.status)).length,
      total: projects.length,
      value: projects.filter(p => p.status === 'completed').reduce((sum, p) => sum + (Number(p.targetBomCost) || 0), 0),
    },
  },
  {
    id: 'quality-control',
    title: 'Quality Control',
    description: 'Quality inspections, testing protocols, and compliance',
    path: '/quality-control',
    stats: {
      active: projects.filter(p => ['active', 'completed'].includes(p.status)).length,
      total: projects.length,
      value: projects.filter(p => p.status === 'completed').reduce((sum, p) => sum + (Number(p.actualCost) || 0), 0),
    },
  },
  {
    id: 'delivery',
    title: 'Delivery Management',
    description: 'Packing, logistics and delivery tracking coordination',
    path: '/delivery',
    stats: {
      active: projects.filter(p => p.status === 'completed').length,
      total: projects.length,
      value: projects.filter(p => p.status === 'completed').reduce((sum, p) => sum + (Number(p.targetBomCost) || 0), 0),
    },
  },
];

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  completed: 'Completed',
  on_hold: 'On Hold',
  cancelled: 'Cancelled',
};

export default function DashboardPage() {
  const router = useRouter();
  const { data: projectsData } = useProjects({ limit: 100 });
  const { data: vendorsData } = useVendors();
  const { data: rawMaterialsData } = useRawMaterials();
  const { data: mhrData } = useMHRRecords();
  const { data: lhrData } = useLHR();

  const projects = projectsData?.projects || [];
  const vendors = vendorsData?.vendors || [];
  const rawMaterials = rawMaterialsData?.items || [];
  const mhrRecords = mhrData?.records || [];
  const lhrRecords = lhrData?.records ?? [];

  const manufacturingModules = getManufacturingModules(projects);

  // Status distribution (non-zero statuses only)
  const statusDistribution = Object.keys(STATUS_LABELS)
    .map(s => ({
      status: s,
      label: STATUS_LABELS[s],
      count: projects.filter(p => p.status === s).length,
    }))
    .filter(s => s.count > 0);

  // Cost summary — target = targetBomCost (the field actually set on creation)
  //                should  = actualCost (derived from BOM item costs via enrichment)
  const totalTarget = projects.reduce((sum, p) => sum + (Number(p.targetBomCost) || 0), 0);
  const totalActual = projects.reduce((sum, p) => sum + (Number(p.actualCost) || 0), 0);
  const totalBomItems = projects.reduce((sum, p) => sum + (Number(p.bomItemCount) || 0), 0);
  const savings = totalTarget - totalActual;
  const savingsPercent = totalTarget > 0 ? ((savings / totalTarget) * 100).toFixed(1) : '0';

  // System efficiency — reflects how thoroughly the manufacturing data is populated.
  // Components:
  //   40% BOM cost coverage  — fraction of BOM items that have at least one cost record
  //   30% Resource readiness — vendors + raw materials + MHR + LHR data present (max 30)
  //   30% Project maturity   — draft=0.1, active=0.6, completed=1.0 weighted average
  const totalBomItemsForEff = totalBomItems; // already computed above
  const itemsWithCost = projects.reduce((s, p) => s + Math.min(Number(p.bomItemCount) || 0, (Number(p.actualCost) || 0) > 0 ? Number(p.bomItemCount) : 0), 0);
  const costCoverage = totalBomItemsForEff > 0
    ? Math.min(100, (itemsWithCost / totalBomItemsForEff) * 100) * 0.4
    : (totalBomItemsForEff === 0 && projects.length > 0 ? 0 : 0);

  const resourceScore = Math.min(30,
    (vendors.length > 0 ? 8 : 0) +
    (rawMaterials.length > 0 ? 8 : 0) +
    (mhrRecords.length > 0 ? 7 : 0) +
    (lhrRecords.length > 0 ? 7 : 0)
  );

  const maturityWeightMap: Record<string, number> = {
    draft: 0.1, active: 0.6, completed: 1.0, on_hold: 0.3, cancelled: 0.0,
  };
  const maturityScore = projects.length > 0
    ? (projects.reduce((s, p) => s + (maturityWeightMap[p.status] ?? 0.1), 0) / projects.length) * 30
    : 0;

  let systemEfficiency = 0;
  if (projects.length > 0) {
    systemEfficiency = costCoverage + resourceScore + maturityScore;
    // Ensure a floor of 10% when there is any data at all
    if (systemEfficiency < 10 && (vendors.length + rawMaterials.length + mhrRecords.length + lhrRecords.length + totalBomItemsForEff) > 0) {
      systemEfficiency = 10;
    }
  }

  // Project trend data (last 30 days, daily buckets for x-axis)
  const projectTrendData = Array.from({ length: 7 }, (_, index) => {
    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() - (6 - index) * 7);
    const weekProjects = projects.filter(p => {
      const projectDate = new Date(p.createdAt || Date.now());
      return projectDate >= baseDate && projectDate < new Date(baseDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    });
    return { value: weekProjects.length, period: index };
  });

  // Enrich projects for chart — map actualCost → shouldCost for chart components
  const projectsForCharts = projects.map(p => ({
    ...p,
    targetPrice: p.targetBomCost ?? 0,
    shouldCost: p.actualCost ?? 0,
  }));

  return (
    <div className="space-y-8 animate-fade-in">
      <PageHeader
        title="Manufacturing Control Center"
        description="Comprehensive manufacturing cost analysis and project orchestration"
      >
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => router.push('/projects')}>
            <BarChart3 className="h-4 w-4 mr-2" />
            Analytics
          </Button>
          <Link href="/projects">
            <Button className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg">
              <Plus className="h-4 w-4 mr-2" />
              New Project
            </Button>
          </Link>
        </div>
      </PageHeader>

      {/* Executive KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="border-border/50 bg-card">
          <CardContent className="p-6">
            <div className="space-y-4">
              <div className="text-center">
                <p className="text-3xl font-bold text-primary">{projects.length}</p>
                <p className="text-sm text-muted-foreground">Total Projects</p>
                <div className="mt-2 h-12">
                  <div className="flex items-end justify-center space-x-1 h-full">
                    {projectTrendData.map((data, i) => (
                      <div
                        key={i}
                        className="bg-primary/60 rounded-sm"
                        style={{
                          height: `${Math.max(8, (data.value / Math.max(...projectTrendData.map(d => d.value), 1)) * 48)}px`,
                          width: '8px',
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card">
          <CardContent className="p-6">
            <div className="text-center space-y-2">
              <p className="text-3xl font-bold text-green-600">{systemEfficiency.toFixed(1)}%</p>
              <p className="text-sm text-muted-foreground">System Efficiency</p>
              <div className="w-full bg-secondary rounded-full h-2">
                <div
                  className="bg-green-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${systemEfficiency}%` }}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                <div className="text-center">
                  <p className="font-semibold text-primary">{totalBomItems}</p>
                  <p className="text-muted-foreground">BOM Items</p>
                </div>
                <div className="text-center">
                  <p className="font-semibold text-purple-600">
                    {projects.reduce((s, p) => s + (p.bomCount || 0), 0)}
                  </p>
                  <p className="text-muted-foreground">BOMs</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card">
          <CardContent className="p-6">
            <div className="text-center space-y-2">
              <p className="text-3xl font-bold text-purple-600">{vendorsData?.total || vendors.length}</p>
              <p className="text-sm text-muted-foreground">Total Vendors</p>
              <div className="grid grid-cols-3 gap-1 text-xs mt-2">
                <div className="text-center">
                  <p className="font-semibold">{vendorsData?.total || vendors.filter(v => v.status === 'active').length}</p>
                  <p className="text-muted-foreground">Active</p>
                </div>
                <div className="text-center">
                  <p className="font-semibold">{vendors.filter(v => v.status === 'pending').length}</p>
                  <p className="text-muted-foreground">Pending</p>
                </div>
                <div className="text-center">
                  <p className="font-semibold">{vendors.filter(v => v.status === 'inactive').length}</p>
                  <p className="text-muted-foreground">Inactive</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card">
          <CardContent className="p-6">
            <div className="text-center space-y-2">
              <p className="text-3xl font-bold text-green-600">
                {savings >= 0 ? '+' : ''}{savings.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-sm text-muted-foreground">Cost Savings</p>
              <p className="text-lg font-semibold text-green-600">{savingsPercent}%</p>
              <p className="text-xs text-muted-foreground">
                Target vs Actual BOM Cost
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Manufacturing Performance Overview */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Manufacturing Performance Analytics</h2>
            <p className="text-muted-foreground">Real-time performance metrics across all manufacturing modules</p>
          </div>
          <div className="flex items-center space-x-4">
            <Badge variant="secondary" className="px-3 py-1">
              {manufacturingModules.length} Active Modules
            </Badge>
            <Badge variant="outline" className="px-3 py-1">
              {(totalTarget / 1000).toFixed(0)}K Portfolio Value
            </Badge>
          </div>
        </div>

        <Card className="border-border/50 bg-card">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold">
              Module Performance & Efficiency Analysis
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Active vs Total projects with efficiency trends across manufacturing modules
            </p>
          </CardHeader>
          <CardContent>
            <ManufacturingPerformanceChart modules={manufacturingModules} />
          </CardContent>
        </Card>
      </div>

      {/* Advanced Analytics Dashboard */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Project Pipeline & Trends */}
        <div className="space-y-6">
          <Card className="border-border/50 bg-card">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-semibold">Project Trend Analysis</CardTitle>
                <Badge variant="outline" className="px-3 py-1">Last 30 Days</Badge>
              </div>
              <p className="text-sm text-muted-foreground">Project creation trends and volume analytics</p>
            </CardHeader>
            <CardContent>
              <ProjectTrendChart projects={projects} />
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold">Cost Savings Analysis</CardTitle>
              <p className="text-sm text-muted-foreground">
                Project-wise cost optimization — target BOM cost vs actual BOM cost
              </p>
            </CardHeader>
            <CardContent>
              <CostSavingsChart projects={projectsForCharts} />
            </CardContent>
          </Card>
        </div>

        {/* Status & Pipeline Overview */}
        <div className="space-y-6">
          <Card className="border-border/50 bg-card">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold">Project Status Distribution</CardTitle>
              <p className="text-sm text-muted-foreground">Current project status breakdown with percentage distribution</p>
            </CardHeader>
            <CardContent>
              {statusDistribution.length > 0 ? (
                <StatusPieChart statusDistribution={statusDistribution} />
              ) : (
                <div className="h-48 flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <div className="h-12 w-12 rounded-full bg-muted/20 flex items-center justify-center mx-auto mb-3">
                      <div className="w-6 h-6 border-2 border-muted/50 rounded-full" />
                    </div>
                    <p className="text-sm">No project status data available</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-semibold">Active Project Pipeline</CardTitle>
                <Link href="/projects" className="text-sm text-primary hover:underline flex items-center gap-1">
                  View all <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {projects.length > 0 ? (
                <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                  {projects.slice(0, 4).map((project) => (
                    <div
                      key={project.id}
                      className="p-3 rounded-lg border border-border/50 bg-secondary/20 hover:border-primary/30 hover:bg-primary/5 transition-all duration-200 cursor-pointer"
                      onClick={() => router.push(`/projects/${project.id}`)}
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-sm text-foreground line-clamp-1">{project.name}</p>
                          <StatusBadge status={project.status} />
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-muted-foreground">Target: </span>
                            <span className="font-semibold">
                              {(Number(project.targetBomCost) || 0).toLocaleString('en-US', { style: 'currency', currency: project.targetBomCostCurrency || 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Actual: </span>
                            <span className="font-semibold">
                              {(Number(project.actualCost) || 0).toLocaleString('en-US', { style: 'currency', currency: project.targetBomCostCurrency || 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Layers className="h-3 w-3" />
                            {project.bomCount ?? 0} BOMs
                          </span>
                          <span className="flex items-center gap-1">
                            <Package className="h-3 w-3" />
                            {project.bomItemCount ?? 0} items
                          </span>
                          {(project.targetBomCost ?? 0) > 0 && (
                            <span className="font-semibold text-green-600 ml-auto">
                              {(((Number(project.targetBomCost) - Number(project.actualCost)) / Number(project.targetBomCost)) * 100).toFixed(1)}% saved
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="text-4xl mb-2">🚀</div>
                  <p className="text-muted-foreground text-sm mb-3">Ready to start your first project?</p>
                  <Link href="/projects">
                    <Button size="sm">
                      <Plus className="h-4 w-4 mr-2" />
                      Create Project
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Cost Analysis Overview */}
      <Card className="border-border/50 bg-card">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold">Manufacturing Cost Analysis</CardTitle>
          <p className="text-sm text-muted-foreground">
            Target BOM cost vs actual BOM cost derived from process-planned items
          </p>
        </CardHeader>
        <CardContent>
          {projects.length > 0 ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="text-center p-6 rounded-xl bg-primary/5 border border-primary/20">
                  <p className="text-sm text-primary mb-1 uppercase tracking-wider font-bold">Total Target</p>
                  <p className="text-2xl font-bold text-foreground">
                    {totalTarget.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">from {projects.filter(p => (p.targetBomCost ?? 0) > 0).length} projects with targets</p>
                </div>
                <div className="text-center p-6 rounded-xl bg-purple-500/5 border border-purple-500/20">
                  <p className="text-sm text-purple-400 mb-1 uppercase tracking-wider font-bold">Actual BOM Cost</p>
                  <p className="text-2xl font-bold text-foreground">
                    {totalActual.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{totalBomItems} items across all BOMs</p>
                </div>
                <div className="text-center p-6 rounded-xl bg-success/5 border border-success/20">
                  <p className="text-sm text-success mb-1 uppercase tracking-wider font-bold">Savings</p>
                  <p className="text-2xl font-bold text-success">
                    {savings.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-400 mt-1">{savingsPercent}% reduction</p>
                </div>
              </div>
              <CostChart projects={projectsForCharts} />
            </div>
          ) : (
            <div className="h-72 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-950/20 flex items-center justify-center mx-auto mb-4">
                  <div className="text-2xl font-bold text-green-600">$</div>
                </div>
                <p className="text-sm mb-3">Add projects with BOM items to see cost analysis</p>
                <Link href="/projects">
                  <Button variant="outline" size="sm" className="rounded-full">
                    <Plus className="h-3 w-3 mr-2" />
                    Create Project
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
