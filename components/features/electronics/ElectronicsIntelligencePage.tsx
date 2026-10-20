'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { useDesign } from '@/lib/api/hooks/useElectronics';
import { designHref, intelligenceHref, isRead, listHref, selectRevision } from '@/lib/electronics/design-view';

import { ElectronicsIntelligence } from './ElectronicsIntelligence';

/**
 * The full-screen route of a board's intelligence workspace. It shows only a board whose chosen revision was read; anything else
 * (still being read, failed, an assembly, a harness) is sent back to the design page, which explains why.
 */
export function ElectronicsIntelligencePage({ projectId, designId }: { projectId: string; designId: string }) {
  const router = useRouter();
  const { data: design, isLoading, error } = useDesign(designId);
  const chosen = useSearchParams().get('revision') ?? null;
  const revision = design ? selectRevision(design, chosen) : null;

  if (isLoading) return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  if (error || !design) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive">The design could not be loaded. It may not exist, or it belongs to another organization.</p>
        <Button variant="outline" asChild><Link href={listHref(projectId)}>Back to Electronics</Link></Button>
      </div>
    );
  }
  if (design.kind !== 'board' || !revision?.uploadId || !isRead(revision)) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">This revision has no extracted board to show yet.</p>
        <Button variant="outline" asChild><Link href={designHref(projectId, design.id, revision?.id)}>Open the design page</Link></Button>
      </div>
    );
  }

  return (
    <ElectronicsIntelligence
      key={revision.uploadId}
      uploadId={revision.uploadId}
      projectId={projectId}
      design={design}
      revision={revision}
      onSelectRevision={(id) => {
        const next = design.revisions.find((r) => r.id === id) ?? null;
        router.replace(isRead(next) ? intelligenceHref(projectId, design.id, id) : designHref(projectId, design.id, id));
      }}
    />
  );
}
