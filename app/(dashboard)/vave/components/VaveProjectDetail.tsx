'use client';

import { useState } from 'react';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useVaveProject, useUpdateVaveProject, useDeleteVaveProject } from '@/lib/api/hooks/useVave';
import { BOMExplorer } from './BOMExplorer';
import { CostAnalysis } from './CostAnalysis';
import { IdeaRepository } from './IdeaRepository';
import { PrioritizationMatrix } from './PrioritizationMatrix';
import { BusinessCaseGenerator } from './BusinessCaseGenerator';

const STATUS_LABELS: Record<string, string> = {
  phase1: 'Phase 1: Data',
  phase2: 'Phase 2: Analysis',
  phase3: 'Phase 3: Scoping',
  complete: 'Complete',
};

const STATUS_COLORS: Record<string, string> = {
  phase1: 'bg-blue-100 text-blue-700 border-blue-200',
  phase2: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  phase3: 'bg-purple-100 text-purple-700 border-purple-200',
  complete: 'bg-green-100 text-green-700 border-green-200',
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
        productFamily: editForm.productFamily || undefined,
        description: editForm.description || undefined,
        status: editForm.status as any,
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
      <div className="p-6 max-w-7xl mx-auto">
        <div className="h-8 w-48 bg-muted rounded animate-pulse mb-4" />
        <div className="h-64 bg-muted rounded animate-pulse" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <Button variant="ghost" onClick={onBack} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
        <p className="text-muted-foreground">Project not found.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">{project.name}</h1>
              {project.productFamily && (
                <span className="text-sm text-muted-foreground">· {project.productFamily}</span>
              )}
              <Badge
                variant="outline"
                className={`text-[10px] ${STATUS_COLORS[project.status] ?? ''}`}
              >
                {STATUS_LABELS[project.status] ?? project.status}
              </Badge>
            </div>
            {project.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{project.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleEditOpen}>
            <Pencil className="h-3.5 w-3.5 mr-1.5" />
            Edit
          </Button>
          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Delete
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-6 text-sm border rounded-lg px-4 py-3 bg-muted/30">
        <div><span className="font-semibold">{project.bomCount ?? 0}</span> <span className="text-muted-foreground">parts</span></div>
        <div className="w-px h-4 bg-border" />
        <div><span className="font-semibold">{project.ideaCount ?? 0}</span> <span className="text-muted-foreground">ideas</span></div>
        <div className="w-px h-4 bg-border" />
        <div>
          <span className="font-semibold text-green-600">
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
          <BOMExplorer projectId={projectId} sourceProjectId={sourceProjectId} />
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
