'use client';

import { PageHeader } from '@/components/layout/PageHeader';

import { StatusBadge } from '@/components/common/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Plus,
  ArrowRight,
  BarChart3,
  Gauge,
  PiggyBank,
  FolderKanban,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useProjects, useVendors, useRawMaterials, useMHRRecords, useLHRCount } from '@/lib/api/hooks';
import dynamic from 'next/dynamic';
import { formatProjectMoney, projectCostCurrency, projectSavings, summarizeProjectCosts } from '@/lib/costing/project-costs';

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
      value: summarizeProjectCosts(projects).actual,
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
      value: summarizeProjectCosts(projects).savings,
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
      value: summarizeProjectCosts(projects.filter(p => p.status === 'completed')).actual,
    },
  },
];

// Module ids with no top-level page (quality inspections live under a project), so they are listed without a link.
const MODULES_WITHOUT_PAGE = new Set(['quality-control']);

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
  // Only whether any machine is on file: one row and the total, not the rows.
  const { data: mhrData } = useMHRRecords({ limit: 1 });
  // Likewise only whether any labour rate is on file.
  const { data: lhrCount = 0 } = useLHRCount();

  const projects = projectsData?.projects || [];
  const vendors = vendorsData?.vendors || [];
  const rawMaterials = rawMaterialsData?.items || [];
  const mhrCount = mhrData?.total ?? 0;

  const manufacturingModules = getManufacturingModules(projects);

  // Status distribution (non-zero statuses only)
  const statusDistribution = Object.keys(STATUS_LABELS)
    .map(s => ({
      status: s,
      label: STATUS_LABELS[s] ?? s,
      count: projects.filter(p => p.status === s).length,
    }))
    .filter(s => s.count > 0);

  // Cost summary — target = targetBomCost (the field actually set on creation)
  //                should  = actualCost (derived from BOM item costs via enrichment)
  const { target: totalTarget, actual: totalActual, savings, savingsPercent } = summarizeProjectCosts(projects);
  const savingsLabel = savingsPercent == null ? '—' : `${savingsPercent.toFixed(1)}%`;
  const totalBomItems = projects.reduce((sum, p) => sum + (Number(p.bomItemCount) || 0), 0);

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
    (mhrCount > 0 ? 7 : 0) +
    (lhrCount > 0 ? 7 : 0)
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
    if (systemEfficiency < 10 && (vendors.length + rawMaterials.length + mhrCount + lhrCount + totalBomItemsForEff) > 0) {
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
  const projectsForCharts = projects.filter(p => projectSavings(p) != null && projectCostCurrency(p) === 'USD').map(p => ({
    ...p,
    targetPrice: p.targetBomCost!,
    shouldCost: p.actualCost!,
  }));

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Manufacturing Control Center"
        description="Comprehensive manufacturing cost analysis and project orchestration"
      >
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push('/projects')}>
            <BarChart3 className="h-4 w-4 mr-2" />
            Analytics
          </Button>
          <Link href="/projects">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Project
            </Button>
          </Link>
        </div>
      </PageHeader>

      {/* Row 1: KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">Total Projects</p>
              <FolderKanban className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-2 flex items-end justify-between gap-4">
              <p className="text-3xl font-semibold tabular-nums tracking-tight text-foreground">{projects.length}</p>
              <div className="flex h-10 items-end gap-1" aria-hidden="true">
                {projectTrendData.map((data, i) => (
                  <div
                    key={i}
                    className="w-2 rounded-sm bg-primary/60"
                    style={{
                      height: `${Math.max(8, (data.value / Math.max(...projectTrendData.map(d => d.value), 1)) * 40)}px`,
                    }}
                  />
                ))}
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Created per week, last 7 weeks</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">System Efficiency</p>
              <Gauge className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-foreground">{systemEfficiency.toFixed(1)}%</p>
            <div className="mt-3 h-1.5 w-full rounded-full bg-secondary">
              <div
                className="h-1.5 rounded-full bg-success transition-all duration-300"
                style={{ width: `${systemEfficiency}%` }}
              />
            </div>
            <div className="mt-3 flex gap-6 text-xs">
              <p>
                <span className="font-semibold tabular-nums text-foreground">{totalBomItems}</span>{' '}
                <span className="text-muted-foreground">BOM Items</span>
              </p>
              <p>
                <span className="font-semibold tabular-nums text-foreground">
                  {projects.reduce((s, p) => s + (p.bomCount || 0), 0)}
                </span>{' '}
                <span className="text-muted-foreground">BOMs</span>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">Total Vendors</p>
              <Users className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-foreground">{vendorsData?.total || vendors.length}</p>
            <div className="mt-3 flex gap-5 text-xs">
              <p>
                <span className="font-semibold tabular-nums text-foreground">{vendorsData?.total || vendors.filter(v => v.status === 'active').length}</span>{' '}
                <span className="text-muted-foreground">Active</span>
              </p>
              <p>
                <span className="font-semibold tabular-nums text-foreground">{vendors.filter(v => v.status === 'pending').length}</span>{' '}
                <span className="text-muted-foreground">Pending</span>
              </p>
              <p>
                <span className="font-semibold tabular-nums text-foreground">{vendors.filter(v => v.status === 'inactive').length}</span>{' '}
                <span className="text-muted-foreground">Inactive</span>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">Cost Savings</p>
              <PiggyBank className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <p className="text-3xl font-semibold tabular-nums tracking-tight text-success">
                {savings != null && savings >= 0 ? '+' : ''}{formatProjectMoney(savings)}
              </p>
              <p className="text-sm font-medium tabular-nums text-success">{savingsLabel}</p>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Target vs Actual BOM Cost</p>
          </CardContent>
        </Card>
      </div>

      {projectsForCharts.length < projects.length && (
        <p className="text-sm text-muted-foreground">Cost charts exclude projects with unresolved costs or non-comparable currencies.</p>
      )}

      {/* Row 2: charts and action list */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:col-span-2">
          <Card className="md:col-span-2">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base font-semibold">Module Performance & Efficiency</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Active vs total projects across manufacturing modules
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{manufacturingModules.length} Active Modules</Badge>
                  <Badge variant="outline">
                    {totalTarget == null ? '—' : `${(totalTarget / 1000).toFixed(0)}K`} Portfolio Value
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ManufacturingPerformanceChart modules={manufacturingModules} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">Project Trend</CardTitle>
                <Badge variant="outline">Last 30 Days</Badge>
              </div>
              <p className="text-sm text-muted-foreground">Project creation trends and volume</p>
            </CardHeader>
            <CardContent>
              <ProjectTrendChart projects={projects} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Cost Savings</CardTitle>
              <p className="text-sm text-muted-foreground">Target BOM cost vs actual BOM cost, by project</p>
            </CardHeader>
            <CardContent>
              <CostSavingsChart projects={projectsForCharts} />
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Manufacturing Cost Analysis</CardTitle>
              <p className="text-sm text-muted-foreground">
                Target BOM cost vs actual BOM cost derived from process-planned items
              </p>
            </CardHeader>
            <CardContent>
              {projects.length > 0 ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 divide-y rounded-lg border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                    <div className="p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total Target</p>
                      <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                        {formatProjectMoney(totalTarget)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">from {projects.filter(p => (p.targetBomCost ?? 0) > 0).length} projects with targets</p>
                    </div>
                    <div className="p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Actual BOM Cost</p>
                      <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                        {formatProjectMoney(totalActual)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{totalBomItems} items across all BOMs</p>
                    </div>
                    <div className="p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-success">Savings</p>
                      <p className="mt-1 text-xl font-semibold tabular-nums text-success">
                        {formatProjectMoney(savings)}
                      </p>
                      <p className="mt-1 text-xs text-success">{savingsLabel} reduction</p>
                    </div>
                  </div>
                  <CostChart projects={projectsForCharts} />
                </div>
              ) : (
                <EmptyState
                  icon={PiggyBank}
                  title="No cost data yet"
                  description="Add projects with BOM items to see cost analysis"
                  className="h-72"
                >
                  <Link href="/projects">
                    <Button variant="outline" size="sm">
                      <Plus className="h-3 w-3 mr-2" />
                      Create Project
                    </Button>
                  </Link>
                </EmptyState>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Project Status</CardTitle>
              <p className="text-sm text-muted-foreground">Current breakdown by status</p>
            </CardHeader>
            <CardContent>
              {statusDistribution.length > 0 ? (
                <StatusPieChart statusDistribution={statusDistribution} />
              ) : (
                <EmptyState
                  icon={FolderKanban}
                  title="No project status data available"
                  className="h-48 py-0"
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Modules</CardTitle>
              <p className="text-sm text-muted-foreground">Jump to a manufacturing module</p>
            </CardHeader>
            <CardContent className="p-2 pt-0">
              <ul className="divide-y">
                {manufacturingModules.map((module) => {
                  const row = (
                    <>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{module.title}</p>
                        <p className="text-xs tabular-nums text-muted-foreground">
                          {module.stats.active} active of {module.stats.total}
                        </p>
                      </div>
                      {!MODULES_WITHOUT_PAGE.has(module.id) && (
                        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                    </>
                  );
                  return (
                    <li key={module.id}>
                      {MODULES_WITHOUT_PAGE.has(module.id) ? (
                        <div className="flex items-center justify-between gap-3 rounded-md px-3 py-2.5">{row}</div>
                      ) : (
                        <Link
                          href={module.path}
                          className="flex items-center justify-between gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-accent"
                        >
                          {row}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Row 3: recent projects */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">Recent Projects</CardTitle>
            <Link href="/projects" className="flex items-center gap-1 text-sm text-primary hover:underline">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {projects.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead data-numeric>BOMs</TableHead>
                  <TableHead data-numeric>Items</TableHead>
                  <TableHead data-numeric>Target</TableHead>
                  <TableHead data-numeric>Actual</TableHead>
                  <TableHead data-numeric>Saved</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.slice(0, 5).map((project) => (
                  <TableRow
                    key={project.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/projects/${project.id}`)}
                  >
                    <TableCell className="max-w-64 truncate font-medium">{project.name}</TableCell>
                    <TableCell><StatusBadge status={project.status} /></TableCell>
                    <TableCell data-numeric>{project.bomCount ?? 0}</TableCell>
                    <TableCell data-numeric>{project.bomItemCount ?? 0}</TableCell>
                    <TableCell data-numeric>
                      {(Number(project.targetBomCost) || 0).toLocaleString('en-US', { style: 'currency', currency: project.targetBomCostCurrency || 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell data-numeric>
                      {formatProjectMoney(project.actualCost, projectCostCurrency(project))}
                    </TableCell>
                    <TableCell data-numeric className="text-success">
                      {(project.targetBomCost ?? 0) > 0 && projectSavings(project) != null
                        ? `${(projectSavings(project)! / project.targetBomCost! * 100).toFixed(1)}%`
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              icon={FolderKanban}
              title="Ready to start your first project?"
            >
              <Link href="/projects">
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Project
                </Button>
              </Link>
            </EmptyState>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
