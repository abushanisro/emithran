'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';

import { ProjectNav } from '@/components/features/projects/ProjectNav';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ArrowLeft, FileText } from '@/components/ui/icons';

// The backend has no RFQ template store (no templates endpoint under
// /rfq), so this page shows an empty state rather than sample templates.
export default function RFQTemplatesPage() {
  const params = useParams();
  const projectId = params.id as string;

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-start gap-3">
        <Button variant="outline" size="icon" className="mt-0.5 h-8 w-8 shrink-0" aria-label="Back to RFQ management" asChild>
          <Link href={`/projects/${projectId}/rfq`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <PageHeader title="RFQ Templates" description="Standard templates for RFQ requests" />
        </div>
      </div>

      {/* Project sections: shared tab bar, RFQ is the active tab */}
      <ProjectNav projectId={projectId} />

      <Card>
        <CardContent>
          <EmptyState
            icon={FileText}
            title="No RFQ templates yet"
            description="RFQ templates are not stored by the system yet."
          />
        </CardContent>
      </Card>
    </div>
  );
}
