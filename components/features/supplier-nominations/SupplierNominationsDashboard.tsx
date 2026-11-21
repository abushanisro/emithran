'use client';

import { useRouter } from 'next/navigation';
import React, { useState, useMemo } from 'react';

import { ProjectNav } from '@/components/features/projects/ProjectNav';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Plus,
  Search,
  Users,
  Award,
  Edit2,
  Trash2,
  ArrowLeft,
  Package,
  Layers,
  CheckCircle2,
  ArrowUpRight,
  MoreVertical,
} from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { useBOMs } from '@/lib/api/hooks/useBOM';
import { useSupplierNominations, useDeleteSupplierNomination } from '@/lib/api/hooks/useSupplierNominations';
import {
  getStatusColor,
  getStatusText,
  getNominationTypeLabel,
  NominationType,
  NominationStatus,
  type SupplierNominationSummary,
} from '@/lib/api/supplier-nominations';

import { CreateNominationDialog } from './CreateNominationDialog';
import { EditNominationDialog } from './EditNominationDialog';
import { toneClasses } from './tone';

interface SupplierNominationsDashboardProps {
  projectId: string;
  evaluationGroupId?: string;
  selectedBomId?: string;
  onSelectNomination?: (nominationId: string) => void;
}

export function SupplierNominationsDashboard({
  projectId,
  evaluationGroupId,
  selectedBomId,
  onSelectNomination,
}: SupplierNominationsDashboardProps) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<NominationType | 'all'>('all');
  const [editingNomination, setEditingNomination] = useState<SupplierNominationSummary | null>(null);

  const { data: rawNominations = [], isLoading } = useSupplierNominations(projectId) as { data: SupplierNominationSummary[], isLoading: boolean };
  const deleteNominationMutation = useDeleteSupplierNomination();

  // Fetch BOMs for the project for BOM selection
  const { data: bomsData } = useBOMs({ projectId });
  const boms = bomsData?.boms || [];

  // Deduplicate nominations by ID
  const nominations = useMemo(() => {
    const seen = new Set();
    return rawNominations.filter((nomination: SupplierNominationSummary) => {
      if (seen.has(nomination.id)) {
        return false;
      }
      seen.add(nomination.id);
      return true;
    });
  }, [rawNominations]);

  // Filter nominations
  const filteredNominations = useMemo(() => {
    return nominations.filter((nomination: SupplierNominationSummary) => {
      const matchesSearch = nomination.nominationName?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesType = selectedType === 'all' || nomination.nominationType === selectedType;
      return matchesSearch && matchesType;
    });
  }, [nominations, searchTerm, selectedType]);

  // Calculate dashboard stats
  const stats = useMemo(() => {
    const total = nominations.length;
    const completed = nominations.filter(n => n.status === NominationStatus.COMPLETED || n.status === NominationStatus.APPROVED).length;
    const inProgress = nominations.filter(n => n.status === NominationStatus.IN_PROGRESS).length;
    const totalVendors = nominations.reduce((sum: number, n: SupplierNominationSummary) => sum + (n.vendorCount || 0), 0);
    const totalBomParts = nominations.reduce((sum: number, n: SupplierNominationSummary) => sum + (n.bomPartsCount || 0), 0);
    return { total, completed, inProgress, totalVendors, totalBomParts };
  }, [nominations]);

  const handleCreateSuccess = (nominationId: string) => {
    onSelectNomination?.(nominationId);
  };

  const handleDeleteNomination = (nomination: SupplierNominationSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Are you sure you want to delete "${nomination.nominationName}"? This action cannot be undone.`)) {
      deleteNominationMutation.mutate(nomination.id);
    }
  };

  const handleEditNomination = (nomination: SupplierNominationSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingNomination(nomination);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="space-y-4 p-5">
                <div className="h-5 bg-muted rounded w-2/3" />
                <div className="h-4 bg-muted rounded w-1/3" />
                <div className="h-20 bg-muted rounded-lg" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const kpis = [
    {
      label: 'Total Nominations',
      icon: Layers,
      value: stats.total,
      hint: stats.inProgress > 0 ? `${stats.inProgress} active` : undefined,
    },
    { label: 'Vendors Nominated', icon: Users, value: stats.totalVendors, hint: 'suppliers' },
    { label: 'Completed / Approved', icon: CheckCircle2, value: stats.completed, hint: 'groups' },
    { label: 'BOM Parts Nominated', icon: Package, value: stats.totalBomParts, hint: 'parts' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button
          variant="outline"
          size="icon"
          className="mt-0.5 h-8 w-8 shrink-0"
          aria-label="Back to project"
          onClick={() => router.push(`/projects/${projectId}`)}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <PageHeader
            title="Supplier Nomination"
            description="Evaluate and nominate suppliers, track BOM part allocations and finalise vendor awards"
          >
            <Button onClick={() => setCreateDialogOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Create Nomination
            </Button>
          </PageHeader>
        </div>
      </div>

      {/* Project sections: shared tab bar, Nomination is the active tab */}
      <ProjectNav projectId={projectId} />

      {/* Currently selected BOM */}
      {selectedBomId && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center gap-3">
            <Package className="h-4 w-4 text-primary" aria-hidden="true" />
            <div>
              <h4 className="text-sm font-medium text-foreground">
                BOM Selected: {boms.find(b => b.id === selectedBomId)?.name || 'Unknown BOM'}
              </h4>
              <p className="text-xs text-muted-foreground">Ready for part-wise nominations</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { window.location.href = window.location.pathname; }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear Selection
          </Button>
        </div>
      )}

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
                    <span className={`text-xs ${label === 'Total Nominations' ? 'font-medium text-warning' : 'text-muted-foreground'}`}>
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

      {/* Toolbar: search and category filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            aria-label="Search nominations"
            placeholder="Search nominations by name or scope..."
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); }}
            className="h-9 pl-9"
          />
        </div>

        <div role="group" aria-label="Filter by category" className="flex items-center gap-1 overflow-x-auto rounded-md border bg-muted/40 p-0.5">
          {(['all', NominationType.OEM, NominationType.MANUFACTURER, NominationType.HYBRID] as const).map((type) => {
            const isActive = selectedType === type;
            const label = type === 'all' ? 'All Groups' : getNominationTypeLabel(type as NominationType);
            return (
              <button
                key={type}
                type="button"
                onClick={() => { setSelectedType(type); }}
                aria-pressed={isActive}
                className={`whitespace-nowrap rounded px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isActive
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Nominations grid */}
      {filteredNominations.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Award}
              title={searchTerm || selectedType !== 'all' ? 'No matching supplier nominations' : 'No supplier nominations yet'}
              description={
                searchTerm || selectedType !== 'all'
                  ? 'Try adjusting your search query or category filter.'
                  : 'Create your first nomination group to evaluate and allocate suppliers to BOM parts.'
              }
            >
              {!searchTerm && selectedType === 'all' && (
                <Button onClick={() => setCreateDialogOpen(true)} className="gap-2">
                  <Plus className="h-4 w-4" />
                  Create First Nomination
                </Button>
              )}
            </EmptyState>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredNominations.map((nomination) => (
            <OEMNominationCard
              key={nomination.id}
              nomination={nomination}
              onClick={() => onSelectNomination?.(nomination.id)}
              onEdit={(n) => handleEditNomination(n, { stopPropagation: () => {} } as any)}
              onDelete={(n) => handleDeleteNomination(n, { stopPropagation: () => {} } as any)}
            />
          ))}
        </div>
      )}

      {/* Dialogs */}
      <CreateNominationDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        projectId={projectId}
        onSuccess={handleCreateSuccess}
        {...(evaluationGroupId !== undefined ? { evaluationGroupId } : {})}
      />

      <EditNominationDialog
        nomination={editingNomination}
        onClose={() => setEditingNomination(null)}
      />
    </div>
  );
}

