'use client';

import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDesign, useDesigns, useReparse } from '@/lib/api/hooks/useElectronics';
import { intelligenceHref, isRead, listHref, openHref, typeLabel, selectRevision, statusLabel, subtreeOf } from '@/lib/electronics/design-view';

import { ElectronicsItemsList } from './ElectronicsItemsList';
import { FeatureReport } from './FeatureReport';

/**
 * One design. A board whose files have been read opens the intelligence workspace (viewer, cost guide, analysis, process, drivers).
 * An assembly lists what is inside it. A harness, or a board that is still being read or failed, shows the report page with the
 * reason and the revision history.
 */
export function ElectronicsDesignWorkspace({ projectId, designId }: { projectId: string; designId: string }) {
  const { data: design, isLoading, error } = useDesign(designId);
  const [chosen, setChosen] = useState<string | null>(useSearchParams().get('revision') ?? null);
  const revision = design ? selectRevision(design, chosen) : null;
  const router = useRouter();
  const reparse = useReparse();
  const { data: all } = useDesigns(projectId);
  const container = !!design && design.itemType !== 'child_part';
  const subtree = useMemo(() => (design && container ? subtreeOf(all ?? [], design.id) : []), [all, design, container]);

  // A board whose files were read lives in the full-screen workspace; this page keeps assemblies, harnesses and unread boards.
  const workspace = design && revision && design.kind === 'board' && isRead(revision) ? intelligenceHref(projectId, design.id, revision.id) : null;
  useEffect(() => {
    if (workspace) router.replace(workspace);
  }, [workspace, router]);
  const failedUploadId = revision?.status === 'failed' ? revision.uploadId : null;
  if (workspace) return <p className="p-6 text-sm text-muted-foreground">Opening the workspace…</p>;

  return (
    <div className="space-y-4 p-6">
      <Button variant="ghost" size="sm" asChild>
        <Link href={listHref(projectId)}><ArrowLeft className="mr-1 h-4 w-4" />Electronics</Link>
      </Button>

      {isLoading && <div className="h-24 animate-pulse rounded-md bg-muted" />}
      {error && <p className="text-sm text-destructive">The design could not be loaded. It may not exist, or it belongs to another organization.</p>}

      {design && (
        <>
          <PageHeader title={design.name} description={`${typeLabel(design)} · ${design.revisions.length} revision${design.revisions.length === 1 ? '' : 's'}`}>
            {design.revisions.length > 1 && (
              <label className="flex items-center gap-2 text-sm">
                Revision
                <select className="rounded-md border bg-background px-2 py-1" value={revision?.id ?? ''} onChange={(e) => { setChosen(e.target.value); }} aria-label="Revision">
                  {design.revisions.map((r) => <option key={r.id} value={r.id}>{r.revision}</option>)}
                </select>
              </label>
            )}
          </PageHeader>

          {container ? (
            <ElectronicsItemsList designs={subtree} onOpen={(d) => { router.push(openHref(projectId, d)); }} />
          ) : (
            <Tabs defaultValue="features">
              <TabsList>
                <TabsTrigger value="features">Features &amp; Cost</TabsTrigger>
                <TabsTrigger value="info">Part Info</TabsTrigger>
              </TabsList>

              <TabsContent value="features" className="mt-4 space-y-4">
                {design.kind === 'board' && revision && (revision.status === 'failed' || revision.status === 'uploaded' || revision.status === 'parsing') && (
                  <div className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm" data-testid="not-ready">
                    <p className="flex-1">
                      {revision.status === 'failed'
                        ? `The files of this revision could not be read, so there is nothing to draw${revision.failure ? `: ${revision.failure.message}` : ''}. Add the missing files as a new revision from the project list (the + button), or read these files again.`
                        : 'The files are being read. The workspace opens when they are.'}
                    </p>
                    {failedUploadId && (
                      <Button variant="outline" size="sm" disabled={reparse.isPending} onClick={() => { reparse.mutate(failedUploadId); }}>
                        {reparse.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}Refresh analysis
                      </Button>
                    )}
                  </div>
                )}
                {revision?.uploadId ? <FeatureReport key={revision.uploadId} uploadId={revision.uploadId} /> : <p className="text-sm text-muted-foreground">This revision has no upload yet.</p>}
              </TabsContent>

              <TabsContent value="info" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Revisions</CardTitle>
                    <CardDescription>A revision is one fixed set of input files. Changed files are a new revision; the same files again are the same revision.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader><TableRow><TableHead>Revision</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {design.revisions.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-medium">{r.revision}</TableCell>
                            <TableCell><Badge variant={r.status === 'failed' ? 'destructive' : 'secondary'}>{statusLabel(r.status)}</Badge></TableCell>
                            <TableCell className="text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          )}
        </>
      )}
    </div>
  );
}
