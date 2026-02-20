'use client';

import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { WorkflowNavigation } from '@/components/features/workflow/WorkflowNavigation';
import { SupplierNominationsDashboard } from '@/components/features/supplier-nominations/SupplierNominationsDashboard';
import { SupplierNominationPage } from '@/components/features/supplier-nominations/SupplierNominationPage';
import { DetailedEvaluationView } from '@/components/features/supplier-nominations/DetailedEvaluationView';
import { useSupplierNomination } from '@/lib/api/hooks/useSupplierNominations';

export default function SupplierNominationMainPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const projectId = params.id as string;
  
  // Use URL as single source of truth - no local state
  const currentView = (searchParams.get('view') || 'dashboard') as 'dashboard' | 'nomination' | 'evaluation';
  const selectedNominationId = searchParams.get('nominationId');
  const selectedEvaluationId = searchParams.get('evaluationId');

  // Fetch nomination data only when we're actually viewing nomination or evaluation
  const shouldFetchNomination = (currentView === 'nomination' || currentView === 'evaluation') && selectedNominationId;
  const { data: nomination } = useSupplierNomination(shouldFetchNomination ? selectedNominationId : '');

  const handleSelectNomination = (id: string) => {
    router.push(`/projects/${projectId}/supplier-nomination?view=nomination&nominationId=${id}`);
  };

  const handleSelectEvaluation = (evaluationId: string) => {
    router.push(`/projects/${projectId}/supplier-nomination?view=evaluation&nominationId=${selectedNominationId}&evaluationId=${evaluationId}`);
  };

  const handleBackToDashboard = () => {
    router.push(`/projects/${projectId}/supplier-nomination`);
  };

  const handleBackToNomination = () => {
    router.push(`/projects/${projectId}/supplier-nomination?view=nomination&nominationId=${selectedNominationId}`);
  };

  // Render based on current view from URL
  if (currentView === 'evaluation' && selectedEvaluationId && nomination) {
    const evaluation = nomination.vendorEvaluations.find(e => e.id === selectedEvaluationId);
    if (evaluation) {
      // Create vendor object from evaluation data
      const vendor = {
        id: evaluation.vendorId,
        name: evaluation.vendorName
      };
      
      return (
        <DetailedEvaluationView
          evaluation={evaluation}
          vendor={vendor}
          criteria={nomination.criteria}
          nominationId={selectedNominationId!}
          onBack={handleBackToNomination}
        />
      );
    }
  }

  if (currentView === 'nomination' && selectedNominationId) {
    return (
      <SupplierNominationPage
        nominationId={selectedNominationId}
        projectId={projectId}
        onBack={handleBackToDashboard}
        onSelectEvaluation={handleSelectEvaluation}
      />
    );
  }

  // Default dashboard view
  const selectedBomId = searchParams.get('bomId'); // Allow BOM ID to be passed via URL
  
  return (
    <div className="space-y-6">
      <SupplierNominationsDashboard
        projectId={projectId}
        selectedBomId={selectedBomId || undefined}
        onSelectNomination={handleSelectNomination}
      />

      {/* Workflow Navigation */}
      <WorkflowNavigation 
        currentModuleId="supplier-nomination" 
        projectId={projectId}
      />
    </div>
  );
}