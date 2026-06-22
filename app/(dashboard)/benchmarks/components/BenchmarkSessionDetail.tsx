'use client';

import { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQueries } from '@tanstack/react-query';
import {
  useBenchmarkSession,
  useUpdateBenchmarkSession,
  useDeleteBenchmarkSession,
} from '@/lib/api/hooks/useBenchmarkSessions';
import { useProjects } from '@/lib/api/hooks/useProjects';
import { useRawMaterials } from '@/lib/api/hooks/useRawMaterials';
import { useVendors } from '@/lib/api/hooks/useVendors';
import { useProcesses } from '@/lib/api/hooks/useProcesses';
import { ProjectSelection } from './ProjectSelection';
import { BOMSelection } from './BOMSelection';
import { ComparisonView } from './comparison';
import type { SelectedProject, SelectedBOM, BOMMetricEntry } from '../types';
import { calculateMetrics } from '../utils';
import type { BenchmarkSession } from '@/lib/api/benchmark-sessions';
import { bomApi } from '@/lib/api/bom';
import type { BOMsResponse } from '@/lib/api/bom';
import { apiClient } from '@/lib/api/client';

// ─── Constants ─────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<BenchmarkSession['status'], string> = {
  draft: 'Draft',
  active: 'Active',
  archived: 'Archived',
};

const STATUS_COLORS: Record<BenchmarkSession['status'], string> = {
  draft: 'bg-muted text-muted-foreground border-muted',
  active: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  archived: 'bg-muted/60 text-muted-foreground/60 border-border',
};

// ─── Component ─────────────────────────────────────────────────────────────────

interface Props {
  sessionId: string;
  projectIdFromUrl: string | null;
  onBack: () => void;
}

