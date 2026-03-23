"use client";

import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/features/dashboard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, BarChart3, TrendingUp, DollarSign, Weight } from "lucide-react";

export default function BenchmarkDashboardPage() {
  const searchParams = useSearchParams();
  const projectId = searchParams?.get('projectId');
  
  const isProjectContext = Boolean(projectId);
  const pageTitle = isProjectContext 
    ? "Project Benchmark Analysis" 
    : "Benchmark Analysis Dashboard";
  const pageDescription = isProjectContext
    ? "Compare this project's BOMs with others to identify optimization opportunities"
    : "Comprehensive BOM comparison and VAVE opportunity analysis";

  return (
    <div className="space-y-8 animate-fade-in">
      <PageHeader
        title={pageTitle}
        description={pageDescription}
      >
        <div className="flex gap-2">
          {isProjectContext && (
            <Badge variant="outline" className="mr-2">
              Project Context: {projectId}
            </Badge>
          )}
          <Button variant="outline">
            <BarChart3 className="mr-2 h-4 w-4" />
            Export Report
          </Button>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            {isProjectContext ? "Compare with Projects" : "New Benchmark"}
          </Button>
        </div>
      </PageHeader>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Active Benchmarks"
          value="0"
          change={0}
          changeLabel="this month"
          icon={<BarChart3 className="h-5 w-5 text-primary" />}
        />
        <StatCard
          title="Cost Savings Identified"
          value="$0"
          change={0}
          changeLabel="vs last quarter"
          icon={<DollarSign className="h-5 w-5 text-green-600" />}
        />
        <StatCard
          title="VAVE Opportunities"
          value="0"
          change={0}
          changeLabel="new this week"
          icon={<TrendingUp className="h-5 w-5 text-blue-600" />}
        />
        <StatCard
          title="Weight Reduction"
          value="0%"
          change={0}
          changeLabel="average savings"
          icon={<Weight className="h-5 w-5 text-orange-600" />}
        />
      </div>

      {/* Overview Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Benchmarks */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Benchmark Studies</CardTitle>
            <CardDescription>Latest completed analyses</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-12 text-muted-foreground">
              <BarChart3 className="mx-auto h-12 w-12 mb-4" />
              <p>No benchmark studies available</p>
              <p className="text-sm">Create your first benchmark to get started</p>
            </div>
          </CardContent>
        </Card>

        {/* Top Cost Drivers */}
        <Card>
          <CardHeader>
            <CardTitle>Top Cost Drivers</CardTitle>
            <CardDescription>Highest impact opportunities</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-12 text-muted-foreground">
              <DollarSign className="mx-auto h-12 w-12 mb-4" />
              <p>No cost analysis data available</p>
              <p className="text-sm">Complete benchmarks to identify cost drivers</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Performance Metrics */}
      <Card>
        <CardHeader>
          <CardTitle>Performance Metrics</CardTitle>
          <CardDescription>Overall benchmarking performance</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold">0%</div>
              <p className="text-sm text-muted-foreground">Average Cost Optimization</p>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">0</div>
              <p className="text-sm text-muted-foreground">Parts Analyzed</p>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">$0</div>
              <p className="text-sm text-muted-foreground">Total Savings Identified</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cost Analysis Section */}
      <Card>
        <CardHeader>
          <CardTitle>Cost Analysis Dashboard</CardTitle>
          <CardDescription>Detailed cost comparison and analysis tools</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12 text-muted-foreground">
            <BarChart3 className="mx-auto h-12 w-12 mb-4" />
            <p>Cost analysis tools will be implemented here</p>
            <p className="text-sm">Including cost comparison charts, breakdown analysis, and trends</p>
          </div>
        </CardContent>
      </Card>

      {/* Weight Analysis Section */}
      <Card>
        <CardHeader>
          <CardTitle>Weight Analysis Dashboard</CardTitle>
          <CardDescription>Weight comparison and optimization opportunities</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12 text-muted-foreground">
            <Weight className="mx-auto h-12 w-12 mb-4" />
            <p>Weight analysis tools will be implemented here</p>
            <p className="text-sm">Including weight distribution, material optimization, and reduction opportunities</p>
          </div>
        </CardContent>
      </Card>

      {/* VAVE Opportunities Section */}
      <Card>
        <CardHeader>
          <CardTitle>VAVE Opportunities</CardTitle>
          <CardDescription>Value Analysis Value Engineering recommendations</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12 text-muted-foreground">
            <TrendingUp className="mx-auto h-12 w-12 mb-4" />
            <p>VAVE analysis engine will be implemented here</p>
            <p className="text-sm">Including process optimization, material substitution, and design improvements</p>
          </div>
        </CardContent>
      </Card>

      {/* Benchmark Sets Section */}
      <Card>
        <CardHeader>
          <CardTitle>Benchmark Sets</CardTitle>
          <CardDescription>
            {isProjectContext 
              ? "Compare this project's BOMs with other projects" 
              : "Manage and create benchmark comparison sets"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isProjectContext ? (
            <div className="space-y-4">
              <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
                <h4 className="font-medium mb-2">Project Context Mode</h4>
                <p className="text-sm text-muted-foreground">
                  You're viewing benchmarks for Project {projectId}. Compare this project's BOMs with similar projects to identify:
                </p>
                <ul className="list-disc list-inside text-sm text-muted-foreground mt-2 space-y-1">
                  <li>Cost optimization opportunities</li>
                  <li>Material substitution possibilities</li>
                  <li>Process improvement areas</li>
                  <li>Weight reduction potential</li>
                </ul>
              </div>
              <div className="text-center py-8 text-muted-foreground">
                <Plus className="mx-auto h-12 w-12 mb-4" />
                <p className="text-lg font-medium mb-2">Ready to Compare Projects</p>
                <p className="text-sm">Select other projects to benchmark against this one</p>
                <Button className="mt-4">
                  <Plus className="mr-2 h-4 w-4" />
                  Start Project Comparison
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Plus className="mx-auto h-12 w-12 mb-4" />
              <p>Benchmark set management will be implemented here</p>
              <p className="text-sm">Including BOM selection, comparison setup, and analysis configuration</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}