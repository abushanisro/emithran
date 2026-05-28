'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { BarChart2, Plus, Activity, Layers, CalendarDays, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useBenchmarkSessions, useCreateBenchmarkSession } from '@/lib/api/hooks/useBenchmarkSessions';
import type { BenchmarkSession } from '@/lib/api/benchmark-sessions';
import { BenchmarkSessionDetail } from './components/BenchmarkSessionDetail';

// ─── Constants ────────────────────────────────────────────────────────────────

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
        description: form.description.trim() || undefined,
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
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <BarChart2 className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Benchmark Sessions</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Compare BOMs across projects, identify cost drivers and VAVE opportunities
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Session
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card style={{ background: 'hsl(220 18% 10%)' }}>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg" style={{ background: 'hsl(187 100% 42% / 0.12)' }}>
                <Activity className="h-5 w-5" style={{ color: 'hsl(187 100% 42%)' }} />
              </div>
              <div>
                <p className="text-2xl font-bold">{activeSessions}</p>
                <p className="text-xs text-muted-foreground">Active Sessions</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card style={{ background: 'hsl(220 18% 10%)' }}>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg" style={{ background: 'hsl(187 100% 42% / 0.12)' }}>
                <Layers className="h-5 w-5" style={{ color: 'hsl(187 100% 42%)' }} />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalBOMsCompared}</p>
                <p className="text-xs text-muted-foreground">Total BOMs Compared</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card style={{ background: 'hsl(220 18% 10%)' }}>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg" style={{ background: 'hsl(187 100% 42% / 0.12)' }}>
                <CalendarDays className="h-5 w-5" style={{ color: 'hsl(187 100% 42%)' }} />
              </div>
              <div>
                <p className="text-2xl font-bold">{sessionsThisMonth}</p>
                <p className="text-xs text-muted-foreground">Sessions This Month</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Session cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <Card className="border-dashed" style={{ background: 'hsl(220 18% 10%)' }}>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="p-4 rounded-full bg-muted">
              <BarChart2 className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-lg">No benchmark sessions yet</p>
              <p className="text-muted-foreground text-sm mt-1">
                Create your first session to start comparing BOMs across projects
              </p>
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create First Session
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sessions.map((session) => (
            <Card
              key={session.id}
              className="cursor-pointer transition-shadow group hover:shadow-lg"
              style={{ background: 'hsl(220 18% 10%)' }}
              onClick={() => {
                setSelectedSessionId(session.id);
                setStep('detail');
              }}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base truncate">{session.name}</CardTitle>
                    {session.description && (
                      <CardDescription className="mt-0.5 line-clamp-2">
                        {session.description}
                      </CardDescription>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className={`shrink-0 ml-2 text-[10px] ${STATUS_COLORS[session.status] ?? ''}`}
                  >
                    {STATUS_LABELS[session.status] ?? session.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 text-center mb-3">
                  <div className="rounded-lg bg-muted/40 py-2">
                    <p className="text-lg font-bold">{session.selectedProjects?.length ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">Projects</p>
                  </div>
                  <div className="rounded-lg bg-muted/40 py-2">
                    <p className="text-lg font-bold">{session.bomCount ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">BOMs</p>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground mb-3">
                  Updated {formatDate(session.updatedAt)}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full group-hover:bg-primary/10 transition-colors"
                  style={{ color: 'hsl(187 100% 42%)' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedSessionId(session.id);
                    setStep('detail');
                  }}
                >
                  Open
                  <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md" style={{ background: 'hsl(220 18% 10%)' }}>
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