export function BenchmarkSessionDetail({ sessionId, onBack }: Props) {
  const [activeTab, setActiveTab] = useState<'projects' | 'boms' | 'comparison'>('projects');
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', description: '', status: 'draft' });

  const [selectedProjects, setSelectedProjects] = useState<SelectedProject[]>([]);
  const [selectedBOMs, setSelectedBOMs] = useState<SelectedBOM[]>([]);
  const [multiProjectMode, setMultiProjectMode] = useState(false);
  const [searchProject, setSearchProject] = useState('');
  const [initialized, setInitialized] = useState(false);

  const { data: session, isLoading: sessionLoading } = useBenchmarkSession(sessionId);
  const updateSession = useUpdateBenchmarkSession();
  const deleteSession = useDeleteBenchmarkSession();

  const { data: projectsData } = useProjects();
  const allProjects = (projectsData as any)?.projects ?? [];

  const { data: rawMaterialsData } = useRawMaterials();
  const rawMaterials = (rawMaterialsData as any)?.items ?? [];

  const { data: vendorsData } = useVendors();
  const vendors = (vendorsData as any)?.vendors ?? [];

  const { data: processesData } = useProcesses();
  const processes = (processesData as any)?.processes ?? [];

  // Initialize local state from session once loaded
  useEffect(() => {
    if (!session || initialized) return;

    const sessionProjects = (session.selectedProjects ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      targetPrice: p.targetPrice ?? 0,
      updatedAt: '',
    }));
    const sessionBoms = (session.selectedBoms ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      version: b.version ?? '',
      status: b.status ?? '',
    }));

    setSelectedProjects(sessionProjects);
    setSelectedBOMs(sessionBoms);
    setMultiProjectMode(sessionProjects.length > 1);

    if (sessionBoms.length >= 2) {
      setActiveTab('comparison');
    } else if (sessionProjects.length > 0) {
      setActiveTab('boms');
    }

    setInitialized(true);
  }, [session, initialized]);

  // Fetch BOMs for each selected project (for ProjectSelection and BOMSelection)
  const bomQueries = useQueries({
    queries: selectedProjects.map((project) => ({
      queryKey: ['bom', 'list', { projectId: project.id }],
      queryFn: () => bomApi.getAll({ projectId: project.id }),
      staleTime: 5 * 60 * 1000,
    })),
  });

  // Fetch BOM items for each selected BOM (for ComparisonView metrics)
  const bomItemQueries = useQueries({
    queries: selectedBOMs.map((bom) => ({
      queryKey: ['bom-items', 'list', bom.id],
      queryFn: async () => {
        const result = await apiClient.get<{ items: any[] }>(`/bom-items?bomId=${bom.id}`);
        return result?.items ?? [];
      },
      staleTime: 2 * 60 * 1000,
    })),
  });

  // BOMs for single-project BOMSelection
  const singleProjectBoms = useMemo(() => {
    if (multiProjectMode || bomQueries.length === 0) return [];
    return (bomQueries[0]?.data as BOMsResponse)?.boms ?? [];
  }, [multiProjectMode, bomQueries]);

  // BOMs per project for multi-project BOMSelection
  const multiProjectBoms = useMemo(() => {
    if (!multiProjectMode) return [];
    return selectedProjects.map((project, idx) => ({
      projectId: project.id,
      projectName: project.name,
      boms: (bomQueries[idx]?.data as BOMsResponse)?.boms ?? [],
    }));
  }, [multiProjectMode, selectedProjects, bomQueries]);

  // Item counts per selected BOM (for BOMSelection display)
  const bomItemCounts = useMemo(
    () => selectedBOMs.map((_, idx) => bomItemQueries[idx]?.data?.length ?? 0),
    [selectedBOMs, bomItemQueries],
  );

  // Computed BOM metrics for ComparisonView
  const bomMetrics: BOMMetricEntry[] = useMemo(
    () =>
      selectedBOMs.map((bom, idx) => ({
        bom,
        metrics: calculateMetrics(bomItemQueries[idx]?.data ?? []),
        items: bomItemQueries[idx]?.data ?? [],
      })),
    [selectedBOMs, bomItemQueries],
  );

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const handleProjectSelect = (project: any) => {
    const sp: SelectedProject = {
      id: project.id,
      name: project.name,
      targetPrice: project.targetPrice ?? 0,
      updatedAt: project.updatedAt ?? '',
    };
    setSelectedProjects([sp]);
    setMultiProjectMode(false);
    setSelectedBOMs([]);
    setActiveTab('boms');
    updateSession.mutate({
      id: sessionId,
      data: {
        selectedProjects: [{ id: sp.id, name: sp.name, targetPrice: sp.targetPrice }],
        selectedBoms: [],
        bomCount: 0,
      },
    });
  };

  const handleMultiToggle = (project: any) => {
    setSelectedProjects((prev) => {
      const exists = prev.find((p) => p.id === project.id);
      if (exists) return prev.filter((p) => p.id !== project.id);
      return [
        ...prev,
        {
          id: project.id,
          name: project.name,
          targetPrice: project.targetPrice ?? 0,
          updatedAt: project.updatedAt ?? '',
        },
      ];
    });
  };

  const handleCompareProjects = () => {
    setSelectedBOMs([]);
    setActiveTab('boms');
    updateSession.mutate({
      id: sessionId,
      data: {
        selectedProjects: selectedProjects.map((p) => ({
          id: p.id,
          name: p.name,
          targetPrice: p.targetPrice,
        })),
        selectedBoms: [],
        bomCount: 0,
      },
    });
  };

  const handleBomToggle = (bom: any) => {
    setSelectedBOMs((prev) => {
      const exists = prev.find((b) => b.id === bom.id);
      if (exists) return prev.filter((b) => b.id !== bom.id);
      return [
        ...prev,
        {
          id: bom.id,
          name: bom.name,
          version: bom.version ?? '',
          status: bom.status ?? '',
        },
      ];
    });
  };

  const handleCompare = async () => {
    const bomsToSave = selectedBOMs.map((b) => {
      const matchingProject = multiProjectMode
        ? multiProjectBoms.find((mpb) => mpb.boms.some((bb) => bb.id === b.id))
        : null;
      const project = matchingProject
        ? selectedProjects.find((p) => p.id === matchingProject.projectId)
        : selectedProjects[0];
      return {
        id: b.id,
        name: b.name,
        projectId: project?.id ?? '',
        projectName: project?.name ?? '',
        version: b.version,
        status: b.status,
      };
    });

    await updateSession.mutateAsync({
      id: sessionId,
      data: {
        selectedBoms: bomsToSave,
        bomCount: selectedBOMs.length,
        status: 'active',
      },
    });
    setActiveTab('comparison');
  };

  const handleEditOpen = () => {
    if (!session) return;
    setEditForm({
      name: session.name,
      description: session.description ?? '',
      status: session.status,
    });
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    await updateSession.mutateAsync({
      id: sessionId,
      data: {
        name: editForm.name,
        ...(editForm.description ? { description: editForm.description } : {}),
        status: editForm.status as BenchmarkSession['status'],
      },
    });
    setEditOpen(false);
  };

  const handleDelete = async () => {
    await deleteSession.mutateAsync(sessionId);
    setDeleteOpen(false);
    onBack();
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  if (sessionLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="h-8 w-48 bg-muted rounded animate-pulse mb-4" />
        <div className="h-64 bg-muted rounded animate-pulse" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <Button variant="ghost" onClick={onBack} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
        <p className="text-muted-foreground">Session not found.</p>
      </div>
    );
  }

  if (!initialized) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="h-8 w-48 bg-muted rounded animate-pulse mb-4" />
        <div className="h-64 bg-muted rounded animate-pulse" />
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
              <h1 className="text-xl font-bold">{session.name}</h1>
              <Badge
                variant="outline"
                className={`text-[10px] ${STATUS_COLORS[session.status]}`}
              >
                {STATUS_LABELS[session.status]}
              </Badge>
            </div>
            {session.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{session.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleEditOpen}>
            <Pencil className="h-3.5 w-3.5 mr-1.5" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Delete
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-6 text-sm border rounded-lg px-4 py-3 bg-muted/30">
        <div>
          <span className="font-semibold">{selectedProjects.length}</span>{' '}
          <span className="text-muted-foreground">
            project{selectedProjects.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="w-px h-4 bg-border" />
        <div>
          <span className="font-semibold">{selectedBOMs.length}</span>{' '}
          <span className="text-muted-foreground">
            BOM{selectedBOMs.length !== 1 ? 's' : ''} selected
          </span>
        </div>
        {selectedBOMs.length >= 2 && (
          <>
            <div className="w-px h-4 bg-border" />
            <div>
              <span className="font-semibold" style={{ color: 'hsl(187 100% 42%)' }}>
                Ready to compare
              </span>
            </div>
          </>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="projects">1. Select Projects</TabsTrigger>
          <TabsTrigger value="boms" disabled={selectedProjects.length === 0}>
            2. Select BOMs
          </TabsTrigger>
          <TabsTrigger value="comparison" disabled={selectedBOMs.length < 2}>
            3. Comparison
          </TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="mt-4">
          <ProjectSelection
            projects={allProjects}
            multiProjectMode={multiProjectMode}
            selectedProjects={selectedProjects}
            searchProject={searchProject}
            onSearch={setSearchProject}
            onProjectSelect={handleProjectSelect}
            onMultiToggle={handleMultiToggle}
            onSetMultiMode={setMultiProjectMode}
            onCompareProjects={handleCompareProjects}
          />
        </TabsContent>

        <TabsContent value="boms" className="mt-4">
          <BOMSelection
            selectedProject={selectedProjects[0] ?? null}
            multiProjectMode={multiProjectMode}
            selectedProjects={selectedProjects}
            selectedBOMs={selectedBOMs}
            boms={singleProjectBoms}
            multiProjectBoms={multiProjectBoms}
            bomItemCounts={bomItemCounts}
            onBack={() => setActiveTab('projects')}
            onBomToggle={handleBomToggle}
            onCompare={handleCompare}
          />
        </TabsContent>

        <TabsContent value="comparison" className="mt-4">
          <ComparisonView
            bomMetrics={bomMetrics}
            selectedBOMs={selectedBOMs}
            selectedProject={multiProjectMode ? null : (selectedProjects[0] ?? null)}
            multiProjectMode={multiProjectMode}
            selectedProjects={selectedProjects}
            processes={processes}
            vendors={vendors}
            rawMaterials={rawMaterials}
            onBack={() => setActiveTab('boms')}
          />
        </TabsContent>
      </Tabs>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md" style={{ background: 'hsl(220 18% 10%)' }}>
          <DialogHeader>
            <DialogTitle>Edit Session</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Session Name *</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={editForm.status}
                onValueChange={(v) => setEditForm((f) => ({ ...f, status: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
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
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleEditSave}
              disabled={!editForm.name.trim() || updateSession.isPending}
            >
              {updateSession.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm" style={{ background: 'hsl(220 18% 10%)' }}>
          <DialogHeader>
            <DialogTitle>Delete Session?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete <strong>{session.name}</strong> and all its saved data.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteSession.isPending}
            >
              {deleteSession.isPending ? 'Deleting…' : 'Delete Session'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
