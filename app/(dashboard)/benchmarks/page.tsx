'use client';

import { useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';

import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { BarChart2, Plus, Activity, Layers, CalendarDays, ChevronRight } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import type { BenchmarkSession } from '@/lib/api/benchmark-sessions';
import { useBenchmarkSessions, useCreateBenchmarkSession } from '@/lib/api/hooks/useBenchmarkSessions';

import { BenchmarkSessionDetail } from './components/BenchmarkSessionDetail';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<BenchmarkSession['status'], string> = {
  draft: 'Draft',
  active: 'Active',
  archived: 'Archived',
};

const STATUS_COLORS: Record<BenchmarkSession['status'], string> = {
  draft: 'bg-warning/10 text-warning border-warning/30',
  active: 'bg-success/10 text-success border-success/30',
  archived: 'bg-muted text-muted-foreground border-border',
};

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function isThisMonth(dateString: string): boolean {
  const d = new Date(dateString);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BenchmarkPage() {
  const searchParams = useSearchParams();
  const projectIdFromUrl = searchParams?.get('projectId') ?? null;

  const [step, setStep] = useState<'list' | 'detail'>('list');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [formLoading, setFormLoading] = useState(false);

  const { data: sessionsRaw, isLoading } = useBenchmarkSessions();
  const createSession = useCreateBenchmarkSession();

  const sessions: BenchmarkSession[] = (sessionsRaw as BenchmarkSession[]) ?? [];

  // Stats
  const activeSessions = sessions.filter((s) => s.status === 'active').length;
  const totalBOMsCompared = sessions.reduce((sum, s) => sum + (s.bomCount ?? 0), 0);
  const sessionsThisMonth = sessions.filter((s) => isThisMonth(s.updatedAt)).length;

  // Auto-open if URL has a sessionId matching a session
  useEffect(() => {
    // For now, projectIdFromUrl is stored in state to pass down to the detail component.
    // If there's only one session or the URL encodes a sessionId, we could auto-open.
    // The URL param ?projectId= is forwarded to BenchmarkSessionDetail.
  }, [projectIdFromUrl, sessions]);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setFormLoading(true);
    try {
      const created = await createSession.mutateAsync({
        name: form.name.trim(),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
      });
      setCreateOpen(false);
      setForm({ name: '', description: '' });
      setSelectedSessionId((created as BenchmarkSession).id);
      setStep('detail');
    } finally {
      setFormLoading(false);
    }
  };

  // ── Detail view ──────────────────────────────────────────────────────────────
  if (step === 'detail' && selectedSessionId) {
    return (
      <BenchmarkSessionDetail
        sessionId={selectedSessionId}
        projectIdFromUrl={projectIdFromUrl}
        onBack={() => {
          setStep('list');
          setSelectedSessionId(null);
        }}
      />
    );
  }

  // ── List view ────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Active Sessions', icon: Activity, value: activeSessions },
    { label: 'Total BOMs Compared', icon: Layers, value: totalBOMsCompared },
    { label: 'Sessions This Month', icon: CalendarDays, value: sessionsThisMonth },
  ];

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Benchmark Sessions"
        description="Compare BOMs across projects, identify cost drivers and VAVE opportunities"
      >
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          New Session
        </Button>
      </PageHeader>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {kpis.map(({ label, icon: Icon, value }) => (
          <Card key={label}>
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">{label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Session cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 rounded-lg" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={BarChart2}
              title="No benchmark sessions yet"
              description="Create your first session to start comparing BOMs across projects"
            >
              <Button onClick={() => setCreateOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                Create First Session
              </Button>
            </EmptyState>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sessions.map((session) => (
            <Card
              key={session.id}
              className="group cursor-pointer transition-colors hover:border-primary/50"
              onClick={() => {
                setSelectedSessionId(session.id);
                setStep('detail');
              }}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="truncate text-base group-hover:text-primary">{session.name}</CardTitle>
                    {session.description && (
                      <CardDescription className="mt-0.5 line-clamp-2">
                        {session.description}
                      </CardDescription>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className={`shrink-0 text-[10px] ${STATUS_COLORS[session.status] ?? ''}`}
                  >
                    {STATUS_LABELS[session.status] ?? session.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <dl className="mb-3 grid grid-cols-2 divide-x rounded-md border bg-muted/30 text-center">
                  <div className="py-2">
                    <dd className="text-lg font-semibold tabular-nums">{session.selectedProjects?.length ?? 0}</dd>
                    <dt className="text-[11px] text-muted-foreground">Projects</dt>
                  </div>
                  <div className="py-2">
                    <dd className="text-lg font-semibold tabular-nums">{session.bomCount ?? 0}</dd>
                    <dt className="text-[11px] text-muted-foreground">BOMs</dt>
                  </div>
                </dl>
                <div className="flex items-center justify-between gap-2 border-t pt-3">
                  <p className="text-[11px] text-muted-foreground">
                    Updated {formatDate(session.updatedAt)}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedSessionId(session.id);
                      setStep('detail');
                    }}
                  >
                    Open
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
        <DialogContent className="sm:max-w-md" style={{ background: 'hsl(var(--popover))' }}>
          <DialogHeader>
            <DialogTitle>New Benchmark Session</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="bs-name">Session Name *</Label>
              <Input
                id="bs-name"
                placeholder="e.g. Q2 2026 Motor Assembly Benchmark"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bs-desc">Description</Label>
              <Textarea
                id="bs-desc"
                placeholder="Brief description of this benchmark session…"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!form.name.trim() || formLoading}>
              {formLoading ? 'Creating…' : 'Create Session'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
