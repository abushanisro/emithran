'use client';

import { useState } from 'react';

import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ArrowLeft, Pencil, Trash2 } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useVaveProject, useUpdateVaveProject, useDeleteVaveProject } from '@/lib/api/hooks/useVave';

import { BOMExplorer } from './BOMExplorer';
import { BusinessCaseGenerator } from './BusinessCaseGenerator';
import { CostAnalysis } from './CostAnalysis';
import { IdeaRepository } from './IdeaRepository';
import { PrioritizationMatrix } from './PrioritizationMatrix';

const STATUS_LABELS: Record<string, string> = {
  phase1: 'Phase 1: Data',
  phase2: 'Phase 2: Analysis',
  phase3: 'Phase 3: Scoping',
  complete: 'Complete',
};

const STATUS_COLORS: Record<string, string> = {
  phase1: 'bg-primary/10 text-primary border-primary/40',
  phase2: 'bg-warning/10 text-warning border-warning/40',
  phase3: 'bg-primary/10 text-primary border-primary/40',
  complete: 'bg-success/10 text-success border-success/40',
};

interface Props {
  projectId: string;
  sourceProjectId?: string | null;
  onBack: () => void;
}

export function VaveProjectDetail({ projectId, sourceProjectId, onBack }: Props) {
  const [activeTab, setActiveTab] = useState('bom');
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', productFamily: '', description: '', status: '' });

  const { data: project, isLoading } = useVaveProject(projectId);
  const updateProject = useUpdateVaveProject();
  const deleteProject = useDeleteVaveProject();

  const handleEditOpen = () => {
    if (!project) return;
    setEditForm({
      name: project.name,
      productFamily: project.productFamily ?? '',
      description: project.description ?? '',
      status: project.status,
    });
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    await updateProject.mutateAsync({
      id: projectId,
      data: {
        name: editForm.name,
        status: editForm.status as any,
        ...(editForm.productFamily ? { productFamily: editForm.productFamily } : {}),
        ...(editForm.description ? { description: editForm.description } : {}),
      },
    });
    setEditOpen(false);
  };

  const handleDelete = async () => {
    await deleteProject.mutateAsync(projectId);
    setDeleteOpen(false);
    onBack();
  };

  if (isLoading) {
    return (
      <div className="animate-fade-in">
        <div className="h-8 w-48 bg-muted rounded animate-pulse mb-4" />
        <div className="h-64 bg-muted rounded animate-pulse" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="animate-fade-in">
        <Button variant="ghost" onClick={onBack} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
        <p className="text-muted-foreground">Project not found.</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button variant="outline" size="icon" className="mt-0.5 h-8 w-8 shrink-0" aria-label="Back to projects" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <PageHeader
            title={project.productFamily ? `${project.name} · ${project.productFamily}` : project.name}
            {...(project.description ? { description: project.description } : {})}
          >
            <Badge
              variant="outline"
              className={`text-[10px] ${STATUS_COLORS[project.status] ?? ''}`}
            >
              {STATUS_LABELS[project.status] ?? project.status}
            </Badge>
            <Button variant="outline" size="sm" onClick={handleEditOpen} className="gap-1.5">
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </PageHeader>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-6 text-sm border rounded-lg px-4 py-3 bg-muted/30">
        <div><span className="font-semibold">{project.bomCount ?? 0}</span> <span className="text-muted-foreground">parts</span></div>
        <div className="w-px h-4 bg-border" />
        <div><span className="font-semibold">{project.ideaCount ?? 0}</span> <span className="text-muted-foreground">ideas</span></div>
        <div className="w-px h-4 bg-border" />
        <div>
          <span className="font-semibold text-success">
            ${((project.totalSavings ?? 0) / 1000).toFixed(0)}K
          </span>{' '}
          <span className="text-muted-foreground">identified savings</span>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="bom">BOM Explorer</TabsTrigger>
          <TabsTrigger value="cost">Cost Analysis</TabsTrigger>
          <TabsTrigger value="ideas">Idea Repository</TabsTrigger>
          <TabsTrigger value="matrix">Prioritization</TabsTrigger>
          <TabsTrigger value="business-case">Business Case</TabsTrigger>
        </TabsList>

        <TabsContent value="bom" className="mt-4">
          <BOMExplorer projectId={projectId} sourceProjectId={sourceProjectId ?? null} />
        </TabsContent>
        <TabsContent value="cost" className="mt-4">
          <CostAnalysis projectId={projectId} />
        </TabsContent>
        <TabsContent value="ideas" className="mt-4">
          <IdeaRepository projectId={projectId} />
        </TabsContent>
        <TabsContent value="matrix" className="mt-4">
          <PrioritizationMatrix projectId={projectId} />
        </TabsContent>
        <TabsContent value="business-case" className="mt-4">
          <BusinessCaseGenerator projectId={projectId} />
        </TabsContent>
      </Tabs>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Project Name *</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Product Family</Label>
              <Input
                value={editForm.productFamily}
                onChange={(e) => setEditForm((f) => ({ ...f, productFamily: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={editForm.status} onValueChange={(v) => setEditForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="phase1">Phase 1: Data</SelectItem>
                  <SelectItem value="phase2">Phase 2: Analysis</SelectItem>
                  <SelectItem value="phase3">Phase 3: Scoping</SelectItem>
                  <SelectItem value="complete">Complete</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleEditSave} disabled={!editForm.name.trim() || updateProject.isPending}>
              {updateProject.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Project?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete <strong>{project.name}</strong> and all its BOM items, ideas, and cost records.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteProject.isPending}>
              {deleteProject.isPending ? 'Deleting…' : 'Delete Project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
