'use client';

import { useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/PageHeader';
import { WorkflowNavigation } from '@/components/features/workflow/WorkflowNavigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import {
  NewEvaluationDialog,
  SupplierEvaluationDashboard,
  EvaluationGroupView
} from '@/components/features/supplier-evaluation';
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
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setCurrentView('dashboard')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <PageHeader
              title="Loading Evaluation Group..."
              description="Fetching BOM parts and evaluation data"
            />
          </div>
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
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
      price: undefined, // No price data in evaluation group
      file2dPath: undefined,
      file3dPath: undefined
    }));

    return (
      <EvaluationGroupView
        projectId={projectId}
        evaluationGroupName={selectedEvaluationGroup?.name || selectedEvaluationGroupData?.name}
        bomParts={bomParts}
        onViewFile={handleViewFile}
        onBack={handleBackToDashboard}
      />
    );
  }

  if (currentView === 'dashboard') {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/projects/${projectId}`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <PageHeader
            title="Supplier Evaluation"
            description="Process-based supplier matching and evaluation groups"
          />
        </div>

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
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push(`/projects/${projectId}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <PageHeader
          title="Supplier Evaluation"
          description="Something went wrong"
        />
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