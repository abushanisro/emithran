'use client';

import { ArrowLeft, ChevronDown, CircuitBoard, FileSpreadsheet, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { isAssemblyResult, type DesignView, type StartAssemblyResult, type StartUploadResult } from '@/lib/api/electronics';
import { useDeleteDesign, useDeleteRevision, useDesigns } from '@/lib/api/hooks/useElectronics';
import { useProject } from '@/lib/api/hooks/useProjects';
import { deleteImpact, deleteSentence, designHref, openHref, type DesignNode } from '@/lib/electronics/design-view';

import { DeleteConfirm } from './DeleteConfirm';
import { ElectronicsItemsList } from './ElectronicsItemsList';
import { ElectronicsTreeView } from './ElectronicsTreeView';
import { ElectronicsUpload } from './ElectronicsUpload';
import { HarnessForm } from './HarnessForm';
import { NewContainerDialog } from './NewContainerDialog';

// What the upload dialog is adding: a child part (or a whole folder) at the top of the project or inside an assembly, or a new
// revision of a child part. The files decide whether it is a PCB, a PCBA, a wire harness or an assembly folder.
interface Adding {
  /** The assembly to add into, or the child part to add a revision to; null for the top of the project. */
  target: DesignView | null;
}

// The name dialog for an empty assembly or sub-assembly. `parent` is set when started from an assembly card.
interface Naming {
  itemType: 'assembly' | 'sub_assembly';
  parent: DesignView | null;
}

type Deleting = { kind: 'design'; node: DesignNode } | { kind: 'revision'; design: DesignView; revisionId: string; revision: string };

const inContainer = (a: Adding) => a.target !== null && a.target.itemType !== 'child_part';

/**
 * The Electronics module of a project, laid out like BOM management: Items & Parts and Tree View tabs, an items card with an
 * Add menu (Assembly, Sub-Assembly, Child Part), one card row per item, nested by level. Designs belong to a project.
 */
export function ElectronicsBomPage({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [adding, setAdding] = useState<Adding | null>(null);
  const [naming, setNaming] = useState<Naming | null>(null);
  const [deleting, setDeleting] = useState<Deleting | null>(null);
  const { data: designs, isLoading, error } = useDesigns(projectId);
  const { data: project } = useProject(projectId);
  const deleteDesign = useDeleteDesign();
  const deleteRevision = useDeleteRevision();
  const scopeName = project?.name ?? 'Project';
  const containers = useMemo(() => (designs ?? []).filter((d) => d.itemType !== 'child_part'), [designs]);

  const open = (design: DesignView, revisionId?: string) => { router.push(openHref(projectId, design, revisionId)); };
  const uploaded = (result: StartUploadResult | StartAssemblyResult) => {
    setAdding(null);
    // A folder becomes a tree: stay on the list to see it. One design opens in its workspace.
    if (!isAssemblyResult(result)) router.push(designHref(projectId, result.designId));
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    if (deleting.kind === 'design') await deleteDesign.mutateAsync(deleting.node.design.id);
    else await deleteRevision.mutateAsync({ designId: deleting.design.id, revisionId: deleting.revisionId });
    setDeleting(null);
  };
  const deleteTitle = !deleting ? '' : deleting.kind === 'design' ? `Delete ${deleting.node.design.name}?` : `Delete revision ${deleting.revision} of ${deleting.design.name}?`;
  const deleteWhat = !deleting
    ? ''
    : deleting.kind === 'design'
      ? deleteSentence(deleteImpact(deleting.node))
      : deleting.design.revisions.length === 1
        ? '1 revision with its uploaded files, extracted features and cost results, and the part itself, because it is the last revision'
        : '1 revision with its uploaded files, extracted features and cost results';

  return (
    <div className="space-y-4 p-6">
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/projects/${projectId}`}><ArrowLeft className="mr-1 h-4 w-4" />{scopeName}</Link>
      </Button>
      <PageHeader title="Electronics" description="PCB assemblies and wire harnesses of this project, with features measured from their files." />

      <ElectronicsUpload
        projectId={projectId}
        onUploaded={uploaded}
        title="Electronics Processing Pipeline"
        description="Upload a .zip design pack, a folder, or Gerber / drill / Pick Place files — every board is reverse-engineered (size, holes, placements, copper, nets and series chains, spacing) and an item is created ready for costing"
      />

      <Tabs defaultValue="items">
        <TabsList>
          <TabsTrigger value="items"><FileSpreadsheet className="mr-2 h-4 w-4" />Items &amp; Parts</TabsTrigger>
          <TabsTrigger value="tree">Tree View</TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-2xl">Electronics Items</CardTitle>
                  <CardDescription>Manage assemblies, sub-assemblies, PCBs, PCBAs and wire harnesses</CardDescription>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button><Plus className="mr-2 h-4 w-4" />Add<ChevronDown className="ml-2 h-4 w-4" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => { setNaming({ itemType: 'assembly', parent: null }); }}>Assembly</DropdownMenuItem>
                    <DropdownMenuItem disabled={containers.length === 0} onSelect={() => { setNaming({ itemType: 'sub_assembly', parent: null }); }}>
                      Sub-Assembly
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => { setAdding({ target: null }); }}>
                      <CircuitBoard className="mr-2 h-4 w-4" />Child Part (upload files or a folder)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading && <div className="h-24 animate-pulse rounded-md bg-muted" />}
              {error && <p className="text-sm text-destructive">The designs could not be loaded. Try reloading the page.</p>}
              {designs?.length === 0 && (
                <div className="py-10 text-center text-sm text-muted-foreground">No electronics items yet. Use Add to create an assembly, or upload the files of a PCB, PCBA or wire harness.</div>
              )}
              {designs && designs.length > 0 && (
                <ElectronicsItemsList
                  designs={designs}
                  onOpen={(d) => { open(d); }}
                  onAddRevision={(d) => { setAdding({ target: d }); }}
                  onAddSubAssembly={(d) => { setNaming({ itemType: 'sub_assembly', parent: d }); }}
                  onAddChildPart={(d) => { setAdding({ target: d }); }}
                  onDelete={(node) => { setDeleting({ kind: 'design', node }); }}
                  onDeleteRevision={(design, revisionId) => { setDeleting({ kind: 'revision', design, revisionId, revision: design.revisions.find((r) => r.id === revisionId)?.revision ?? '' }); }
                  }
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tree">
          <Card>
            <CardContent className="pt-6">
              {designs && designs.length > 0 ? (
                <ElectronicsTreeView projectName={scopeName} designs={designs} onOpen={open} />
              ) : (
                <p className="text-sm text-muted-foreground">Nothing to show yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <NewContainerDialog
        open={naming !== null}
        onOpenChange={(o) => { if (!o) setNaming(null); }}
        projectId={projectId}
        itemType={naming?.itemType ?? 'assembly'}
        containers={containers}
        fixedParent={naming?.parent ?? null}
      />

      <DeleteConfirm
        open={deleting !== null}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        title={deleteTitle}
        sentence={deleteWhat}
        pending={deleteDesign.isPending || deleteRevision.isPending}
        onConfirm={() => void confirmDelete()}
      />

      <Dialog open={adding !== null} onOpenChange={(o) => { if (!o) setAdding(null); }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CircuitBoard className="h-5 w-5" />
              {adding?.target ? (inContainer(adding) ? `Add a child part to ${adding.target.name}` : `New revision of ${adding.target.name}`) : 'Add Child Part'}
            </DialogTitle>
            <DialogDescription>Upload the files of a PCB, a PCBA or a wire harness, or a whole assembly folder. Which one it is comes from the files and the folder structure.</DialogDescription>
          </DialogHeader>

          {adding && (
            <ElectronicsUpload
              projectId={projectId}
              {...(adding.target ? (inContainer(adding) ? { parentDesignId: adding.target.id } : { designId: adding.target.id }) : {})}
              onUploaded={uploaded}
            />
          )}

          {adding && (!adding.target || inContainer(adding) || adding.target.kind === 'harness') && (
            <details className="rounded-md border px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium">No file? Enter a wire harness by hand</summary>
              <div className="mt-4">
                <HarnessForm
                  projectId={projectId}
                  {...(adding.target ? (inContainer(adding) ? { parentDesignId: adding.target.id } : { designId: adding.target.id }) : {})}
                  onUploaded={uploaded}
                />
              </div>
            </details>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
