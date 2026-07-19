'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Package,
  Users,
  FileText,
  Search,
  Plus,
  ChevronRight,
  Edit,
  Trash2,
  Loader2,
  ShieldCheck,
  Award,
  Factory,
  Sparkles,
  Layers,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  Filter,
  Wrench,
  TrendingUp,
  FolderKanban
} from 'lucide-react';
import { useVendors } from '@/lib/api/hooks/useVendors';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
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

  return (
    <div className="space-y-8">
      {/* OEM Executive Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-card/90 via-card to-primary/5 p-6 md:p-8 shadow-sm">
        <div className="absolute -right-12 -top-12 h-64 w-64 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
        <div className="absolute right-1/4 -bottom-12 h-48 w-48 rounded-full bg-teal-500/10 blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-foreground">
              OEM Supplier Evaluation Groups
            </h1>
            <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
              Evaluate suppliers across manufacturing processes, benchmark should-cost vs. vendor quotations, and manage OEM qualification pipelines.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={onNewEvaluation}
              size="lg"
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md shadow-primary/20 transition-all hover:scale-[1.02]"
            >
              <Plus className="h-4 w-4 mr-2" />
              New Evaluation Program
            </Button>
          </div>
        </div>

        {/* KPI Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-8 pt-6 border-t border-border/40">
          <div className="flex items-center gap-4 rounded-xl border border-border/40 bg-card/60 p-4 backdrop-blur-sm">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Layers className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Evaluation Programs</p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-2xl font-bold text-foreground">{(evaluationGroups || []).length}</span>
                {activeProgramsCount > 0 && (
                  <span className="text-xs font-medium text-emerald-500">({activeProgramsCount} active)</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 rounded-xl border border-border/40 bg-card/60 p-4 backdrop-blur-sm">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-teal-500/10 text-teal-500">
              <Package className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">BOM Parts Under Audit</p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-2xl font-bold text-foreground">{totalParts}</span>
                <span className="text-xs text-muted-foreground">parts</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 rounded-xl border border-border/40 bg-card/60 p-4 backdrop-blur-sm">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-500">
              <Factory className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">OEM Vendor Network</p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-2xl font-bold text-foreground">{totalVendorsInDb}</span>
                <span className="text-xs text-muted-foreground">suppliers</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 rounded-xl border border-border/40 bg-card/60 p-4 backdrop-blur-sm">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
              <Wrench className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Process Routes</p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-2xl font-bold text-foreground">{totalProcesses}</span>
                <span className="text-xs text-muted-foreground">mapped</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-border/60 bg-card/80 p-4 backdrop-blur">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search evaluation programs by name or scope..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 bg-background/80 border-border/80 text-foreground placeholder:text-muted-foreground"
          />
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto p-1 rounded-lg bg-muted/50 border border-border/40">
          {(['all', 'active', 'completed', 'draft'] as const).map((status) => {
            const isActive = statusFilter === status;
            return (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-all ${
                  isActive
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
                }`}
              >
                {status}
              </button>
            );
          })}
        </div>
      </div>

      {/* Program Evaluation Cards Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse border border-border/50 bg-card">
              <CardContent className="p-6 space-y-4">
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
        <Card className="border border-dashed border-border/80 bg-card/40 py-16 text-center">
          <CardContent className="max-w-md mx-auto space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Award className="h-8 w-8" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-foreground">
                {searchTerm || statusFilter !== 'all' ? 'No matching evaluation programs' : 'No supplier evaluation programs yet'}
              </h3>
              <p className="text-sm text-muted-foreground">
                {searchTerm || statusFilter !== 'all'
                  ? 'Try adjusting your search query or filter criteria.'
                  : 'Start evaluating suppliers by selecting BOM parts, mapping processes, and benchmarking OEM target prices.'}
              </p>
            </div>
            {!searchTerm && statusFilter === 'all' && (
              <Button
                onClick={onNewEvaluation}
                className="mt-2 bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create First Evaluation Program
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredGroups.map((group) => (
            <OEMEvaluationCard
              key={group.id}
              group={group}
              onClick={() => onSelectEvaluationGroup(group.id)}
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

  const statusBadgeConfigs: Record<string, { label: string; className: string; dotColor: string }> = {
    active: {
      label: 'Active Audit',
      className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
      dotColor: 'bg-emerald-500'
    },
    completed: {
      label: 'Qualified / Complete',
      className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
      dotColor: 'bg-blue-500'
    },
    draft: {
      label: 'Draft Program',
      className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
      dotColor: 'bg-amber-500'
    },
    archived: {
      label: 'Archived',
      className: 'bg-muted text-muted-foreground border-border',
      dotColor: 'bg-gray-400'
    }
  };

  const currentStatusConfig = statusBadgeConfigs[status] || statusBadgeConfigs.draft;

  // Compute qualification funnel stage (for OEM visual indicator)
  const funnelStage = useMemo(() => {
    if (status === 'completed') return 4;
    if (processesCount > 0 && partsCount > 0) return 3;
    if (partsCount > 0) return 2;
    return 1;
  }, [status, partsCount, processesCount]);

  const handleEditGroup = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit(group);
  };

  const handleDeleteGroup = async (e: React.MouseEvent) => {
    e.stopPropagation();
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
      className="group relative flex flex-col justify-between rounded-xl border border-border/60 bg-card/90 shadow-sm hover:shadow-lg hover:border-primary/50 transition-all duration-300 cursor-pointer overflow-hidden"
    >
      {/* Top accent border bar */}
      <div className="h-1.5 w-full bg-gradient-to-r from-primary/80 via-teal-500 to-purple-500 opacity-80 group-hover:opacity-100 transition-opacity" />

      {/* Edit/Delete Action Hover Strip */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-card/90 backdrop-blur rounded-lg border border-border/60 p-0.5 shadow-sm">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-muted"
          onClick={handleEditGroup}
          title="Edit program"
        >
          <Edit className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onClick={handleDeleteGroup}
          disabled={deletingGroup}
          title="Delete program"
        >
          {deletingGroup ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      <CardContent className="p-6 flex-1 flex flex-col justify-between space-y-5">
        {/* Title & Status */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${currentStatusConfig.className}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${currentStatusConfig.dotColor} ${status === 'active' ? 'animate-pulse' : ''}`} />
              {currentStatusConfig.label}
            </span>
          </div>

          <div>
            <h3 className="text-lg font-bold text-foreground leading-snug group-hover:text-primary transition-colors pr-12 line-clamp-1">
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

        {/* OEM Procurement Metrics Box */}
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/30 border border-border/40 p-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Package className="h-4.5 w-4.5" />
            </div>
            <div>
              <p className="text-lg font-bold text-foreground leading-none">{partsCount}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">BOM Parts</p>
            </div>
          </div>

          <div className="flex items-center gap-3 border-l border-border/40 pl-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-500/10 text-teal-500">
              <Wrench className="h-4.5 w-4.5" />
            </div>
            <div>
              <p className="text-lg font-bold text-foreground leading-none">{processesCount}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Processes</p>
            </div>
          </div>
        </div>

        {/* OEM Qualification Funnel Progress */}
        <div className="space-y-2 pt-1">
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
                    ? 'bg-gradient-to-r from-primary to-teal-500'
                    : 'bg-muted/60'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Footer Actions & Metadata */}
        <div className="pt-2 border-t border-border/40 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            Created {new Date(group.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>

          <Button
            size="sm"
            className="h-8 rounded-lg bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground text-xs font-semibold px-3 transition-all group-hover:translate-x-0.5"
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
          >
            Open Evaluation
            <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}