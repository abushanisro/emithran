'use client';

import { ArrowLeft, FileText } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

// The backend has no RFQ template store (no templates endpoint under
// /rfq), so this page shows an empty state rather than sample templates.
export default function RFQTemplatesPage() {
  const params = useParams();
  const projectId = params.id as string;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-[1800px] mx-auto space-y-6">
        {/* BREADCRUMB & HEADER */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link
              href={`/projects/${projectId}/rfq`}
              className="flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3 w-3" />
              Back to RFQ Management
            </Link>
            <span>/</span>
            <span>RFQ Templates</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            RFQ Templates
          </h1>
        </div>

        <Card className="text-center py-12">
          <CardContent>
            <EmptyState
              icon={FileText}
              title="No RFQ templates yet"
              description="RFQ templates are not stored by the system yet."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
