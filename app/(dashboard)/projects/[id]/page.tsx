'use client';

import { useParams, useRouter } from 'next/navigation';

import { StatusBadge } from '@/components/common/status-badge';
import { ProjectDetailsCard } from '@/components/features/projects/ProjectDetailsCard';
import { ProjectModules } from '@/components/features/projects/ProjectModules';
import { ProjectNav } from '@/components/features/projects/ProjectNav';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  ArrowLeft,
  ClipboardList,
  DollarSign,
  FileSpreadsheet,
  TrendingUp,
} from '@/components/ui/icons';
import { PageSkeleton } from '@/components/ui/loading-skeleton';
import { useProject, useBOMs, useUpdateProject } from '@/lib/api/hooks';
import { formatProjectMoney, projectCostCurrency } from '@/lib/costing/project-costs';

export default function ProjectDetail() {
  const params = useParams<{ id: string }>();
  const id = params?.id || '';
  const router = useRouter();

  const {
    data: project,
    isLoading: projectLoading,
    error: projectError,
    isError: isProjectError
  } = useProject(id);

  const { data: sourcingListsData } = useBOMs({ projectId: id });
  const sourcingLists = sourcingListsData?.boms || [];
  const firstBomId = sourcingLists.length > 0 && sourcingLists[0] ? sourcingLists[0].id : undefined;

  const updateProjectMutation = useUpdateProject();

  const handleUpdateProject = async (data: {
    name?: string;
    description?: string;
    country?: string;
    state?: string;
    city?: string;
  }) => {
    // Check if there's any data to update
    if (!data.name && data.description === undefined && data.country === undefined && data.state === undefined && data.city === undefined) {
      return;
    }

    await updateProjectMutation.mutateAsync({
      id,
      data: {
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.country !== undefined && { country: data.country }),
        ...(data.state !== undefined && { state: data.state }),
        ...(data.city !== undefined && { city: data.city }),
      },
    });
  };

  // Loading state
  if (projectLoading) {
    return (
      <PageSkeleton label="Loading project…" />
    );
  }

  // Error state - show detailed error information
  if (isProjectError || !project) {
    const errorMessage = projectError?.message || 'Project not found';
    const is404 = (projectError as any)?.statusCode === 404;
    const is400 = (projectError as any)?.statusCode === 400;

    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <ArrowLeft className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <h3 className="font-semibold text-lg mb-2">
                {is404 ? 'Project Not Found' : is400 ? 'Invalid Project ID' : 'Error Loading Project'}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {is404
                  ? 'This project may have been deleted or you may not have access to it.'
                  : is400
                  ? 'The project ID format is invalid.'
                  : errorMessage}
              </p>
              {!is404 && !is400 && (
                <p className="text-xs text-muted-foreground">
                  Error: {errorMessage}
                </p>
              )}
            </div>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={() => router.push('/projects')}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Projects
              </Button>
              {!is404 && !is400 && (
                <Button variant="default" onClick={() => window.location.reload()}>
                  Retry
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const stats = [
    {
      label: 'Target Cost',
      icon: DollarSign,
      value: project.targetPrice ? `$${Number(project.targetPrice).toLocaleString()}` : '-',
    },
    {
      label: 'Should Cost',
      icon: TrendingUp,
      value: formatProjectMoney(project.actualCost, projectCostCurrency(project)),
    },
    { label: 'Active BOMs', icon: FileSpreadsheet, value: String(sourcingLists.length) },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Project header */}
      <div className="flex items-start gap-3">
        <Button
          variant="outline"
          size="icon"
          className="mt-0.5 h-8 w-8 shrink-0"
          aria-label="Back to projects"
          onClick={() => router.push('/projects')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <PageHeader
            title={project.name}
            description={project.description || 'Project overview and cost management'}
          >
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="text-xs font-medium text-muted-foreground">Status</span>
              <StatusBadge status={project.status} />
            </div>
          </PageHeader>
        </div>
      </div>

      {/* Workflow tabs: shared project tab bar, same links as before plus Overview */}
      <ProjectNav projectId={id} className="-mb-2" />

      {/* Cost overview */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map(({ label, icon: Icon, value }) => (
          <Card key={label}>
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">{label}</p>
                <p className="mt-1 truncate text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Project details */}
      <ProjectDetailsCard project={project} onUpdate={handleUpdateProject} />

      {/* Project Modules */}
      <ProjectModules projectId={id} bomCount={sourcingLists.length} {...(firstBomId !== undefined ? { firstBomId } : {})} />
    </div>
  );
}
