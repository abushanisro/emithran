'use client';

import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/features/dashboard';
import { StatusBadge } from '@/components/common/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Plus,
  ArrowRight,
  TrendingUp,
  BarChart3,
  Target,
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
      value: projects.reduce((sum, p) => sum + (Number(p.targetPrice) || 0), 0)
    }
  },
  {
    id: 'process-planning',
    title: 'Process Planning & Costing',
    description: 'Manufacturing processes, material selection, and cost estimation',
    path: '/process-planning',
    stats: {
      active: projects.filter(p => p.status === 'active').length,
      total: projects.length,
      value: projects.reduce((sum, p) => sum + (Number(p.shouldCost) || 0), 0)
    }
  },
  {
    id: 'supplier-evaluation',
    title: 'Supplier Evaluation',
    description: 'Technical feasibility assessment and supplier shortlisting',
    path: '/supplier-evaluation',
    stats: {
      active: projects.filter(p => p.status === 'active').length,
      total: projects.length,
      value: projects.reduce((sum, p) => sum + (Math.abs(Number(p.targetPrice) - Number(p.shouldCost)) || 0), 0)
    }
  },
  {
    id: 'supplier-nomination',
    title: 'Supplier Nomination',
    description: 'Cost analysis and weighted scoring for supplier selection',
    path: '/supplier-nominations',
    stats: {
      active: projects.filter(p => ['active', 'on_hold'].includes(p.status)).length,
      total: projects.length,
      value: projects.filter(p => p.status === 'active').reduce((sum, p) => sum + (Number(p.targetPrice) || 0), 0)
    }
  },
  {
    id: 'production-planning',
    title: 'Production Planning',
    description: 'ISIR/FIA sample submission and PPAP lot management',
    path: '/production-planning',
    stats: {
      active: projects.filter(p => ['active', 'completed'].includes(p.status)).length,
      total: projects.length,
      value: projects.filter(p => p.status === 'completed').reduce((sum, p) => sum + (Number(p.targetPrice) || 0), 0)
    }
  },
  {
    id: 'quality-control',
    title: 'Quality Control',
    description: 'Quality inspections, testing protocols, and compliance',
    path: '/quality-control',
    stats: {
      active: projects.filter(p => ['active', 'completed'].includes(p.status)).length,
      total: projects.length,
      value: projects.filter(p => p.status === 'completed').reduce((sum, p) => sum + (Number(p.shouldCost) || 0), 0)
    }
  },
  {
    id: 'delivery',
    title: 'Delivery Management',
    description: 'Packing, logistics and delivery tracking coordination',
    path: '/delivery',
    stats: {
      active: projects.filter(p => p.status === 'completed').length,
      total: projects.length,
      value: projects.filter(p => p.status === 'completed').reduce((sum, p) => sum + (Number(p.targetPrice) || 0), 0)
    }
  }
];

const getDatabaseModules = (vendors: any[]) => [
  {
    id: 'vendors',
    title: 'Vendors Database',
    description: 'Comprehensive vendor management and capability assessment',
    path: '/vendors',
    count: vendors.length,
    activeVendors: vendors.filter(v => v.status === 'active').length
  },
  {
    id: 'raw-materials',
    title: 'Raw Materials Database',
    description: 'Material properties, cost data, and inventory management',
    path: '/raw-materials',
    count: 0, // Will be populated with real data
    categories: ['Plastic & Rubber', 'Ferrous Materials']
  },
  {
    id: 'mhr',
    title: 'MHR Database',
    description: 'Machine Hour Rate calculations and equipment costing',
    path: '/mhr-database',
    count: 0, // Will be populated with real data
    totalMachineHours: 0
  },
  {
    id: 'lhr',
    title: 'LHR Database',
    description: 'Labor Hour Rate analysis and workforce costing',
    path: '/lhr-database',
    count: 0, // Will be populated with real data
    totalLaborHours: 0
  },
  {
    id: 'calculators',
    title: 'Cost Calculators',
    description: 'Advanced calculators for manufacturing cost estimation',
    path: '/calculators',
    count: 5, // Standard calculator count
    calculatorTypes: ['Material Cost', 'Labor Cost', 'Machine Cost', 'Process Cost', 'Total Cost']
  }
];

const statusCounts = [
  { status: 'draft', label: 'Draft', count: 0 },
  { status: 'active', label: 'Active', count: 0 },
  { status: 'completed', label: 'Completed', count: 0 },
  { status: 'on_hold', label: 'On Hold', count: 0 },
  { status: 'cancelled', label: 'Cancelled', count: 0 },
];

