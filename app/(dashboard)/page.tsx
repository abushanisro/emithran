'use client';

import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/features/dashboard';
import { StatusBadge } from '@/components/common/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  FolderKanban,
  Users,
  Package,
  DollarSign,
  TrendingUp,
  AlertCircle,
  Plus,
  ArrowRight,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useProjects, useVendors } from '@/lib/api/hooks';
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

function ChartSkeleton() {
  return <div className="h-72"><Skeleton className="h-full w-full" /></div>;
}

const statusCounts = [
  { status: 'raw_material_procurement', label: 'Raw Material', count: 0 },
  { status: 'dfm_dfa_analysis', label: 'DFM/DFA', count: 0 },
  { status: 'process_planning', label: 'Process Planning', count: 0 },
  { status: 'should_costing', label: 'Should Costing', count: 0 },
  { status: 'quoted', label: 'Quoted', count: 0 },
  { status: 'cost_driver_analysis', label: 'Cost Drivers', count: 0 },
  { status: 'value_negotiation', label: 'Negotiation', count: 0 },
  { status: 'production', label: 'Production', count: 0 },
  { status: 'supply_chain', label: 'Supply Chain', count: 0 },
  { status: 'lost', label: 'Lost', count: 0 },
];

export default function DashboardPage() {
  const router = useRouter();
  const { data: projectsData } = useProjects();
  const { data: vendorsData } = useVendors();

  const projects = projectsData?.projects || [];
  const vendors = vendorsData?.vendors || [];
  const clients: any[] = [];

  // Calculate status distribution
  const statusDistribution = statusCounts.map((s) => ({
    ...s,
    count: projects.filter((p) => p.status === s.status).length,
  })).filter((s) => s.count > 0);

  // Generate sparkline data (mock for now)
  const sparklineData = Array.from({ length: 7 }, () => ({
    value: Math.floor(Math.random() * 10) + projects.length,
  }));

  // Cost summary
  const totalQuoted = projects.reduce((sum, p) => sum + (Number(p.targetPrice) || 0), 0);
  const totalShould = projects.reduce((sum, p) => sum + (Number(p.shouldCost) || 0), 0);
  const savings = totalQuoted - totalShould;
  const savingsPercent = totalQuoted > 0 ? ((savings / totalQuoted) * 100).toFixed(1) : '0';

  return (
    <div className="space-y-8 animate-fade-in">
      <PageHeader
        title="Dashboard"
        description="Overview of your manufacturing cost analysis"
      >
        <Link href="/projects">
          <Button className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 shadow-glow">
            <Plus className="h-4 w-4 mr-2" />
            New Project
          </Button>
        </Link>
      </PageHeader>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard
          title="Total Projects"
          value={projects.length}
          change={12}
          changeLabel="vs last month"
          icon={<FolderKanban className="h-5 w-5 text-primary" />}
          sparklineData={sparklineData}
          variant="primary"
        />
        <StatCard
          title="Active Clients"
          value={clients.length}
          change={5}
          changeLabel="vs last month"
          icon={<Users className="h-5 w-5 text-success" />}
          variant="success"
        />
        <StatCard
          title="Vendors"
          value={vendors.length}
          icon={<Package className="h-5 w-5 text-warning" />}
          variant="warning"
        />
        <StatCard
          title="Cost Savings"
          value={`$${savings.toLocaleString()}`}
          change={Number(savingsPercent)}
          changeLabel="identified"
          icon={<DollarSign className="h-5 w-5 text-success" />}
          variant="success"
        />
      </div>

      {/* Status Breakdown & Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Project Status Breakdown */}
        <Card className="lg:col-span-2 border-border/50 bg-card card-hover">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-semibold">Project Pipeline</CardTitle>
              <Link href="/projects" className="text-sm text-primary hover:underline flex items-center gap-1">
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {projects.length > 0 ? (
              <div className="space-y-3">
                {projects.slice(0, 5).map((project) => (
                  <div
                    key={project.id}
                    className="p-4 rounded-xl border border-border/50 bg-secondary/30 hover:border-primary/30 transition-colors cursor-pointer"
                    onClick={() => router.push(`/projects/${project.id}`)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="font-medium text-foreground">{project.name}</p>
                        {project.description && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {project.description}
                          </p>
                        )}
                      </div>
                      <StatusBadge status={project.status} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground text-sm">No projects yet</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Status Pie Chart */}
        <Card className="border-border/50 bg-card card-hover">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold">Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {statusDistribution.length > 0 ? (
              <StatusPieChart statusDistribution={statusDistribution} />
            ) : (
              <div className="h-48 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
                    <AlertCircle className="h-6 w-6 opacity-50" />
                  </div>
                  <p className="text-sm">No projects yet</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Cost Analysis Chart */}
      <Card className="border-border/50 bg-card card-hover">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <TrendingUp className="h-4 w-4 text-primary" />
            </div>
            Cost Analysis Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          {projects.length > 0 ? (
            <CostChart projects={projects} />
          ) : (
            <div className="h-72 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
                  <AlertCircle className="h-6 w-6 opacity-50" />
                </div>
                <p className="text-sm mb-3">Add projects to see cost analysis</p>
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
