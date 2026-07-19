'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Package,
  Users,
  Search,
  Plus,
  FolderKanban,
  Award,
  Layers,
  CheckCircle2,
  ArrowUpRight,
  Loader2
} from 'lucide-react';
import { useProjects } from '@/lib/api/hooks/useProjects';
import { useSupplierNominations } from '@/lib/api/hooks/useSupplierNominations';
import {
  NominationStatus,
  NominationType,
  getStatusColor,
  getStatusText,
  getNominationTypeLabel,
  type SupplierNominationSummary
} from '@/lib/api/supplier-nominations';

export default function SupplierNominationsPage() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<NominationType | 'all'>('all');

  const { data: projectsData, isLoading: isLoadingProjects } = useProjects();
  const projects = projectsData?.projects || [];

  return (
    <SupplierNominationsGlobalContent
      projects={projects}
      isLoadingProjects={isLoadingProjects}
      searchTerm={searchTerm}
      setSearchTerm={setSearchTerm}
      selectedType={selectedType}
      setSelectedType={setSelectedType}
      router={router}
    />
  );
}

interface SupplierNominationsGlobalContentProps {
  projects: any[];
  isLoadingProjects: boolean;
  searchTerm: string;
  setSearchTerm: (val: string) => void;
  selectedType: NominationType | 'all';
  setSelectedType: (type: NominationType | 'all') => void;
  router: any;
}

function SupplierNominationsGlobalContent({
  projects,
  isLoadingProjects,
  searchTerm,
  setSearchTerm,
  selectedType,
  setSelectedType,
  router,
}: SupplierNominationsGlobalContentProps) {
  return (
    <div className="space-y-8">
      {/* OEM Executive Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-card/90 via-card to-primary/5 p-6 md:p-8 shadow-sm">
        <div className="absolute -right-12 -top-12 h-64 w-64 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
        <div className="absolute right-1/4 -bottom-12 h-48 w-48 rounded-full bg-teal-500/10 blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-foreground">
              Supplier Nominations Portfolio
            </h1>
            <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
              Evaluate and nominate suppliers for OEM and manufacturing partnerships, allocate BOM parts, and track program readiness across all projects.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => router.push('/projects')}
              size="lg"
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md shadow-primary/20 transition-all hover:scale-[1.02]"
            >
              <Plus className="h-4 w-4 mr-2" />
              New Nomination Group
            </Button>
          </div>
        </div>

        {/* Global Executive KPIs Row */}
        <GlobalNominationsSummary projects={projects} />
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-border/60 bg-card/80 p-4 backdrop-blur">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search nominations by name or project..."
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

      {/* Project Nominations Grid */}
      {isLoadingProjects ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
      ) : projects.length === 0 ? (
        <Card className="border border-dashed border-border/80 bg-card/40 py-16 text-center">
          <CardContent className="max-w-md mx-auto space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Award className="h-8 w-8" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-foreground">No projects found</h3>
              <p className="text-sm text-muted-foreground">
                Create an OEM project first to start supplier nominations and allocation programs.
              </p>
            </div>
            <Button
              onClick={() => router.push('/projects')}
              className="mt-2 bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
            >
              <FolderKanban className="h-4 w-4 mr-2" />
              Go to Projects
            </Button>
          </CardContent>
        </Card>
      ) : (
        <AllProjectsNominationsList
          projects={projects}
          searchTerm={searchTerm}
          selectedType={selectedType}
          router={router}
        />
      )}
    </div>
  );
}

function GlobalNominationsSummary({ projects }: { projects: any[] }) {
  // We compute total projects count and summarize display
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-8 pt-6 border-t border-border/40">
      <div className="flex items-center gap-4 rounded-xl border border-border/40 bg-card/60 p-4 backdrop-blur-sm">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Layers className="h-6 w-6" />
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Projects</p>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-2xl font-bold text-foreground">{projects.length}</span>
            <span className="text-xs text-muted-foreground">groups</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 rounded-xl border border-border/40 bg-card/60 p-4 backdrop-blur-sm">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-500">
          <Users className="h-6 w-6" />
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Vendor Allocation</p>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-2xl font-bold text-foreground">Multi-OEM</span>
            <span className="text-xs text-muted-foreground">network</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 rounded-xl border border-border/40 bg-card/60 p-4 backdrop-blur-sm">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Allocation Method</p>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-lg font-bold text-foreground">BOM Part &amp; Process</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 rounded-xl border border-border/40 bg-card/60 p-4 backdrop-blur-sm">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-teal-500/10 text-teal-500">
          <Package className="h-6 w-6" />
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Nomination Engine</p>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-lg font-bold text-foreground">Active</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AllProjectsNominationsList({
  projects,
  searchTerm,
  selectedType,
  router,
}: {
  projects: any[];
  searchTerm: string;
  selectedType: NominationType | 'all';
  router: any;
}) {
  return (
    <div className="space-y-8">
      {projects.map((project) => (
        <ProjectNominationsSection
          key={project.id}
          project={project}
          searchTerm={searchTerm}
          selectedType={selectedType}
          router={router}
        />
      ))}
    </div>
  );
}