export default function DashboardPage() {
  const router = useRouter();
  const { data: projectsData } = useProjects();
  const { data: vendorsData } = useVendors();

  const projects = projectsData?.projects || [];
  const vendors = vendorsData?.vendors || [];

  // Get dynamic modules with real data
  const manufacturingModules = getManufacturingModules(projects);
  const databaseModules = getDatabaseModules(vendors);

  // Calculate real status distribution
  const statusDistribution = statusCounts.map((s) => ({
    ...s,
    count: projects.filter((p) => p.status === s.status).length,
  })).filter((s) => s.count > 0);

  // Debug logging for status distribution
  if (process.env.NODE_ENV === 'development') {
    console.log('Projects:', projects.length);
    console.log('Status distribution:', statusDistribution);
    console.log('Project statuses:', projects.map(p => p.status));
  }

  // Real cost summary in Rupees
  const totalQuoted = projects.reduce((sum, p) => sum + (Number(p.targetPrice) || 0), 0);
  const totalShould = projects.reduce((sum, p) => sum + (Number(p.shouldCost) || 0), 0);
  const savings = totalQuoted - totalShould;
  const savingsPercent = totalQuoted > 0 ? ((savings / totalQuoted) * 100).toFixed(1) : '0';

  // Calculate real efficiency metrics
  const totalActiveProjects = projects.filter(p => !['cancelled'].includes(p.status)).length;
  const completedProjects = projects.filter(p => p.status === 'completed').length;
  const systemEfficiency = projects.length > 0 ? ((completedProjects / projects.length) * 100) : 0;

  // Generate real project trend data (last 7 periods)
  const projectTrendData = Array.from({ length: 7 }, (_, index) => {
    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() - (6 - index) * 7);
    const weekProjects = projects.filter(p => {
      const projectDate = new Date(p.createdAt || Date.now());
      return projectDate >= baseDate && projectDate < new Date(baseDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    });
    return { value: weekProjects.length, period: index };
  });

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
                <p className="text-sm text-muted-foreground">Active Projects</p>
                <div className="mt-2 h-12">
                  <div className="flex items-end justify-center space-x-1 h-full">
                    {projectTrendData.map((data, i) => (
                      <div
                        key={i}
                        className="bg-primary/60 rounded-sm"
                        style={{
                          height: `${Math.max(8, (data.value / Math.max(...projectTrendData.map(d => d.value), 1)) * 48)}px`,
                          width: '8px'
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
            <div className="space-y-4">
              <div className="text-center">
                <p className="text-3xl font-bold text-green-600">{systemEfficiency.toFixed(1)}%</p>
                <p className="text-sm text-muted-foreground">System Efficiency</p>
                <div className="mt-2">
                  <div className="w-full bg-secondary rounded-full h-2">
                    <div 
                      className="bg-green-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${systemEfficiency}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card">
          <CardContent className="p-6">
            <div className="space-y-4">
              <div className="text-center">
                <p className="text-3xl font-bold text-purple-600">{vendors.length}</p>
                <p className="text-sm text-muted-foreground">Active Vendors</p>
                <div className="mt-2 grid grid-cols-3 gap-1 text-xs">
                  <div className="text-center">
                    <p className="font-semibold">{vendors.filter(v => v.status === 'active').length}</p>
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
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card">
          <CardContent className="p-6">
            <div className="space-y-4">
              <div className="text-center">
                <p className="text-3xl font-bold text-green-600">₹{savings.toLocaleString('en-IN')}</p>
                <p className="text-sm text-muted-foreground">Cost Savings</p>
                <div className="mt-2">
                  <p className="text-lg font-semibold text-green-600">{savingsPercent}%</p>
                  <p className="text-xs text-muted-foreground">Savings Rate</p>
                </div>
              </div>
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
              ₹{(manufacturingModules.reduce((sum, m) => sum + m.stats.value, 0) / 100000).toFixed(1)}L Portfolio Value
            </Badge>
          </div>
        </div>
        
        {/* Performance Chart */}
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

        {/* Quick Access Module Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {manufacturingModules.map((module) => {
            const completionRate = module.stats.total > 0 ? (module.stats.active / module.stats.total * 100) : 0;
            return (
              <Card 
                key={module.id} 
                className="group border-border/50 bg-card hover:border-primary/30 transition-all duration-300 cursor-pointer hover:shadow-lg"
                onClick={() => router.push(module.path)}
              >
                <CardContent className="p-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-sm group-hover:text-primary transition-colors line-clamp-1">
                        {module.title}
                      </h3>
                      <Badge variant="outline" className="text-xs">
                        {completionRate.toFixed(0)}%
                      </Badge>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-lg font-bold text-primary">{module.stats.active}</p>
                        <p className="text-xs text-muted-foreground">Active</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-foreground">{module.stats.total}</p>
                        <p className="text-xs text-muted-foreground">Total</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-green-600">₹{(module.stats.value / 100000).toFixed(1)}L</p>
                        <p className="text-xs text-muted-foreground">Value</p>
                      </div>
                    </div>
                    
                    <div className="w-full bg-secondary rounded-full h-2">
                      <div 
                        className="bg-primary h-2 rounded-full transition-all duration-300"
                        style={{ width: `${completionRate}%` }}
                      />
                    </div>
                    
                    <Button variant="ghost" size="sm" className="w-full text-xs group-hover:bg-primary group-hover:text-primary-foreground">
                      Access Module
                      <ArrowRight className="h-3 w-3 ml-1 group-hover:translate-x-1 transition-transform" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Database & Tools Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Databases & Calculators</h2>
            <p className="text-muted-foreground">Access comprehensive databases and calculation tools</p>
          </div>
          <Badge variant="outline" className="px-3 py-1">
            {databaseModules.length} Resources
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
          {databaseModules.map((module) => {
            return (
              <Card 
                key={module.id} 
                className="group border-border/50 bg-card hover:border-primary/30 transition-all duration-300 cursor-pointer hover:shadow-lg"
                onClick={() => router.push(module.path)}
              >
                <CardContent className="p-6">
                  <div className="space-y-4">
                    <div className="text-center">
                      <p className="text-3xl font-bold text-primary">{module.count}</p>
                      <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors text-sm">
                        {module.title}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {module.description}
                      </p>
                    </div>
                    
                    {module.id === 'vendors' && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="text-center p-2 bg-green-50 dark:bg-green-950/20 rounded">
                            <p className="font-bold text-green-600">{module.activeVendors}</p>
                            <p className="text-muted-foreground">Active</p>
                          </div>
                          <div className="text-center p-2 bg-orange-50 dark:bg-orange-950/20 rounded">
                            <p className="font-bold text-orange-600">{module.count - module.activeVendors}</p>
                            <p className="text-muted-foreground">Inactive</p>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {module.id === 'raw-materials' && (
                      <div className="space-y-2">
                        <div className="text-xs space-y-1">
                          {module.categories?.map((cat, i) => (
                            <div key={i} className="flex justify-between p-1 bg-secondary/50 rounded">
                              <span>{cat}</span>
                              <span className="font-semibold">0</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {module.id === 'calculators' && (
                      <div className="space-y-1">
                        {module.calculatorTypes?.slice(0, 3).map((type, i) => (
                          <div key={i} className="text-xs p-1 bg-secondary/30 rounded text-center">
                            {type}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Advanced Analytics Dashboard */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Project Pipeline & Trends */}
        <div className="space-y-6">
          <Card className="border-border/50 bg-card">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-semibold">
                  Project Trend Analysis
                </CardTitle>
                <Badge variant="outline" className="px-3 py-1">
                  Last 30 Days
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Project creation trends and volume analytics
              </p>
            </CardHeader>
            <CardContent>
              <ProjectTrendChart projects={projects} />
            </CardContent>
          </Card>
          
          <Card className="border-border/50 bg-card">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold">
                Cost Savings Analysis
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Project-wise cost optimization and savings identification
              </p>
            </CardHeader>
            <CardContent>
              <CostSavingsChart projects={projects} />
            </CardContent>
          </Card>
        </div>
        
        {/* Status & Pipeline Overview */}
        <div className="space-y-6">
          <Card className="border-border/50 bg-card">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold">
                Project Status Distribution
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Current project status breakdown with percentage distribution
              </p>
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
                <CardTitle className="text-lg font-semibold">
                  Active Project Pipeline
                </CardTitle>
                <Link href="/projects" className="text-sm text-primary hover:underline flex items-center gap-1">
                  View all <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {projects.length > 0 ? (
                <div className="space-y-3 max-h-64 overflow-y-auto">
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
                            <span className="font-semibold">₹{(Number(project.targetPrice) / 100000 || 0).toFixed(1)}L</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Should: </span>
                            <span className="font-semibold">₹{(Number(project.shouldCost) / 100000 || 0).toFixed(1)}L</span>
                          </div>
                        </div>
                        <div className="text-xs">
                          <span className="text-muted-foreground">Savings: </span>
                          <span className="font-semibold text-green-600">
                            ₹{(((Number(project.targetPrice) || 0) - (Number(project.shouldCost) || 0)) / 100000).toFixed(1)}L
                          </span>
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
          <CardTitle className="text-lg font-semibold">
            Manufacturing Cost Analysis (₹ Rupees)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {projects.length > 0 ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="text-center p-6 rounded-xl bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900">
                  <p className="text-sm text-blue-600 dark:text-blue-400 mb-1">Total Quoted</p>
                  <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                    ₹{totalQuoted.toLocaleString('en-IN')}
                  </p>
                </div>
                <div className="text-center p-6 rounded-xl bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900">
                  <p className="text-sm text-purple-600 dark:text-purple-400 mb-1">Should Cost</p>
                  <p className="text-2xl font-bold text-purple-700 dark:text-purple-300">
                    ₹{totalShould.toLocaleString('en-IN')}
                  </p>
                </div>
                <div className="text-center p-6 rounded-xl bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900">
                  <p className="text-sm text-green-600 dark:text-green-400 mb-1">Savings</p>
                  <p className="text-2xl font-bold text-green-700 dark:text-green-300">
                    ₹{savings.toLocaleString('en-IN')}
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                    {savingsPercent}% reduction
                  </p>
                </div>
              </div>
              <CostChart projects={projects} />
            </div>
          ) : (
            <div className="h-72 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-950/20 flex items-center justify-center mx-auto mb-4">
                  <div className="text-2xl font-bold text-green-600">₹</div>
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