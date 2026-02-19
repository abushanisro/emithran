'use client';

import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/status-badge';
import {
  ArrowLeft,
  ClipboardList,
  DollarSign,
  FileSpreadsheet,
  TrendingUp,
} from 'lucide-react';
import { useProject, useBOMs, useUpdateProject } from '@/lib/api/hooks';
import { ProjectModules } from '@/components/features/projects/ProjectModules';
import { ProjectDetailsCard } from '@/components/features/projects/ProjectDetailsCard';

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
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
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

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push('/projects')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <PageHeader
          title={project.name}
          description={project.description || 'Project overview and cost management'}
        />
      </div>

      {/* Project Details Card */}
      <ProjectDetailsCard project={project} onUpdate={handleUpdateProject} />

      {/* Cost Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-primary">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <ClipboardList className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Project Status</p>
                <StatusBadge status={project.status} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-green-500/10 flex items-center justify-center">
                <DollarSign className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Target Cost</p>
                <p className="text-xl font-bold text-foreground">
                  {project.targetPrice ? `₹${Number(project.targetPrice).toLocaleString()}` : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <TrendingUp className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Should Cost</p>
                <p className="text-xl font-bold text-foreground">
                  {project.shouldCost ? `$${Number(project.shouldCost).toLocaleString()}` : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-orange-500">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-orange-500/10 flex items-center justify-center">
                <FileSpreadsheet className="h-6 w-6 text-orange-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Active BOMs</p>
                <p className="text-xl font-bold text-foreground">{sourcingLists.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Project Modules */}
      <ProjectModules projectId={id} bomCount={sourcingLists.length} firstBomId={firstBomId} />
    </div>
  );
}
