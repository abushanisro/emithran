'use client';

import { useRouter } from 'next/navigation';
import { useState, useMemo } from 'react';

import { toneClasses } from '@/components/features/supplier-nominations/tone';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
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
} from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { useProjects } from '@/lib/api/hooks/useProjects';
import { useSupplierNominations } from '@/lib/api/hooks/useSupplierNominations';
import {
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
    <div className="space-y-6">
      <PageHeader
        title="Supplier Nominations Portfolio"
        description="Evaluate and nominate suppliers, allocate BOM parts and track program readiness across all projects"
      >
        <Button onClick={() => router.push('/projects')} className="gap-2">
          <Plus className="h-4 w-4" />
          New Nomination Group
        </Button>
      </PageHeader>

      {/* Global KPIs */}
      <GlobalNominationsSummary projects={projects} />

      {/* Toolbar: search and category filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            aria-label="Search nominations"
            placeholder="Search nominations by name or project..."
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

      {/* Project Nominations Grid */}
      {isLoadingProjects ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
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
      ) : projects.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Award}
              title="No projects found"
              description="Create an OEM project first to start supplier nominations and allocation programs."
            >
              <Button onClick={() => router.push('/projects')} className="gap-2">
                <FolderKanban className="h-4 w-4" />
                Go to Projects
              </Button>
            </EmptyState>
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
  const tiles = [
    { label: 'Active Projects', icon: Layers, value: String(projects.length), hint: 'groups' },
    { label: 'Vendor Allocation', icon: Users, value: 'Multi-OEM', hint: 'network' },
    { label: 'Allocation Method', icon: CheckCircle2, value: 'BOM Part & Process', hint: undefined },
    { label: 'Nomination Engine', icon: Package, value: 'Active', hint: undefined },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map(({ label, icon: Icon, value, hint }) => (
        <Card key={label}>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="truncate text-xl font-semibold tracking-tight">{value}</span>
                {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
              </p>
            </div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </div>
          </CardContent>
        </Card>
      ))}
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
    <div className="space-y-6">
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
      <Card>
        <CardContent className="p-5">
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
            <h3 className="text-base font-semibold text-foreground">{project.name}</h3>
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
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

  const completion = Math.min(100, Math.max(0, nomination.completionPercentage || 0));

  return (
    <Card
      onClick={onSelect}
      className="group relative flex cursor-pointer flex-col overflow-hidden transition-colors hover:border-primary/50"
    >
      <CardContent className="flex flex-1 flex-col gap-5 p-5">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${toneClasses(getStatusColor(nomination.status))}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {statusText}
            </span>

            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <FolderKanban className="h-3 w-3" />
              {projectName}
            </span>
          </div>

          <div>
            <h3 className="line-clamp-1 text-base font-semibold leading-snug text-foreground transition-colors group-hover:text-primary">
              {nomination.nominationName || 'Unnamed Nomination Group'}
            </h3>
            <div className="mt-1.5 flex items-center gap-1.5">
              <Badge variant="secondary" className="text-[11px] font-medium">
                {typeLabel}
              </Badge>
              {nomination.bomPartsCount && nomination.bomPartsCount > 0 && (
                <Badge variant="outline" className="border-primary/40 bg-primary/5 text-[11px] text-primary">
                  BOM-Based
                </Badge>
              )}
            </div>
          </div>
        </div>

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

        <div className="space-y-1.5">
          <div className="flex justify-between text-[11px]">
            <span className="font-medium text-muted-foreground">Allocation Progress</span>
            <span className="font-semibold tabular-nums text-foreground">{nomination.completionPercentage || 0}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={completion} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-1.5 rounded-full bg-primary transition-all duration-500" style={{ width: `${completion}%` }} />
          </div>
        </div>

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
              onSelect();
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
