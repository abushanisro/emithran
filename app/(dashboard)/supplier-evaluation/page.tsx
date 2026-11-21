'use client';

import { useRouter } from 'next/navigation';
import React, { useState, useMemo } from 'react';

import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Package,
  Search,
  Plus,
  FolderKanban,
  Award,
  Factory,
  Layers,
  Wrench,
  ArrowUpRight,
} from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { useAllSupplierEvaluationGroups } from '@/lib/api/hooks/useSupplierEvaluationGroups';
import { useVendors } from '@/lib/api/hooks/useVendors';

export default function SupplierEvaluationPage() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed' | 'draft'>('all');

  // Fetch all evaluation groups across all projects
  const { data: allEvaluationGroups = [], isLoading: isLoadingGroups } = useAllSupplierEvaluationGroups();

  // Fetch vendors for OEM active vendor network statistics
  const vendorsQuery = useMemo(() => ({ status: 'active' as const, limit: 1000 }), []);
  const { data: vendorsData } = useVendors(vendorsQuery);

  const activeVendors = vendorsData?.total || vendorsData?.vendors?.length || 0;

  // Aggregate statistics across all projects
  const totalEvaluations = Array.isArray(allEvaluationGroups) ? allEvaluationGroups.length : 0;
  const totalParts = useMemo(() => {
    if (!Array.isArray(allEvaluationGroups)) return 0;
    return allEvaluationGroups.reduce((acc, group) => acc + (group.bomItemsCount || 0), 0);
  }, [allEvaluationGroups]);

  const totalProcesses = useMemo(() => {
    if (!Array.isArray(allEvaluationGroups)) return 0;
    return allEvaluationGroups.reduce((acc, group) => acc + (group.processesCount || 0), 0);
  }, [allEvaluationGroups]);

  const activeProgramsCount = useMemo(() => {
    if (!Array.isArray(allEvaluationGroups)) return 0;
    return allEvaluationGroups.filter(g => (g.status || 'draft') === 'active').length;
  }, [allEvaluationGroups]);

  // Filter evaluation groups
  const filteredGroups = useMemo(() => {
    if (!Array.isArray(allEvaluationGroups)) return [];
    return allEvaluationGroups.filter(group => {
      const matchesSearch =
        group.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        group.projectName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        group.description?.toLowerCase().includes(searchTerm.toLowerCase());
      const groupStatus = (group.status || 'draft').toLowerCase();
      const matchesStatus = statusFilter === 'all' || groupStatus === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [allEvaluationGroups, searchTerm, statusFilter]);

  const handleNewEvaluation = () => {
    router.push('/projects');
  };

  const handleSelectEvaluationGroup = (groupId: string) => {
    const group = allEvaluationGroups.find(g => g.id === groupId);
    if (group?.projectId) {
      router.push(`/projects/${group.projectId}/supplier-evaluation`);
    }
  };

  const handleViewProject = (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/projects/${projectId}`);
  };

  const kpis = [
    {
      label: 'Evaluation Programs',
      icon: Layers,
      value: totalEvaluations,
      hint: activeProgramsCount > 0 ? `${activeProgramsCount} active` : undefined,
    },
    { label: 'BOM Parts Under Audit', icon: Package, value: totalParts, hint: 'parts' },
    { label: 'OEM Vendor Network', icon: Factory, value: activeVendors, hint: 'qualified' },
    { label: 'Process Routes', icon: Wrench, value: totalProcesses, hint: 'mapped' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supplier Evaluation Portfolio"
        description="Process-based supplier matching, technical audits and vendor qualification across all programs"
      >
        <Button onClick={handleNewEvaluation} className="gap-2">
          <Plus className="h-4 w-4" />
          New Evaluation Program
        </Button>
      </PageHeader>

      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map(({ label, icon: Icon, value, hint }) => (
          <Card key={label}>
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">{label}</p>
                <p className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-semibold tabular-nums tracking-tight">{value}</span>
                  {hint && (
                    <span className={`text-xs ${label === 'Evaluation Programs' ? 'font-medium text-success' : 'text-muted-foreground'}`}>
                      {hint}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Toolbar: search and status filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            aria-label="Search evaluation programs"
            placeholder="Search programs by name, project, or scope..."
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); }}
            className="h-9 pl-9"
          />
        </div>

        <div role="group" aria-label="Filter by status" className="flex items-center gap-1 overflow-x-auto rounded-md border bg-muted/40 p-0.5">
          {(['all', 'active', 'completed', 'draft'] as const).map((status) => {
            const isActive = statusFilter === status;
            return (
              <button
                key={status}
                type="button"
                onClick={() => { setStatusFilter(status); }}
                aria-pressed={isActive}
                className={`rounded px-3 py-1 text-xs font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isActive
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {status}
              </button>
            );
          })}
        </div>
      </div>

      {/* Program Evaluation Cards Grid */}
      {isLoadingGroups ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="space-y-4 p-5">
                <div className="h-5 bg-muted rounded w-2/3" />
                <div className="h-4 bg-muted rounded w-1/3" />
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="h-14 bg-muted rounded-lg" />
                  <div className="h-14 bg-muted rounded-lg" />
                </div>
                <div className="h-9 bg-muted rounded-lg w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredGroups.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Award}
              title={searchTerm || statusFilter !== 'all' ? 'No matching evaluation programs' : 'No supplier evaluation programs yet'}
              description={
                searchTerm || statusFilter !== 'all'
                  ? 'Try adjusting your search query or status filter.'
                  : 'Select an OEM project to create your first supplier evaluation program.'
              }
            >
              {!searchTerm && statusFilter === 'all' && (
                <Button onClick={handleNewEvaluation} className="gap-2">
                  <FolderKanban className="h-4 w-4" />
                  Browse Projects
                </Button>
              )}
            </EmptyState>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredGroups.map((group) => (
            <GlobalOEMEvaluationCard
              key={group.id}
              group={group}
              onSelectGroup={() => handleSelectEvaluationGroup(group.id)}
              onViewProject={(e) => handleViewProject(group.projectId, e)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface GlobalOEMEvaluationCardProps {
  group: any;
  onSelectGroup: () => void;
  onViewProject: (e: React.MouseEvent) => void;
}

function GlobalOEMEvaluationCard({ group, onSelectGroup, onViewProject }: GlobalOEMEvaluationCardProps) {
  const partsCount = group.bomItemsCount || 0;
  const processesCount = group.processesCount || 0;

  const status = (group.status || 'draft') as 'draft' | 'active' | 'completed' | 'archived';

  const statusBadgeConfigs: Record<'draft' | 'active' | 'completed' | 'archived', { label: string; className: string; dotColor: string }> = {
    active: {
      label: 'Active Audit',
      className: 'bg-success/10 text-success border-success/20',
      dotColor: 'bg-success'
    },
    completed: {
      label: 'Qualified / Complete',
      className: 'bg-primary/10 text-primary border-primary/20',
      dotColor: 'bg-primary'
    },
    draft: {
      label: 'Draft Program',
      className: 'bg-warning/10 text-warning border-warning/20',
      dotColor: 'bg-warning'
    },
    archived: {
      label: 'Archived',
      className: 'bg-muted text-muted-foreground border-border',
      dotColor: 'bg-muted-foreground/30'
    }
  };

  const currentStatusConfig = statusBadgeConfigs[status];

  // Qualification funnel stage
  const funnelStage = React.useMemo(() => {
    if (status === 'completed') return 4;
    if (processesCount > 0 && partsCount > 0) return 3;
    if (partsCount > 0) return 2;
    return 1;
  }, [status, partsCount, processesCount]);

  return (
    <Card
      onClick={onSelectGroup}
      className="group relative flex cursor-pointer flex-col overflow-hidden transition-colors hover:border-primary/50"
    >
      <CardContent className="flex flex-1 flex-col gap-5 p-5">
        {/* Title, Project & Status */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${currentStatusConfig.className}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${currentStatusConfig.dotColor}`} />
              {currentStatusConfig.label}
            </span>

            {group.projectName && (
              <button
                onClick={onViewProject}
                className="inline-flex items-center gap-1 rounded-md bg-muted/60 hover:bg-primary/10 hover:text-primary px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors"
                title={`Open project: ${group.projectName}`}
              >
                <FolderKanban className="h-3 w-3" />
                <span className="max-w-[120px] truncate">{group.projectName}</span>
              </button>
            )}
          </div>

          <div>
            <h3 className="text-base font-semibold text-foreground leading-snug group-hover:text-primary transition-colors line-clamp-1">
              {group.name || 'Unnamed Evaluation Program'}
            </h3>
            {group.description ? (
              <p className="text-xs text-muted-foreground line-clamp-2 mt-1 leading-relaxed">
                {group.description}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground/60 italic mt-1">
                No program audit notes specified.
              </p>
            )}
          </div>
        </div>

        {/* Metrics */}
        <dl className="grid grid-cols-2 divide-x rounded-md border bg-muted/30">
          <div className="flex items-center gap-3 p-3">
            <Package className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <dd className="text-lg font-semibold leading-none tabular-nums text-foreground">{partsCount}</dd>
              <dt className="mt-1 text-[11px] text-muted-foreground">BOM Parts</dt>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3">
            <Wrench className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <dd className="text-lg font-semibold leading-none tabular-nums text-foreground">{processesCount}</dd>
              <dt className="mt-1 text-[11px] text-muted-foreground">Processes</dt>
            </div>
          </div>
        </dl>

        {/* OEM Qualification Funnel Progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-medium text-muted-foreground">OEM Qualification Stage</span>
            <span className="font-semibold text-foreground">
              {funnelStage === 1 && '1. Scope Defined'}
              {funnelStage === 2 && '2. Parts Selected'}
              {funnelStage === 3 && '3. Process Matching'}
              {funnelStage === 4 && '4. RFQ / Award Ready'}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {[1, 2, 3, 4].map((step) => (
              <div
                key={step}
                className={`h-1.5 rounded-full transition-colors ${
                  step <= funnelStage
                    ? 'bg-primary'
                    : 'bg-muted'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Footer Actions & Metadata */}
        <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3">
          <span className="text-[11px] text-muted-foreground">
            Created {new Date(group.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>

          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onSelectGroup();
            }}
          >
            Open Evaluation
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}