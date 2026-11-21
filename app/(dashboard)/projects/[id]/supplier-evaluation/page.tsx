'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState, useCallback } from 'react';

import { ProjectNav } from '@/components/features/projects/ProjectNav';
import {
  NewEvaluationDialog,
  SupplierEvaluationDashboard,
  EvaluationGroupView
} from '@/components/features/supplier-evaluation';
import { WorkflowNavigation } from '@/components/features/workflow/WorkflowNavigation';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from '@/components/ui/icons';
import { TableSkeleton } from '@/components/ui/loading-skeleton';
import { useSupplierEvaluationGroups, useSupplierEvaluationGroup } from '@/lib/api/hooks/useSupplierEvaluationGroups';

export default function SupplierEvaluationPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = params?.id || '';

  // View state management
  const [currentView, setCurrentView] = useState<'dashboard' | 'evaluation' | 'legacy'>('dashboard');
  const [selectedEvaluationGroupId, setSelectedEvaluationGroupId] = useState<string | null>(null);
  const [newEvaluationDialogOpen, setNewEvaluationDialogOpen] = useState(false);

  // Fetch evaluation groups for this project
  const { data: evaluationGroupsData, isLoading: isLoadingGroups } = useSupplierEvaluationGroups(projectId);
  const evaluationGroups = evaluationGroupsData || [];

  // Fetch specific evaluation group data when in evaluation view
  const { data: selectedEvaluationGroupData, isLoading: isLoadingEvaluationGroup } = useSupplierEvaluationGroup(
    currentView === 'evaluation' ? selectedEvaluationGroupId || undefined : undefined
  );

// View handlers
  const handleSelectEvaluationGroup = useCallback((groupId: string) => {
    setSelectedEvaluationGroupId(groupId);
    setCurrentView('evaluation');
  }, []);

  const handleBackToDashboard = useCallback(() => {
    setCurrentView('dashboard');
    setSelectedEvaluationGroupId(null);
  }, []);

  const handleNewEvaluation = useCallback(() => {
    setNewEvaluationDialogOpen(true);
  }, []);

  const handleEvaluationSuccess = useCallback(() => {
    // Close dialog and stay on dashboard
    setNewEvaluationDialogOpen(false);
    setCurrentView('dashboard');
  }, []);

  const handleViewFile = useCallback((part: any, fileType: '2d' | '3d') => {
    const filePath = fileType === '2d' ? part.file2dPath : part.file3dPath;
    if (filePath) {
      // Open file in new tab/window
      window.open(filePath, '_blank');
    }
  }, []);

// Render based on current view
  if (currentView === 'evaluation' && selectedEvaluationGroupId) {
    const selectedEvaluationGroup = evaluationGroups.find(group => group.id === selectedEvaluationGroupId);

    // Show loading state while fetching evaluation group data
    if (isLoadingEvaluationGroup) {
      return (
        <div className="space-y-6">
          <div className="flex items-start gap-3">
            <Button variant="outline" size="icon" className="mt-0.5 h-8 w-8 shrink-0" aria-label="Back to evaluations" onClick={() => setCurrentView('dashboard')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <PageHeader
              title="Loading Evaluation Group..."
              description="Fetching BOM parts and evaluation data"
              />
            </div>
          </div>
          <TableSkeleton rows={5} columns={4} label="Loading evaluation group…" />
        </div>
      );
    }

    // Transform BOM items from evaluation group data to the expected format
    const bomParts = (selectedEvaluationGroupData?.bomItems || []).map(item => ({
      id: item.id,
      partNumber: item.partNumber || item.name,
      description: item.name,
      category: item.material || '', // Use actual material or empty
      process: '', // Let users define process based on vendor requirements
      quantity: item.quantity,
      // No price/file data available from evaluation group; omit rather than assign undefined
    }));

    const evaluationGroupName = selectedEvaluationGroup?.name || selectedEvaluationGroupData?.name;

    return (
      <EvaluationGroupView
        projectId={projectId}
        {...(evaluationGroupName !== undefined ? { evaluationGroupName } : {})}
        bomParts={bomParts}
        onViewFile={handleViewFile}
        onBack={handleBackToDashboard}
      />
    );
  }

  if (currentView === 'dashboard') {
    return (
      <div className="space-y-6">
        <div className="flex items-start gap-3">
          <Button variant="outline" size="icon" className="mt-0.5 h-8 w-8 shrink-0" aria-label="Back to project" onClick={() => router.push(`/projects/${projectId}`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <PageHeader
            title="Supplier Evaluation"
            description="Process-based supplier matching and evaluation groups"
            />
          </div>
        </div>

        {/* Project sections: shared tab bar, Supplier Evaluation is the active tab */}
        <ProjectNav projectId={projectId} />

        <SupplierEvaluationDashboard
          projectId={projectId}
          evaluationGroups={evaluationGroups}
          isLoading={isLoadingGroups}
          onNewEvaluation={handleNewEvaluation}
          onSelectEvaluationGroup={handleSelectEvaluationGroup}
        />

        {/* New Evaluation Dialog */}
        <NewEvaluationDialog
          open={newEvaluationDialogOpen}
          onOpenChange={setNewEvaluationDialogOpen}
          onSuccess={handleEvaluationSuccess}
        />

        {/* Workflow Navigation */}
        <WorkflowNavigation 
          currentModuleId="supplier-evaluation" 
          projectId={projectId}
        />
      </div>
    );
  }

  // Default fallback - should not reach here with dashboard view
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Button variant="outline" size="icon" className="mt-0.5 h-8 w-8 shrink-0" aria-label="Back to project" onClick={() => router.push(`/projects/${projectId}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <PageHeader
          title="Supplier Evaluation"
          description="Something went wrong"
          />
        </div>
      </div>
      <div className="text-center py-12">
        <p>Unknown view state. Please refresh the page.</p>
        <Button onClick={() => setCurrentView('dashboard')} className="mt-4">
          Go to Dashboard
        </Button>
      </div>
    </div>
  );
}