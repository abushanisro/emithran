'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  Package,
  Search,
  Plus,
  Edit,
  Trash2,
  Loader2,
  Award,
  Factory,
  Layers,
  ArrowUpRight,
  Wrench,
  MoreVertical,
} from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { useVendors } from '@/lib/api/hooks/useVendors';


import { EditSupplierEvaluationDialog } from './EditSupplierEvaluationDialog';

interface SupplierEvaluationDashboardProps {
  projectId: string;
  evaluationGroups: any[];
  isLoading?: boolean;
  onNewEvaluation: () => void;
  onSelectEvaluationGroup: (groupId: string) => void;
}

export function SupplierEvaluationDashboard({
  evaluationGroups,
  isLoading = false,
  onNewEvaluation,
  onSelectEvaluationGroup
}: SupplierEvaluationDashboardProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed' | 'draft'>('all');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [groupToEdit, setGroupToEdit] = useState<any>(null);

  // Fetch vendors for OEM network statistics
  const vendorsQuery = useMemo(() => ({ status: 'active' as const, limit: 1000 }), []);
  const { data: vendorsData } = useVendors(vendorsQuery);

  const vendors = vendorsData?.vendors || [];
  const totalVendorsInDb = vendorsData?.total || vendors.length;

  // Filter evaluation groups by search & status
  const filteredGroups = useMemo(() => {
    return (evaluationGroups || []).filter(group => {
      const matchesSearch =
        group.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        group.description?.toLowerCase().includes(searchTerm.toLowerCase());
      const groupStatus = (group.status || 'draft').toLowerCase();
      const matchesStatus = statusFilter === 'all' || groupStatus === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [evaluationGroups, searchTerm, statusFilter]);

  // Aggregate stats
  const totalParts = useMemo(
    () => (evaluationGroups || []).reduce((acc, group) => acc + (group.bomItemsCount || group.bomItems?.length || 0), 0),
    [evaluationGroups]
  );

  const totalProcesses = useMemo(
    () => (evaluationGroups || []).reduce((acc, group) => acc + (group.processesCount || group.processes?.length || 0), 0),
    [evaluationGroups]
  );

  const activeProgramsCount = useMemo(
    () => (evaluationGroups || []).filter(g => (g.status || 'draft') === 'active').length,
    [evaluationGroups]
  );

  const kpis = [
    {
      label: 'Evaluation Programs',
      icon: Layers,
      value: (evaluationGroups || []).length,
      hint: activeProgramsCount > 0 ? `${activeProgramsCount} active` : undefined,
    },
    { label: 'BOM Parts Under Audit', icon: Package, value: Number(totalParts), hint: 'parts' },
    { label: 'OEM Vendor Network', icon: Factory, value: totalVendorsInDb, hint: 'suppliers' },
    { label: 'Process Routes', icon: Wrench, value: Number(totalProcesses), hint: 'mapped' },
  ];

  return (
    <div className="space-y-6">
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

      {/* Toolbar: search, status filter, primary action */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            aria-label="Search evaluation programs"
            placeholder="Search programs by name or scope..."
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

        <Button onClick={onNewEvaluation} className="gap-2 sm:ml-auto">
          <Plus className="h-4 w-4" />
          New Evaluation Program
        </Button>
      </div>

      {/* Program cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="space-y-4 p-5">
                <div className="h-5 w-2/3 rounded bg-muted" />
                <div className="h-4 w-1/3 rounded bg-muted" />
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="h-14 rounded-lg bg-muted" />
                  <div className="h-14 rounded-lg bg-muted" />
                </div>
                <div className="h-9 w-full rounded-lg bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredGroups.length === 0 ? (
        <Card>
          <CardContent className="mx-auto max-w-md space-y-4 py-14 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Award className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-foreground">
                {searchTerm || statusFilter !== 'all' ? 'No matching evaluation programs' : 'No supplier evaluation programs yet'}
              </h3>
              <p className="text-sm text-muted-foreground">
                {searchTerm || statusFilter !== 'all'
                  ? 'Try adjusting your search query or filter criteria.'
                  : 'Start evaluating suppliers by selecting BOM parts, mapping processes, and benchmarking OEM target prices.'}
              </p>
            </div>
            {!searchTerm && statusFilter === 'all' && (
              <Button onClick={onNewEvaluation} className="gap-2">
                <Plus className="h-4 w-4" />
                Create First Evaluation Program
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredGroups.map((group) => (
            <OEMEvaluationCard
              key={group.id}
              group={group}
              onClick={() => { onSelectEvaluationGroup(group.id); }}
              onEdit={(g) => {
                setGroupToEdit(g);
                setEditDialogOpen(true);
              }}
            />
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <EditSupplierEvaluationDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        group={groupToEdit}
        onSuccess={() => {
          setGroupToEdit(null);
        }}
      />
    </div>
  );
}

interface OEMEvaluationCardProps {
  group: any;
  onClick: () => void;
  onEdit: (group: any) => void;
}

function OEMEvaluationCard({ group, onClick, onEdit }: OEMEvaluationCardProps) {
  const partsCount = group.bomItemsCount || group.bomItems?.length || 0;
  const processesCount = group.processesCount || group.processes?.length || 0;
  const [deletingGroup, setDeletingGroup] = useState(false);
  const queryClient = useQueryClient();

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

  // Compute qualification funnel stage (for OEM visual indicator)
  const funnelStage = useMemo(() => {
    if (status === 'completed') return 4;
    if (processesCount > 0 && partsCount > 0) return 3;
    if (partsCount > 0) return 2;
    return 1;
  }, [status, partsCount, processesCount]);

  const handleDeleteGroup = async () => {
    setDeletingGroup(true);
    try {
      const { validateSupplierEvaluationGroupDeletion, deleteSupplierEvaluationGroup } = await import('@/lib/api/supplier-evaluation-groups');

      let validation: any = null;
      let confirmMessage = `Are you sure you want to delete OEM Evaluation Program "${group.name || 'Unnamed Program'}"?\n\nThis action cannot be undone.`;

      try {
        validation = await validateSupplierEvaluationGroupDeletion(group.id);
        if (validation && typeof validation.canDelete !== 'undefined') {
          if (!validation.canDelete) {
            const blockersMessage = (validation.blockers || []).join(', ');
            toast.error('Cannot delete evaluation program: ' + blockersMessage);
            setDeletingGroup(false);
            return;
          }
          if (validation.warnings && validation.warnings.length > 0) {
            confirmMessage += '\n\nWarnings:\n' + validation.warnings.map((w: string) => `• ${w}`).join('\n');
          }
        }
      } catch {
        // Fallback to confirm
      }

      const confirmed = window.confirm(confirmMessage);
      if (!confirmed) {
        setDeletingGroup(false);
        return;
      }

      await deleteSupplierEvaluationGroup(group.id);
      await queryClient.invalidateQueries({ queryKey: ['supplier-evaluation-groups'] });
      toast.success('Evaluation program removed');
    } catch (error) {
      console.error('Failed to delete group:', error);
      toast.error('Failed to remove evaluation program.');
    } finally {
      setDeletingGroup(false);
    }
  };

  return (
    <Card
      onClick={onClick}
      className="group relative flex cursor-pointer flex-col overflow-hidden transition-colors hover:border-primary/50"
    >
      <CardContent className="flex flex-1 flex-col gap-5 p-5">
        {/* Status, title and action menu */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${currentStatusConfig.className}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${currentStatusConfig.dotColor}`} />
              {currentStatusConfig.label}
            </span>

            <div onClick={(e) => { e.stopPropagation(); }}>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="-mr-2 h-8 w-8 text-muted-foreground"
                    aria-label="Program actions"
                    disabled={deletingGroup}
                  >
                    {deletingGroup ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={onClick}>
                    <ArrowUpRight className="mr-2 h-4 w-4" />
                    Open Evaluation
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => { onEdit(group); }}>
                    <Edit className="mr-2 h-4 w-4" />
                    Edit program
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => { void handleDeleteGroup(); }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete program
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div>
            <h3 className="line-clamp-1 text-base font-semibold leading-snug text-foreground transition-colors group-hover:text-primary">
              {group.name || 'Unnamed Evaluation Program'}
            </h3>
            {group.description ? (
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {group.description}
              </p>
            ) : (
              <p className="mt-1 text-xs italic text-muted-foreground/60">
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

        {/* Qualification stage */}
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
          <div className="grid grid-cols-4 gap-1.5" aria-hidden="true">
            {[1, 2, 3, 4].map((step) => (
              <div
                key={step}
                className={`h-1.5 rounded-full ${step <= funnelStage ? 'bg-primary' : 'bg-muted'}`}
              />
            ))}
          </div>
        </div>

        {/* Footer */}
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
              onClick();
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
