'use client';

import { useState } from 'react';
import { Zap, Loader2, Trash2, Table2, Columns, LayoutGrid, CheckSquare } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  useVaveIdeas, useVaveBom, useVaveShouldCosts,
  useBulkCreateVaveIdeas, useUpdateVaveIdea, useDeleteVaveIdea,
} from '@/lib/api/hooks/useVave';
import type { VaveIdea, CreateVaveIdea, VaveBomItem, VaveShouldCost } from '@/lib/api/vave';
import { toast } from 'sonner';

interface Props {
  projectId: string;
}

type IdeaView = 'table' | 'kanban' | 'cards';

// ── Constants ─────────────────────────────────────────────────────────────────

const FRAMEWORK_COLORS: Record<string, string> = {
  SCAMPER: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  TRIZ:    'bg-purple-500/10 text-purple-400 border-purple-500/30',
  FAST:    'bg-amber-500/10 text-amber-400 border-amber-500/30',
  Manual:  'bg-muted/60 text-muted-foreground border-border',
};

type StatusStyle = { badge: string; dot: string; header: string; border: string };
const STATUS_STYLES: Record<string, StatusStyle> = {
  draft:        { badge: 'bg-muted text-muted-foreground',                                         dot: 'bg-muted-foreground',  header: 'text-muted-foreground', border: 'border-muted'        },
  approved:     { badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',               dot: 'bg-emerald-400',       header: 'text-emerald-400',      border: 'border-emerald-500/30' },
  'in-progress':{ badge: 'bg-blue-500/10 text-blue-400 border-blue-500/30',                        dot: 'bg-blue-400',          header: 'text-blue-400',         border: 'border-blue-500/30'  },
  done:         { badge: 'bg-primary/10 text-primary border-primary/30',                           dot: 'bg-primary',           header: 'text-primary',          border: 'border-primary/30'   },
};
const FALLBACK_STYLE: StatusStyle = { badge: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground', header: 'text-muted-foreground', border: 'border-muted' };

const FEASIBILITY_DOTS: Record<string, string> = {
  High:   'bg-emerald-400',
  Medium: 'bg-amber-400',
  Low:    'bg-red-400',
};

const RISK_COLORS: Record<string, string> = {
  High:   'text-red-400',
  Medium: 'text-amber-400',
  Low:    'text-emerald-400',
};

const KANBAN_COLUMNS: { status: VaveIdea['status']; label: string }[] = [
  { status: 'draft',       label: 'Draft'       },
  { status: 'approved',    label: 'Approved'    },
  { status: 'in-progress', label: 'In Progress' },
  { status: 'done',        label: 'Done'        },
];

function formatUSD(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

// ── Status select (shared between views) ─────────────────────────────────────

interface StatusSelectProps {
  idea: VaveIdea;
  onUpdate: (ideaId: string, status: VaveIdea['status']) => void;
}

function StatusSelect({ idea, onUpdate }: StatusSelectProps) {
  const style = STATUS_STYLES[idea.status] ?? FALLBACK_STYLE;
  return (
    <Select
      value={idea.status}
      onValueChange={(v) => onUpdate(idea.id, v as VaveIdea['status'])}
    >
      <SelectTrigger
        className={`h-6 text-[10px] border px-2 rounded-full font-medium ${style?.badge ?? ''}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="draft">Draft</SelectItem>
        <SelectItem value="approved">Approved</SelectItem>
        <SelectItem value="in-progress">In Progress</SelectItem>
        <SelectItem value="done">Done</SelectItem>
      </SelectContent>
    </Select>
  );
}

// ── Table view ────────────────────────────────────────────────────────────────

interface TableViewProps {
  ideas: VaveIdea[];
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onUpdate: (ideaId: string, status: VaveIdea['status']) => void;
  onDelete: (id: string) => void;
}

function TableView({ ideas, selected, onToggleSelect, onUpdate, onDelete }: TableViewProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="px-3 py-2.5 w-8" />
            <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Title</th>
            <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Framework</th>
            <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">Savings</th>
            <th className="text-center px-3 py-2.5 text-xs font-medium text-muted-foreground">Feasibility</th>
            <th className="text-center px-3 py-2.5 text-xs font-medium text-muted-foreground">Complexity</th>
            <th className="text-center px-3 py-2.5 text-xs font-medium text-muted-foreground">Risk</th>
            <th className="text-center px-3 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
            <th className="px-3 py-2.5 w-10" />
          </tr>
        </thead>
        <tbody>
          {ideas.map((idea) => (
            <tr
              key={idea.id}
              className={`border-b last:border-0 hover:bg-muted/20 ${selected.has(idea.id) ? 'bg-primary/5' : ''}`}
            >
              <td className="px-3 py-2.5">
                <button
                  onClick={() => onToggleSelect(idea.id)}
                  className={`h-4 w-4 rounded border flex items-center justify-center transition-colors ${
                    selected.has(idea.id)
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  {selected.has(idea.id) && <CheckSquare className="h-3 w-3" />}
                </button>
              </td>
              <td className="px-3 py-2.5 max-w-[260px]">
                <p className="font-medium text-sm truncate">{idea.title}</p>
                {idea.description && (
                  <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{idea.description}</p>
                )}
                {idea.affectedParts.length > 0 && (
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {idea.affectedParts.slice(0, 3).map((pn) => (
                      <Badge key={pn} variant="secondary" className="text-[9px] font-mono">{pn}</Badge>
                    ))}
                  </div>
                )}
              </td>
              <td className="px-3 py-2.5">
                <Badge variant="outline" className={`text-xs ${FRAMEWORK_COLORS[idea.framework] ?? ''}`}>
                  {idea.framework}
                </Badge>
                {idea.scamperType && (
                  <p className="text-[9px] text-muted-foreground mt-0.5">{idea.scamperType}</p>
                )}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold text-emerald-400">
                {formatUSD(idea.estSavingsUsd)}
              </td>
              <td className="px-3 py-2.5 text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${FEASIBILITY_DOTS[idea.feasibility] ?? 'bg-muted-foreground'}`} />
                  <span className="text-xs">{idea.feasibility}</span>
                </div>
              </td>
              <td className="px-3 py-2.5 text-center">
                <Badge variant="outline" className="text-xs">{idea.complexity}</Badge>
              </td>
              <td className="px-3 py-2.5 text-center">
                <span className={`text-xs ${RISK_COLORS[idea.risk] ?? ''}`}>{idea.risk}</span>
              </td>
              <td className="px-3 py-2.5 text-center">
                <StatusSelect idea={idea} onUpdate={onUpdate} />
              </td>
              <td className="px-3 py-2.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive/60 hover:text-destructive"
                  onClick={() => onDelete(idea.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Kanban view ───────────────────────────────────────────────────────────────

interface KanbanViewProps {
  ideas: VaveIdea[];
  onUpdate: (ideaId: string, status: VaveIdea['status']) => void;
  onDelete: (id: string) => void;
}

function KanbanView({ ideas, onUpdate, onDelete }: KanbanViewProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 overflow-x-auto">
      {KANBAN_COLUMNS.map((col) => {
        const colIdeas = ideas.filter((i) => i.status === col.status);
        const colSavings = colIdeas.reduce((s, i) => s + i.estSavingsUsd, 0);
        const style = STATUS_STYLES[col.status] ?? FALLBACK_STYLE;

        return (
          <div
            key={col.status}
            className={`flex flex-col rounded-lg border bg-muted/20 min-w-[220px] ${style.border}`}
          >
            {/* Column header */}
            <div className={`flex items-center justify-between px-3 py-2.5 border-b ${style.border}`}>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold ${style.header}`}>{col.label}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground font-medium">
                  {colIdeas.length}
                </span>
              </div>
              {colSavings > 0 && (
                <span className="text-[10px] text-emerald-400 font-medium">{formatUSD(colSavings)}</span>
              )}
            </div>

            {/* Cards */}
            <div className="flex flex-col gap-2 p-2 overflow-y-auto max-h-[520px]">
              {colIdeas.length === 0 && (
                <p className="text-xs text-muted-foreground/50 text-center py-6">No ideas</p>
              )}
              {colIdeas.map((idea) => (
                <div
                  key={idea.id}
                  className="rounded-md border bg-card p-3 space-y-2 hover:border-primary/20 transition-colors group"
                >
                  {/* Card header */}
                  <div className="flex items-start justify-between gap-1">
                    <p className="text-xs font-medium leading-snug line-clamp-2 flex-1">{idea.title}</p>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 opacity-0 group-hover:opacity-100 text-destructive/50 hover:text-destructive flex-shrink-0"
                      onClick={() => onDelete(idea.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  {/* Badges row */}
                  <div className="flex items-center gap-1 flex-wrap">
                    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${FRAMEWORK_COLORS[idea.framework] ?? ''}`}>
                      {idea.framework}
                    </Badge>
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0">{idea.complexity}</Badge>
                  </div>

                  {/* Metrics row */}
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-emerald-400 font-semibold">{formatUSD(idea.estSavingsUsd)}</span>
                    <div className="flex items-center gap-1">
                      <span className={`h-1.5 w-1.5 rounded-full ${FEASIBILITY_DOTS[idea.feasibility] ?? 'bg-muted-foreground'}`} />
                      <span className="text-muted-foreground">{idea.feasibility}</span>
                    </div>
                    <span className={`${RISK_COLORS[idea.risk] ?? ''}`}>{idea.risk} risk</span>
                  </div>

                  {/* Status select */}
                  <StatusSelect idea={idea} onUpdate={onUpdate} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Cards view ────────────────────────────────────────────────────────────────

interface CardsViewProps {
  ideas: VaveIdea[];
  onUpdate: (ideaId: string, status: VaveIdea['status']) => void;
  onDelete: (id: string) => void;
}

function CardsView({ ideas, onUpdate, onDelete }: CardsViewProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {ideas.map((idea) => {
        const style = STATUS_STYLES[idea.status] ?? FALLBACK_STYLE;
        return (
          <Card
            key={idea.id}
            className={`border transition-colors hover:border-primary/20 ${style.border}`}
          >
            <CardContent className="p-4 space-y-3">
              {/* Header row */}
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-sm leading-snug flex-1">{idea.title}</p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 flex-shrink-0 text-destructive/50 hover:text-destructive"
                  onClick={() => onDelete(idea.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Description */}
              {idea.description && (
                <p className="text-xs text-muted-foreground line-clamp-2">{idea.description}</p>
              )}

              {/* Framework + complexity */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={`text-[10px] ${FRAMEWORK_COLORS[idea.framework] ?? ''}`}>
                  {idea.framework}
                  {idea.scamperType ? ` · ${idea.scamperType}` : ''}
                </Badge>
                <Badge variant="outline" className="text-[10px]">{idea.complexity}</Badge>
              </div>

              {/* Metrics grid */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2 py-1.5">
                  <p className="text-muted-foreground text-[9px] mb-0.5">Savings</p>
                  <p className="text-emerald-400 font-semibold">{formatUSD(idea.estSavingsUsd)}</p>
                </div>
                <div className="rounded-md bg-muted/40 border border-border px-2 py-1.5">
                  <p className="text-muted-foreground text-[9px] mb-0.5">Feasibility</p>
                  <div className="flex items-center gap-1">
                    <span className={`h-1.5 w-1.5 rounded-full ${FEASIBILITY_DOTS[idea.feasibility] ?? 'bg-muted-foreground'}`} />
                    <span className="font-medium">{idea.feasibility}</span>
                  </div>
                </div>
                <div className="rounded-md bg-muted/40 border border-border px-2 py-1.5">
                  <p className="text-muted-foreground text-[9px] mb-0.5">Risk</p>
                  <p className={`font-medium ${RISK_COLORS[idea.risk] ?? ''}`}>{idea.risk}</p>
                </div>
              </div>

              {/* Affected parts */}
              {idea.affectedParts.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {idea.affectedParts.slice(0, 4).map((pn) => (
                    <Badge key={pn} variant="secondary" className="text-[9px] font-mono">{pn}</Badge>
                  ))}
                  {idea.affectedParts.length > 4 && (
                    <span className="text-[9px] text-muted-foreground self-center">
                      +{idea.affectedParts.length - 4} more
                    </span>
                  )}
                </div>
              )}

              {/* Status select */}
              <StatusSelect idea={idea} onUpdate={onUpdate} />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function IdeaRepository({ projectId }: Props) {
  const [view, setView] = useState<IdeaView>('table');
  const [generating, setGenerating] = useState(false);
  const [filterFramework, setFilterFramework] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterFeasibility, setFilterFeasibility] = useState<string>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: ideas } = useVaveIdeas(projectId);
  const { data: bomItems } = useVaveBom(projectId);
  const { data: shouldCosts } = useVaveShouldCosts(projectId);

  const bulkCreate = useBulkCreateVaveIdeas(projectId);
  const updateIdea = useUpdateVaveIdea(projectId);
  const deleteIdea = useDeleteVaveIdea(projectId);

  const allIdeas = (ideas as VaveIdea[]) ?? [];
  const items = (bomItems as VaveBomItem[]) ?? [];
  const costs = (shouldCosts as VaveShouldCost[]) ?? [];

  const filtered = allIdeas.filter((idea) => {
    if (filterFramework !== 'all' && idea.framework !== filterFramework) return false;
    if (filterStatus !== 'all' && idea.status !== filterStatus) return false;
    if (filterFeasibility !== 'all' && idea.feasibility !== filterFeasibility) return false;
    return true;
  });

  const totalSavings = filtered.reduce((s, i) => s + i.estSavingsUsd, 0);
  const statusCounts = allIdeas.reduce<Record<string, number>>((acc, idea) => {
    acc[idea.status] = (acc[idea.status] ?? 0) + 1;
    return acc;
  }, {});

  const handleGenerate = async () => {
    if (!items.length) {
      toast.error('Add BOM items before generating ideas');
      return;
    }
    setGenerating(true);
    try {
      const sorted = [...items].sort((a, b) => b.annualSpend - a.annualSpend);
      const focusAreas = sorted.slice(0, 5).map(
        (i) => `${i.partNumber} (${i.description ?? 'no desc'}) — $${i.annualSpend.toLocaleString()} annual spend`
      );
      const res = await fetch('/api/vave/ideation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bomItems: items, focusAreas, shouldCostGaps: costs }),
      });
      if (!res.ok) throw new Error('Ideation API failed');
      const generated: CreateVaveIdea[] = await res.json();
      if (!generated.length) {
        toast.error('AI returned no ideas — try adding more BOM data');
        return;
      }
      await bulkCreate.mutateAsync(generated);
    } catch {
      toast.error('Failed to generate ideas. Check AI configuration.');
    } finally {
      setGenerating(false);
    }
  };

  const handleUpdate = (ideaId: string, status: VaveIdea['status']) => {
    updateIdea.mutate({ ideaId, data: { status } });
  };

  const handleDelete = (id: string) => {
    deleteIdea.mutate(id);
    setSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
  };

  const handleToggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Bulk actions
  const handleBulkApprove = () => {
    selected.forEach((id) => updateIdea.mutate({ ideaId: id, data: { status: 'approved' } }));
    setSelected(new Set());
    toast.success(`Approved ${selected.size} idea${selected.size > 1 ? 's' : ''}`);
  };

  const handleBulkReject = () => {
    selected.forEach((id) => updateIdea.mutate({ ideaId: id, data: { status: 'draft' } }));
    setSelected(new Set());
    toast.success(`Moved ${selected.size} idea${selected.size > 1 ? 's' : ''} back to Draft`);
  };

  const handleBulkDelete = () => {
    selected.forEach((id) => deleteIdea.mutate(id));
    setSelected(new Set());
    toast.success(`Deleted ${selected.size} idea${selected.size > 1 ? 's' : ''}`);
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          {/* View toggle — segmented control */}
          <div className="flex items-center border rounded-lg p-0.5 gap-0.5">
            <Button
              variant={view === 'table' ? 'secondary' : 'ghost'}
              size="icon"
              className="h-7 w-7"
              title="Table view"
              onClick={() => setView('table')}
            >
              <Table2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={view === 'kanban' ? 'secondary' : 'ghost'}
              size="icon"
              className="h-7 w-7"
              title="Kanban view"
              onClick={() => setView('kanban')}
            >
              <Columns className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={view === 'cards' ? 'secondary' : 'ghost'}
              size="icon"
              className="h-7 w-7"
              title="Cards view"
              onClick={() => setView('cards')}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Filters */}
          <Select value={filterFramework} onValueChange={setFilterFramework}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue placeholder="Framework" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All frameworks</SelectItem>
              <SelectItem value="SCAMPER">SCAMPER</SelectItem>
              <SelectItem value="TRIZ">TRIZ</SelectItem>
              <SelectItem value="FAST">FAST</SelectItem>
              <SelectItem value="Manual">Manual</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="in-progress">In Progress</SelectItem>
              <SelectItem value="done">Done</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterFeasibility} onValueChange={setFilterFeasibility}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue placeholder="Feasibility" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All feasibility</SelectItem>
              <SelectItem value="High">High</SelectItem>
              <SelectItem value="Medium">Medium</SelectItem>
              <SelectItem value="Low">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button size="sm" onClick={handleGenerate} disabled={generating}>
          {generating ? (
            <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Generating…</>
          ) : (
            <><Zap className="h-3.5 w-3.5 mr-1.5" />Generate AI Ideas</>
          )}
        </Button>
      </div>

      {/* Summary bar */}
      {allIdeas.length > 0 && (
        <div className="flex items-center gap-6 px-4 py-2.5 rounded-lg bg-muted/30 text-sm flex-wrap">
          <span><strong>{allIdeas.length}</strong> ideas</span>
          <span className="text-emerald-400"><strong>{formatUSD(totalSavings)}</strong> est. savings (filtered)</span>
          <div className="flex gap-2 text-xs">
            {Object.entries(statusCounts).map(([status, count]) => {
              const style = STATUS_STYLES[status] ?? FALLBACK_STYLE;
              return (
                <span
                  key={status}
                  className={`px-2 py-0.5 rounded-full font-medium border ${style?.badge ?? 'bg-muted text-muted-foreground'}`}
                >
                  {count} {status}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Main content */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-col items-center justify-center py-14 gap-3 text-muted-foreground">
              <Zap className="h-8 w-8 opacity-30" />
              <p className="text-sm">No ideas yet. Generate AI ideas or add them manually.</p>
              <Button size="sm" onClick={handleGenerate} disabled={generating || !items.length}>
                {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1.5" />}
                Generate AI Ideas
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : view === 'table' ? (
        <Card>
          <CardContent className="p-0">
            <TableView
              ideas={filtered}
              selected={selected}
              onToggleSelect={handleToggleSelect}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          </CardContent>
        </Card>
      ) : view === 'kanban' ? (
        <KanbanView ideas={filtered} onUpdate={handleUpdate} onDelete={handleDelete} />
      ) : (
        <CardsView ideas={filtered} onUpdate={handleUpdate} onDelete={handleDelete} />
      )}

      {/* Floating bulk action bar (table view only, when rows selected) */}
      {view === 'table' && selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl border bg-card shadow-xl">
          <span className="text-xs text-muted-foreground mr-1">
            {selected.size} selected
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
            onClick={handleBulkApprove}
          >
            Approve Selected
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={handleBulkReject}
          >
            Reject (→ Draft)
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
            onClick={handleBulkDelete}
          >
            Delete Selected
          </Button>
          <button
            className="ml-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setSelected(new Set())}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