interface OEMNominationCardProps {
  nomination: SupplierNominationSummary;
  onClick: () => void;
  onEdit: (nomination: SupplierNominationSummary) => void;
  onDelete: (nomination: SupplierNominationSummary) => void;
}

function OEMNominationCard({ nomination, onClick, onEdit, onDelete }: OEMNominationCardProps) {
  const statusText = getStatusText(nomination.status);
  const typeLabel = getNominationTypeLabel(nomination.nominationType);

  const completion = Math.min(100, Math.max(0, nomination.completionPercentage || 0));

  return (
    <Card
      onClick={onClick}
      className="group relative flex cursor-pointer flex-col overflow-hidden transition-colors hover:border-primary/50"
    >
      <CardContent className="flex flex-1 flex-col gap-5 p-5">
        {/* Status, type and action menu */}
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${toneClasses(getStatusColor(nomination.status))}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {statusText}
              </span>

              <Badge variant="secondary" className="text-[11px] font-medium">
                {typeLabel}
              </Badge>

              {nomination.bomPartsCount && nomination.bomPartsCount > 0 && (
                <Badge variant="outline" className="border-primary/40 bg-primary/5 text-[11px] text-primary">
                  BOM-Based
                </Badge>
              )}
            </div>

            <div onClick={(e) => { e.stopPropagation(); }}>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="-mr-2 -mt-1 h-8 w-8 text-muted-foreground"
                    aria-label="Nomination actions"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={onClick}>
                    <ArrowUpRight className="mr-2 h-4 w-4" />
                    Open Nomination
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => { onEdit(nomination); }}>
                    <Edit2 className="mr-2 h-4 w-4" />
                    Edit nomination
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => { onDelete(nomination); }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete nomination
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <h3 className="line-clamp-1 text-base font-semibold leading-snug text-foreground transition-colors group-hover:text-primary">
            {nomination.nominationName || 'Unnamed Nomination Group'}
          </h3>
        </div>

        {/* Metrics */}
        <dl className="grid grid-cols-2 divide-x rounded-md border bg-muted/30">
          <div className="flex items-center gap-3 p-3">
            <Users className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <dd className="text-lg font-semibold leading-none tabular-nums text-foreground">{nomination.vendorCount || 0}</dd>
              <dt className="mt-1 text-[11px] text-muted-foreground">Vendors</dt>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3">
            <Package className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <dd className="text-lg font-semibold leading-none tabular-nums text-foreground">{nomination.bomPartsCount || 0}</dd>
              <dt className="mt-1 text-[11px] text-muted-foreground">BOM Parts</dt>
            </div>
          </div>
        </dl>

        {/* Allocation progress */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-[11px]">
            <span className="font-medium text-muted-foreground">Allocation Progress</span>
            <span className="font-semibold tabular-nums text-foreground">{nomination.completionPercentage || 0}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={completion} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-1.5 rounded-full bg-primary transition-all duration-500" style={{ width: `${completion}%` }} />
          </div>
        </div>

        {/* Footer */}
        <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3">
          <span className="text-[11px] text-muted-foreground">
            Created {new Date(nomination.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>

          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
          >
            Open Nomination
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