function ProjectNominationsSection({
  project,
  searchTerm,
  selectedType,
  router,
}: {
  project: any;
  searchTerm: string;
  selectedType: NominationType | 'all';
  router: any;
}) {
  const { data: rawNominations = [], isLoading } = useSupplierNominations(project.id) as { data: SupplierNominationSummary[], isLoading: boolean };

  const nominations = useMemo(() => {
    const seen = new Set();
    return (rawNominations || []).filter((n: SupplierNominationSummary) => {
      if (seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    });
  }, [rawNominations]);

  const filtered = useMemo(() => {
    return nominations.filter((nomination: SupplierNominationSummary) => {
      const matchesSearch =
        nomination.nominationName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        project.name?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesType = selectedType === 'all' || nomination.nominationType === selectedType;
      return matchesSearch && matchesType;
    });
  }, [nominations, searchTerm, selectedType, project.name]);

  if (isLoading) {
    return (
      <Card className="border border-border/50 bg-card/60">
        <CardContent className="p-6">
          <div className="animate-pulse flex items-center gap-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <div className="h-4 bg-muted rounded w-48" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (filtered.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FolderKanban className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="font-bold text-foreground text-base">{project.name}</h3>
            <p className="text-xs text-muted-foreground">
              {filtered.length} nomination group{filtered.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={() => router.push(`/projects/${project.id}/supplier-nomination`)}
          className="text-xs"
        >
          Open Project Nominations
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map((nomination) => (
          <GlobalOEMNominationCard
            key={nomination.id}
            nomination={nomination}
            projectName={project.name}
            onSelect={() => router.push(`/projects/${project.id}/supplier-nomination`)}
          />
        ))}
      </div>
    </div>
  );
}

function GlobalOEMNominationCard({
  nomination,
  projectName,
  onSelect,
}: {
  nomination: SupplierNominationSummary;
  projectName: string;
  onSelect: () => void;
}) {
  const statusText = getStatusText(nomination.status);
  const typeLabel = getNominationTypeLabel(nomination.nominationType);

  const isCompleted = nomination.status === NominationStatus.COMPLETED || nomination.status === NominationStatus.APPROVED;
  const isInProgress = nomination.status === NominationStatus.IN_PROGRESS;

  return (
    <Card
      onClick={onSelect}
      className="group relative flex flex-col justify-between rounded-xl border border-border/60 bg-card/90 shadow-sm hover:shadow-lg hover:border-primary/50 transition-all duration-300 cursor-pointer overflow-hidden"
    >
      {/* Top accent bar */}
      <div className="h-1.5 w-full bg-gradient-to-r from-primary/80 via-teal-500 to-purple-500 opacity-80 group-hover:opacity-100 transition-opacity" />

      <CardContent className="p-6 flex-1 flex flex-col justify-between space-y-5">
        {/* Title, Badges & Status */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
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

            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <FolderKanban className="h-3 w-3" />
              {projectName}
            </span>
          </div>

          <div>
            <h3 className="text-lg font-bold text-foreground leading-snug group-hover:text-primary transition-colors line-clamp-1">
              {nomination.nominationName || 'Unnamed Nomination Group'}
            </h3>
            <div className="flex items-center gap-1.5 mt-1.5">
              <Badge variant="secondary" className="text-[11px] font-medium">
                {typeLabel}
              </Badge>
              {nomination.bomPartsCount && nomination.bomPartsCount > 0 && (
                <Badge variant="outline" className="text-[11px] border-primary/40 text-primary bg-primary/5">
                  BOM-Based
                </Badge>
              )}
            </div>
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
              onSelect();
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
