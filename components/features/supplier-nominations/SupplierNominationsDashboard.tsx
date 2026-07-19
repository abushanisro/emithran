'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Plus,
  Search,
  Users,
  Award,
  Calendar,
  Building2,
  Factory,
  Zap,
  Edit2,
  Trash2,
  ArrowLeft,
  Package,
  Layers,
  CheckCircle2,
  ArrowUpRight,
  Loader2,
  TrendingUp,
  FolderKanban
} from 'lucide-react';
import { useSupplierNominations, useDeleteSupplierNomination } from '@/lib/api/hooks/useSupplierNominations';
import { useBOMs } from '@/lib/api/hooks/useBOM';
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse border border-border/50 bg-card">
              <CardContent className="p-6 space-y-4">
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

  return (
    <div className="space-y-8">
      {/* Back Button & Header Row */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/projects/${projectId}`)}
          className="text-muted-foreground hover:text-foreground hover:bg-muted"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Project
        </Button>
      </div>

      {/* OEM Executive Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-card/90 via-card to-primary/5 p-6 md:p-8 shadow-sm">
        <div className="absolute -right-12 -top-12 h-64 w-64 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
        <div className="absolute right-1/4 -bottom-12 h-48 w-48 rounded-full bg-teal-500/10 blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-foreground">
              OEM Supplier Nomination Groups
            </h1>
            <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
              Evaluate and nominate suppliers for OEM and manufacturing partnerships, track BOM part allocations, and finalize vendor awards.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => setCreateDialogOpen(true)}
              size="lg"
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md shadow-primary/20 transition-all hover:scale-[1.02]"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Nomination
            </Button>
          </div>
        </div>

        {/* Currently Selected BOM Info */}
        {selectedBomId && (
          <div className="mt-6 flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 p-3.5">
            <div className="flex items-center gap-3">
              <Package className="h-5 w-5 text-primary" />
              <div>
                <h4 className="font-medium text-foreground text-sm">
                  BOM Selected: {boms.find(b => b.id === selectedBomId)?.name || 'Unknown BOM'}
                </h4>
                <p className="text-xs text-muted-foreground">Ready for part-wise nominations</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.location.href = window.location.pathname}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear Selection
            </Button>
          </div>
        )}

        {/* KPI Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-8 pt-6 border-t border-border/40">
          <div className="flex items-center gap-4 rounded-xl border border-border/40 bg-card/60 p-4 backdrop-blur-sm">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Layers className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Nominations</p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-2xl font-bold text-foreground">{stats.total}</span>
                {stats.inProgress > 0 && (
                  <span className="text-xs font-medium text-amber-500">({stats.inProgress} active)</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 rounded-xl border border-border/40 bg-card/60 p-4 backdrop-blur-sm">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-500">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Vendors Nominated</p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-2xl font-bold text-foreground">{stats.totalVendors}</span>
                <span className="text-xs text-muted-foreground">suppliers</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 rounded-xl border border-border/40 bg-card/60 p-4 backdrop-blur-sm">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Completed / Approved</p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-2xl font-bold text-foreground">{stats.completed}</span>
                <span className="text-xs text-muted-foreground">groups</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 rounded-xl border border-border/40 bg-card/60 p-4 backdrop-blur-sm">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-teal-500/10 text-teal-500">
              <Package className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">BOM Parts Nominated</p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-2xl font-bold text-foreground">{stats.totalBomParts}</span>
                <span className="text-xs text-muted-foreground">parts</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-border/60 bg-card/80 p-4 backdrop-blur">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search nominations by name or scope..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 bg-background/80 border-border/80 text-foreground placeholder:text-muted-foreground"
          />
        </div>

        {/* Category Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto p-1 rounded-lg bg-muted/50 border border-border/40">
          {(['all', NominationType.OEM, NominationType.MANUFACTURER, NominationType.HYBRID] as const).map((type) => {
            const isActive = selectedType === type;
            const label = type === 'all' ? 'All Groups' : getNominationTypeLabel(type as NominationType);
            return (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Nominations Grid */}
      {filteredNominations.length === 0 ? (
        <Card className="border border-dashed border-border/80 bg-card/40 py-16 text-center">
          <CardContent className="max-w-md mx-auto space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Award className="h-8 w-8" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-foreground">
                {searchTerm || selectedType !== 'all' ? 'No matching supplier nominations' : 'No supplier nominations yet'}
              </h3>
              <p className="text-sm text-muted-foreground">
                {searchTerm || selectedType !== 'all'
                  ? 'Try adjusting your search query or category filter.'
                  : 'Create your first nomination group to evaluate and allocate suppliers to BOM parts.'}
              </p>
            </div>
            {!searchTerm && selectedType === 'all' && (
              <Button
                onClick={() => setCreateDialogOpen(true)}
                className="mt-2 bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create First Nomination
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
        evaluationGroupId={evaluationGroupId}
        onSuccess={handleCreateSuccess}
      />

      <EditNominationDialog
        nomination={editingNomination}
        onClose={() => setEditingNomination(null)}
        projectId={projectId}
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
  const statusColor = getStatusColor(nomination.status);
  const statusText = getStatusText(nomination.status);
  const typeLabel = getNominationTypeLabel(nomination.nominationType);

  const isCompleted = nomination.status === NominationStatus.COMPLETED || nomination.status === NominationStatus.APPROVED;
  const isInProgress = nomination.status === NominationStatus.IN_PROGRESS;

  return (
    <Card
      onClick={onClick}
      className="group relative flex flex-col justify-between rounded-xl border border-border/60 bg-card/90 shadow-sm hover:shadow-lg hover:border-primary/50 transition-all duration-300 cursor-pointer overflow-hidden"
    >
      {/* Top accent bar */}
      <div className="h-1.5 w-full bg-gradient-to-r from-primary/80 via-teal-500 to-purple-500 opacity-80 group-hover:opacity-100 transition-opacity" />

      {/* Edit/Delete Action Hover Strip */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-card/90 backdrop-blur rounded-lg border border-border/60 p-0.5 shadow-sm">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-muted"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(nomination);
          }}
          title="Edit nomination"
        >
          <Edit2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(nomination);
          }}
          title="Delete nomination"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <CardContent className="p-6 flex-1 flex flex-col justify-between space-y-5">
        {/* Title, Badges & Status */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5 pr-12">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                isCompleted
                  ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30'
                  : isInProgress
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isCompleted ? 'bg-blue-500' : isInProgress ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                }`}
              />
              {statusText}
            </span>

            <Badge variant="secondary" className="text-[11px] font-medium">
              {typeLabel}
            </Badge>

            {nomination.bomPartsCount && nomination.bomPartsCount > 0 && (
              <Badge variant="outline" className="text-[11px] border-primary/40 text-primary bg-primary/5">
                BOM-Based
              </Badge>
            )}
          </div>

          <div>
            <h3 className="text-lg font-bold text-foreground leading-snug group-hover:text-primary transition-colors line-clamp-1">
              {nomination.nominationName || 'Unnamed Nomination Group'}
            </h3>
          </div>
        </div>

        {/* OEM Procurement Metrics Box */}
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/30 border border-border/40 p-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Users className="h-4.5 w-4.5" />
            </div>
            <div>
              <p className="text-lg font-bold text-foreground leading-none">{nomination.vendorCount || 0}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Vendors</p>
            </div>
          </div>

          <div className="flex items-center gap-3 border-l border-border/40 pl-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-500/10 text-teal-500">
              <Package className="h-4.5 w-4.5" />
            </div>
            <div>
              <p className="text-lg font-bold text-foreground leading-none">{nomination.bomPartsCount || 0}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">BOM Parts</p>
            </div>
          </div>
        </div>

        {/* Completion Bar */}
        <div className="space-y-1.5 pt-1">
          <div className="flex justify-between text-[11px]">
            <span className="font-medium text-muted-foreground">Allocation Progress</span>
            <span className="font-semibold text-foreground">{nomination.completionPercentage || 0}%</span>
          </div>
          <div className="w-full bg-muted/70 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-gradient-to-r from-primary to-teal-500 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, nomination.completionPercentage || 0))}%` }}
            />
          </div>
        </div>

        {/* Footer Actions & Metadata */}
        <div className="pt-2 border-t border-border/40 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            Created {new Date(nomination.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>

          <Button
            size="sm"
            className="h-8 rounded-lg bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground text-xs font-semibold px-3 transition-all group-hover:translate-x-0.5"
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
          >
            Open Nomination
            <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}