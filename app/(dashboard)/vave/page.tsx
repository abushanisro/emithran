'use client';

import { useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';

import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Lightbulb, Plus, TrendingDown, Layers, Zap, ChevronRight } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
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
  phase1: 'bg-primary/10 text-primary border-primary/40',
  phase2: 'bg-warning/10 text-warning border-warning/40',
  phase3: 'bg-primary/10 text-primary border-primary/40',
  complete: 'bg-success/10 text-success border-success/40',
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
      const trimmedProductFamily = form.productFamily.trim();
      const trimmedDescription = form.description.trim();
      const created = await createProject.mutateAsync({
        name: form.name.trim(),
        ...(trimmedProductFamily ? { productFamily: trimmedProductFamily } : {}),
        ...(trimmedDescription ? { description: trimmedDescription } : {}),
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

  const kpis = [
    { label: 'Active Projects', icon: Layers, value: String(projectList.length), tone: '' },
    { label: 'Total Savings Identified', icon: TrendingDown, value: formatUSD(totalSavings), tone: 'text-success' },
    { label: 'Total Ideas', icon: Zap, value: String(totalIdeas), tone: '' },
  ];

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="VAVE Projects"
        description="Value Analysis & Value Engineering — AI-accelerated cost reduction"
      >
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          New Project
        </Button>
      </PageHeader>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {kpis.map(({ label, icon: Icon, value, tone }) => (
          <Card key={label}>
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">{label}</p>
                <p className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${tone}`}>{value}</p>
              </div>
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${tone ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary'}`}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Project cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 rounded-lg" />
          ))}
        </div>
      ) : projectList.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Lightbulb}
              title="No VAVE projects yet"
              description="Create your first project to start identifying cost savings"
            >
              <Button onClick={() => setCreateOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                Create First Project
              </Button>
            </EmptyState>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projectList.map((project) => (
            <Card
              key={project.id}
              className="group cursor-pointer transition-colors hover:border-primary/50"
              onClick={() => { setSelectedProjectId(project.id); setStep('detail'); }}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="truncate text-base group-hover:text-primary">{project.name}</CardTitle>
                    {project.productFamily && (
                      <CardDescription className="mt-0.5">{project.productFamily}</CardDescription>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className={`shrink-0 text-[10px] ${STATUS_COLORS[project.status] ?? ''}`}
                  >
                    {STATUS_LABELS[project.status] ?? project.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {project.description && (
                  <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">
                    {project.description}
                  </p>
                )}
                <dl className="mb-3 grid grid-cols-3 divide-x rounded-md border bg-muted/30 text-center">
                  <div className="py-2">
                    <dd className="text-lg font-semibold tabular-nums">{project.bomCount ?? 0}</dd>
                    <dt className="text-[11px] text-muted-foreground">Parts</dt>
                  </div>
                  <div className="py-2">
                    <dd className="text-lg font-semibold tabular-nums">{project.ideaCount ?? 0}</dd>
                    <dt className="text-[11px] text-muted-foreground">Ideas</dt>
                  </div>
                  <div className="py-2">
                    <dd className="text-lg font-semibold tabular-nums text-success">
                      {formatUSD(project.totalSavings ?? 0)}
                    </dd>
                    <dt className="text-[11px] text-muted-foreground">Savings</dt>
                  </div>
                </dl>
                <div className="flex justify-end border-t pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 text-xs"
                    onClick={(e) => { e.stopPropagation(); setSelectedProjectId(project.id); setStep('detail'); }}
                  >
                    Open Project
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
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
