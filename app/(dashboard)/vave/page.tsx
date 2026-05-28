'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Lightbulb, Plus, TrendingDown, Layers, Zap, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useVaveProjects, useCreateVaveProject } from '@/lib/api/hooks/useVave';
import type { VaveProject } from '@/lib/api/vave';
import { VaveProjectDetail } from './components/VaveProjectDetail';

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

function formatUSD(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export default function VavePage() {
  const searchParams = useSearchParams();
  const [step, setStep] = useState<'list' | 'detail'>('list');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', productFamily: '', description: '' });
  const [formLoading, setFormLoading] = useState(false);

  const sourceProjectId = searchParams?.get('sourceProjectId') ?? null;

  const { data: projects, isLoading } = useVaveProjects();
  const createProject = useCreateVaveProject();

  // Auto-open VAVE project if projectId query param matches a known VAVE project
  useEffect(() => {
    const pid = searchParams?.get('projectId');
    if (pid && projects) {
      const match = (projects as VaveProject[]).find((p) => p.id === pid);
      if (match) {
        setSelectedProjectId(pid);
        setStep('detail');
      }
    }
  }, [searchParams, projects]);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setFormLoading(true);
    try {
      const created = await createProject.mutateAsync({
        name: form.name.trim(),
        productFamily: form.productFamily.trim() || undefined,
        description: form.description.trim() || undefined,
      });
      setCreateOpen(false);
      setForm({ name: '', productFamily: '', description: '' });
      setSelectedProjectId((created as VaveProject).id);
      setStep('detail');
    } finally {
      setFormLoading(false);
    }
  };

  const projectList = (projects as VaveProject[]) ?? [];
  const totalSavings = projectList.reduce((s, p) => s + (p.totalSavings ?? 0), 0);
  const totalIdeas = projectList.reduce((s, p) => s + (p.ideaCount ?? 0), 0);

  if (step === 'detail' && selectedProjectId) {
    return (
      <VaveProjectDetail
        projectId={selectedProjectId}
        sourceProjectId={sourceProjectId}
        onBack={() => { setStep('list'); setSelectedProjectId(null); }}
      />
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Lightbulb className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">VAVE Projects</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Value Analysis &amp; Value Engineering — AI-accelerated cost reduction
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Project
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Layers className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{projectList.length}</p>
                <p className="text-xs text-muted-foreground">Active Projects</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <TrendingDown className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{formatUSD(totalSavings)}</p>
                <p className="text-xs text-muted-foreground">Total Savings Identified</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Zap className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalIdeas}</p>
                <p className="text-xs text-muted-foreground">Total Ideas</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Project cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : projectList.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="p-4 bg-muted rounded-full">
              <Lightbulb className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-lg">No VAVE projects yet</p>
              <p className="text-muted-foreground text-sm mt-1">
                Create your first project to start identifying cost savings
              </p>
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create First Project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projectList.map((project) => (
            <Card
              key={project.id}
              className="cursor-pointer hover:shadow-md transition-shadow group"
              onClick={() => { setSelectedProjectId(project.id); setStep('detail'); }}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base truncate">{project.name}</CardTitle>
                    {project.productFamily && (
                      <CardDescription className="mt-0.5">{project.productFamily}</CardDescription>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className={`shrink-0 ml-2 text-[10px] ${STATUS_COLORS[project.status] ?? ''}`}
                  >
                    {STATUS_LABELS[project.status] ?? project.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {project.description && (
                  <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
                    {project.description}
                  </p>
                )}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-lg font-bold">{project.bomCount ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">Parts</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold">{project.ideaCount ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">Ideas</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-green-600">
                      {formatUSD(project.totalSavings ?? 0)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Savings</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-3 group-hover:bg-primary/10 transition-colors"
                  onClick={(e) => { e.stopPropagation(); setSelectedProjectId(project.id); setStep('detail'); }}
                >
                  Open Project
                  <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New VAVE Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="vave-name">Project Name *</Label>
              <Input
                id="vave-name"
                placeholder="e.g. Motor Assembly VAVE 2026"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vave-family">Product Family</Label>
              <Input
                id="vave-family"
                placeholder="e.g. Drive Systems"
                value={form.productFamily}
                onChange={(e) => setForm((f) => ({ ...f, productFamily: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vave-desc">Description</Label>
              <Textarea
                id="vave-desc"
                placeholder="Brief description of the VAVE initiative..."
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.name.trim() || formLoading}>
              {formLoading ? 'Creating…' : 'Create Project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
