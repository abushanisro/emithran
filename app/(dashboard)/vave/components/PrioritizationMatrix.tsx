'use client';

import { useState, useRef } from 'react';
import { Wand2, ChevronDown, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useVaveIdeas, useUpdateVaveIdea } from '@/lib/api/hooks/useVave';
import type { VaveIdea } from '@/lib/api/vave';
import { toast } from 'sonner';

interface Props {
  projectId: string;
}

type Quadrant = 'QuickWin' | 'Strategic' | 'FillIn' | 'Avoid';
type ViewType = 'matrix' | 'scoring' | 'gantt';
type SortField = 'rank' | 'title' | 'savings' | 'feasibility' | 'risk' | 'complexity' | 'score' | 'quadrant';
type SortDir = 'asc' | 'desc';

// ── Config ─────────────────────────────────────────────────────────────────────

const QUADRANT_CONFIG: Record<Quadrant, {
  label: string; subLabel: string;
  bg: string; border: string; headerText: string; countText: string;
  barColor: string;
}> = {
  QuickWin:  { label: 'Quick Wins',     subLabel: 'High savings · Low effort',  bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', headerText: 'text-emerald-400', countText: 'text-emerald-300', barColor: 'bg-emerald-500' },
  Strategic: { label: 'Strategic Bets', subLabel: 'High savings · High effort', bg: 'bg-blue-500/10',    border: 'border-blue-500/30',    headerText: 'text-blue-400',    countText: 'text-blue-300',   barColor: 'bg-blue-500' },
  FillIn:    { label: 'Fill-ins',       subLabel: 'Low savings · Low effort',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   headerText: 'text-amber-400',   countText: 'text-amber-300',  barColor: 'bg-amber-500' },
  Avoid:     { label: 'Avoid',          subLabel: 'Low savings · High effort',  bg: 'bg-muted/40',       border: 'border-border',         headerText: 'text-muted-foreground', countText: 'text-muted-foreground', barColor: 'bg-muted-foreground' },
};


const VIEW_OPTIONS: { value: ViewType; label: string; description: string }[] = [
  { value: 'matrix',  label: '2×2 Matrix',     description: 'Drag ideas into impact/effort quadrants' },
  { value: 'scoring', label: 'Impact Scoring',  description: 'Weighted score across 5 dimensions' },
  { value: 'gantt',   label: 'Gantt Timeline',  description: 'Implementation timeline for assigned ideas' },
];

const FEASIBILITY_DOTS: Record<string, string> = {
  High:   'bg-emerald-500',
  Medium: 'bg-amber-500',
  Low:    'bg-red-500',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatUSD(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function feasibilityScore(f: string): number {
  return f === 'High' ? 10 : f === 'Medium' ? 6 : 3;
}

function riskScore(r: string): number {
  return r === 'Low' ? 10 : r === 'Medium' ? 6 : 3;
}

function complexityScore(c: string): number {
  return c === 'L1' ? 10 : c === 'L2' ? 6 : 3;
}

function computeWeightedScore(idea: VaveIdea, maxSavings: number): number {
  const savingsRaw = maxSavings > 0 ? (idea.estSavingsUsd / maxSavings) * 10 : 0;
  return (
    savingsRaw         * 0.40 +
    feasibilityScore(idea.feasibility) * 0.25 +
    riskScore(idea.risk)               * 0.20 +
    complexityScore(idea.complexity)   * 0.15
  );
}

function scoreColor(score: number): string {
  if (score >= 7) return 'text-emerald-400';
  if (score >= 4) return 'text-amber-400';
  return 'text-red-400';
}

function scoreBg(score: number): string {
  if (score >= 7) return 'bg-emerald-500';
  if (score >= 4) return 'bg-amber-500';
  return 'bg-red-500';
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SortIcon({ field, sortBy, sortDir }: { field: SortField; sortBy: SortField; sortDir: SortDir }) {
  if (field !== sortBy) return <ArrowUpDown className="h-3 w-3 text-muted-foreground/40 ml-1 inline" />;
  return sortDir === 'asc'
    ? <ArrowUp className="h-3 w-3 text-primary ml-1 inline" />
    : <ArrowDown className="h-3 w-3 text-primary ml-1 inline" />;
}

// ── View 1: 2×2 Matrix ─────────────────────────────────────────────────────────

function MatrixView({ projectId, ideas }: { projectId: string; ideas: VaveIdea[] }) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragOverQuadrant = useRef<Quadrant | null>(null);
  const updateIdea = useUpdateVaveIdea(projectId);

  const unassigned = ideas.filter((i) => !i.quadrant);
  const quadrantIdeas = (q: Quadrant) => ideas.filter((i) => i.quadrant === q);

  const handleDrop = async (quadrant: Quadrant) => {
    if (!draggingId) return;
    await updateIdea.mutateAsync({ ideaId: draggingId, data: { quadrant } });
    setDraggingId(null);
    dragOverQuadrant.current = null;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {(['QuickWin', 'Strategic', 'FillIn', 'Avoid'] as Quadrant[]).map((quadrant) => {
          const config = QUADRANT_CONFIG[quadrant];
          const qIdeas = quadrantIdeas(quadrant);
          const qSavings = qIdeas.reduce((s, i) => s + i.estSavingsUsd, 0);

          return (
            <div
              key={quadrant}
              className={`rounded-xl border ${config.border} ${config.bg} min-h-[280px] flex flex-col`}
              onDragOver={(e) => { e.preventDefault(); dragOverQuadrant.current = quadrant; }}
              onDrop={() => handleDrop(quadrant)}
            >
              <div className={`px-4 pt-3 pb-2 border-b ${config.border}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`font-semibold text-sm ${config.headerText}`}>{config.label}</p>
                    <p className="text-[10px] text-muted-foreground">{config.subLabel}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold ${config.countText}`}>{qIdeas.length}</p>
                    <p className="text-[10px] text-muted-foreground">{formatUSD(qSavings)}</p>
                  </div>
                </div>
              </div>
              <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[320px]">
                {qIdeas.length === 0 ? (
                  <div className="flex items-center justify-center h-20 text-muted-foreground/40 text-xs border border-dashed border-border/40 rounded-lg mx-1 mt-1">
                    Drop ideas here
                  </div>
                ) : (
                  qIdeas.map((idea) => (
                    <div
                      key={idea.id}
                      draggable
                      onDragStart={() => setDraggingId(idea.id)}
                      onDragEnd={() => setDraggingId(null)}
                      className="bg-card rounded-lg border border-border/60 px-3 py-2 cursor-grab active:cursor-grabbing hover:border-primary/30 hover:shadow-md transition-all"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium line-clamp-2 flex-1">{idea.title}</p>
                        <span className="text-xs font-bold text-emerald-400 shrink-0">{formatUSD(idea.estSavingsUsd)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${FEASIBILITY_DOTS[idea.feasibility] ?? 'bg-muted-foreground'}`} />
                        <Badge variant="secondary" className="text-[9px] h-4 px-1">{idea.framework}</Badge>
                        <Badge variant="outline" className="text-[9px] h-4 px-1">{idea.complexity}</Badge>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {unassigned.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-3">
            <CardTitle className="text-sm text-muted-foreground">
              Unassigned ({unassigned.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="flex flex-wrap gap-2">
              {unassigned.map((idea) => (
                <div
                  key={idea.id}
                  draggable
                  onDragStart={() => setDraggingId(idea.id)}
                  onDragEnd={() => setDraggingId(null)}
                  className="bg-muted rounded-lg border border-border/60 px-3 py-1.5 cursor-grab text-xs font-medium hover:shadow-sm"
                >
                  {idea.title} · <span className="text-emerald-400">{formatUSD(idea.estSavingsUsd)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── View 2: Impact Scoring ──────────────────────────────────────────────────────

function ScoringView({ projectId, ideas }: { projectId: string; ideas: VaveIdea[] }) {
  const [sortBy, setSortBy] = useState<SortField>('rank');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const updateIdea = useUpdateVaveIdea(projectId);

  const maxSavings = Math.max(...ideas.map((i) => i.estSavingsUsd), 1);

  const scored = ideas.map((idea, idx) => ({
    ...idea,
    savingsScore:      maxSavings > 0 ? (idea.estSavingsUsd / maxSavings) * 10 : 0,
    feasibilityScore:  feasibilityScore(idea.feasibility),
    riskScore:         riskScore(idea.risk),
    complexityScore:   complexityScore(idea.complexity),
    weightedScore:     computeWeightedScore(idea, maxSavings),
    _origIdx: idx,
  }));

  const sorted = [...scored].sort((a, b) => {
    let diff = 0;
    switch (sortBy) {
      case 'rank':        diff = a.weightedScore - b.weightedScore; break; // rank = desc score, handled by default dir
      case 'title':       diff = a.title.localeCompare(b.title); break;
      case 'savings':     diff = a.estSavingsUsd - b.estSavingsUsd; break;
      case 'feasibility': diff = a.feasibilityScore - b.feasibilityScore; break;
      case 'risk':        diff = a.riskScore - b.riskScore; break;
      case 'complexity':  diff = a.complexityScore - b.complexityScore; break;
      case 'score':       diff = a.weightedScore - b.weightedScore; break;
      case 'quadrant':    diff = (a.quadrant ?? '').localeCompare(b.quadrant ?? ''); break;
    }
    return sortDir === 'asc' ? diff : -diff;
  });

  // When sorted by rank (default asc), rank 1 = highest score
  const rankMap = new Map(
    [...scored].sort((a, b) => b.weightedScore - a.weightedScore).map((s, i) => [s.id, i + 1])
  );

  const handleSort = (field: SortField) => {
    if (field === sortBy) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir(field === 'rank' ? 'asc' : 'desc');
    }
  };

  const handleMove = async (ideaId: string, quadrant: Quadrant) => {
    await updateIdea.mutateAsync({ ideaId, data: { quadrant } });
    toast.success(`Moved to ${QUADRANT_CONFIG[quadrant].label}`);
  };

  const Th = ({ field, children, className = '' }: { field: SortField; children: React.ReactNode; className?: string }) => (
    <th
      className={`px-3 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground select-none ${className}`}
      onClick={() => handleSort(field)}
    >
      {children}
      <SortIcon field={field} sortBy={sortBy} sortDir={sortDir} />
    </th>
  );

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 border-b border-border">
            <tr>
              <Th field="rank" className="w-14">Rank</Th>
              <Th field="title">Idea</Th>
              <Th field="savings">Savings</Th>
              <Th field="feasibility">Feasibility</Th>
              <Th field="risk">Risk</Th>
              <Th field="complexity">Complexity</Th>
              <Th field="score">Score</Th>
              <Th field="quadrant">Quadrant</Th>
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider w-36">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No ideas to score. Add ideas in the Idea Repository.
                </td>
              </tr>
            ) : (
              sorted.map((idea) => {
                const rank = rankMap.get(idea.id) ?? 0;
                return (
                  <tr key={idea.id} className="hover:bg-muted/20 transition-colors">
                    {/* Rank */}
                    <td className="px-3 py-2.5">
                      <span className={`text-xs font-bold ${rank <= 3 ? 'text-primary' : 'text-muted-foreground'}`}>
                        #{rank}
                      </span>
                    </td>

                    {/* Title */}
                    <td className="px-3 py-2.5">
                      <p className="text-xs font-medium max-w-[200px] truncate" title={idea.title}>
                        {idea.title}
                      </p>
                      <div className="flex gap-1 mt-0.5">
                        <Badge variant="secondary" className="text-[9px] h-3.5 px-1">{idea.framework}</Badge>
                      </div>
                    </td>

                    {/* Savings */}
                    <td className="px-3 py-2.5">
                      <span className="text-xs font-semibold text-emerald-400">{formatUSD(idea.estSavingsUsd)}</span>
                      <div className="w-16 h-1 bg-muted/60 rounded-full mt-1 overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full"
                          style={{ width: `${(idea.savingsScore / 10) * 100}%` }}
                        />
                      </div>
                    </td>

                    {/* Feasibility */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${FEASIBILITY_DOTS[idea.feasibility] ?? 'bg-muted'}`} />
                        <span className="text-xs text-muted-foreground">{idea.feasibility}</span>
                        <span className={`text-xs font-semibold ${scoreColor(idea.feasibilityScore)}`}>
                          {idea.feasibilityScore}
                        </span>
                      </div>
                    </td>

                    {/* Risk */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">{idea.risk}</span>
                        <span className={`text-xs font-semibold ${scoreColor(idea.riskScore)}`}>
                          {idea.riskScore}
                        </span>
                      </div>
                    </td>

                    {/* Complexity */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">{idea.complexity}</span>
                        <span className={`text-xs font-semibold ${scoreColor(idea.complexityScore)}`}>
                          {idea.complexityScore}
                        </span>
                      </div>
                    </td>

                    {/* Weighted Score */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-bold tabular-nums ${scoreColor(idea.weightedScore)}`}>
                          {idea.weightedScore.toFixed(1)}
                        </span>
                        <div className="w-14 h-1.5 bg-muted/60 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${scoreBg(idea.weightedScore)}`}
                            style={{ width: `${(idea.weightedScore / 10) * 100}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Quadrant */}
                    <td className="px-3 py-2.5">
                      {idea.quadrant ? (
                        <span className={`text-[10px] font-medium ${QUADRANT_CONFIG[idea.quadrant as Quadrant]?.headerText ?? 'text-muted-foreground'}`}>
                          {QUADRANT_CONFIG[idea.quadrant as Quadrant]?.label ?? idea.quadrant}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/50">Unassigned</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-3 py-2.5">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1">
                            Move to <ChevronDown className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-[160px]">
                          {(['QuickWin', 'Strategic', 'FillIn', 'Avoid'] as Quadrant[]).map((q) => (
                            <DropdownMenuItem
                              key={q}
                              onClick={() => handleMove(idea.id, q)}
                              className="text-xs gap-2"
                            >
                              <span className={`h-2 w-2 rounded-full ${QUADRANT_CONFIG[q].barColor}`} />
                              {QUADRANT_CONFIG[q].label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Score legend */}
      <div className="px-4 py-2 bg-muted/20 border-t border-border flex items-center gap-4 text-[10px] text-muted-foreground">
        <span className="font-medium">Score Legend:</span>
        <span><span className="text-emerald-400 font-semibold">≥7.0</span> — High Priority</span>
        <span><span className="text-amber-400 font-semibold">4.0–6.9</span> — Medium Priority</span>
        <span><span className="text-red-400 font-semibold">&lt;4.0</span> — Low Priority</span>
        <span className="ml-auto">Weights: Savings 40% · Feasibility 25% · Risk 20% · Complexity 15%</span>
      </div>
    </div>
  );
}

// ── View 3: Gantt Timeline ──────────────────────────────────────────────────────

function GanttView({ ideas }: { ideas: VaveIdea[] }) {
  const assignedIdeas = ideas.filter((i) => i.quadrant);

  const ideasWithMonths = assignedIdeas.map((idea) => ({
    ...idea,
    months: idea.timeToImplementMonths ?? 3,
    isDefault: !idea.timeToImplementMonths,
  }));

  const maxMonths = Math.max(...ideasWithMonths.map((i) => i.months), 6);
  const gridMonths = Math.max(maxMonths, 12);
  const monthCols = Array.from({ length: gridMonths }, (_, i) => i + 1);

  if (assignedIdeas.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm border border-dashed border-border/40 rounded-xl">
        No ideas assigned to quadrants yet. Use the 2×2 Matrix or Auto-assign first.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground px-1">
        <span className="font-medium text-foreground">Total implementation span: {maxMonths} months</span>
        <span>·</span>
        <span>{ideasWithMonths.length} ideas on timeline</span>
        {ideasWithMonths.some((i) => i.isDefault) && (
          <>
            <span>·</span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-8 h-2 border border-dashed border-muted-foreground rounded" />
              = default (3mo)
            </span>
          </>
        )}
      </div>

      {/* Gantt chart */}
      <div className="rounded-xl border border-border overflow-hidden">
        {/* Month header */}
        <div className="flex border-b border-border bg-muted/40">
          <div className="w-[220px] shrink-0 px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Idea
          </div>
          <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${gridMonths}, minmax(0, 1fr))` }}>
            {monthCols.map((m) => (
              <div
                key={m}
                className={`text-center text-[9px] font-medium py-2 border-l border-border/40 ${m % 2 === 0 ? 'bg-muted/20' : ''}`}
              >
                <span className="text-muted-foreground">M{m}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Rows */}
        <div className="divide-y divide-border/30">
          {ideasWithMonths.map((idea) => {
            const quadrant = idea.quadrant as Quadrant;
            const config = QUADRANT_CONFIG[quadrant];
            const widthPct = (idea.months / gridMonths) * 100;

            return (
              <div key={idea.id} className="flex items-center group hover:bg-muted/10 transition-colors">
                {/* Title */}
                <div className="w-[220px] shrink-0 px-3 py-3">
                  <p className="text-xs font-medium truncate" title={idea.title}>
                    {truncate(idea.title, 30)}
                  </p>
                  <p className={`text-[9px] ${config.headerText} mt-0.5`}>{config.label}</p>
                </div>

                {/* Bar area */}
                <div
                  className="flex-1 relative py-2.5 pr-2"
                  style={{ height: '48px' }}
                >
                  {/* Grid lines */}
                  <div className="absolute inset-0 grid pointer-events-none" style={{ gridTemplateColumns: `repeat(${gridMonths}, minmax(0, 1fr))` }}>
                    {monthCols.map((m) => (
                      <div key={m} className={`border-l border-border/20 ${m % 2 === 0 ? 'bg-muted/10' : ''}`} />
                    ))}
                  </div>

                  {/* Bar */}
                  <div
                    className={`absolute top-1/2 -translate-y-1/2 h-5 rounded-md flex items-center px-2 ${
                      idea.isDefault
                        ? `border border-dashed ${config.border} bg-transparent`
                        : `${config.bg} ${config.border} border`
                    }`}
                    style={{ left: 0, width: `${widthPct}%`, minWidth: '32px' }}
                  >
                    <span className={`text-[9px] font-semibold truncate ${config.headerText}`}>
                      {idea.months}mo
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-1 flex-wrap">
        {(['QuickWin', 'Strategic', 'FillIn', 'Avoid'] as Quadrant[]).map((q) => {
          const hasIdeas = ideasWithMonths.some((i) => i.quadrant === q);
          if (!hasIdeas) return null;
          const config = QUADRANT_CONFIG[q];
          return (
            <div key={q} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className={`h-3 w-5 rounded-sm ${config.bg} border ${config.border}`} />
              {config.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function PrioritizationMatrix({ projectId }: Props) {
  const [currentView, setCurrentView] = useState<ViewType>('matrix');
  const [autoAssigning, setAutoAssigning] = useState(false);

  const { data: ideas } = useVaveIdeas(projectId);
  const updateIdea = useUpdateVaveIdea(projectId);

  const allIdeas = (ideas as VaveIdea[]) ?? [];
  const activeOption = VIEW_OPTIONS.find((o) => o.value === currentView)!;

  const handleAutoAssign = async () => {
    if (!allIdeas.length) {
      toast.error('No ideas to assign');
      return;
    }
    setAutoAssigning(true);
    const savings = [...allIdeas.map((i) => i.estSavingsUsd)].sort((a, b) => a - b);
    const medianSavings = savings[Math.floor(savings.length / 2)] ?? 0;

    const promises = allIdeas.map((idea) => {
      const highSavings = idea.estSavingsUsd >= medianSavings;
      const lowEffort = idea.complexity === 'L1' || (idea.complexity === 'L2' && idea.risk !== 'High');
      let quadrant: Quadrant;
      if (highSavings && lowEffort) quadrant = 'QuickWin';
      else if (highSavings && !lowEffort) quadrant = 'Strategic';
      else if (!highSavings && lowEffort) quadrant = 'FillIn';
      else quadrant = 'Avoid';
      return updateIdea.mutateAsync({ ideaId: idea.id, data: { quadrant } });
    });

    await Promise.all(promises);
    setAutoAssigning(false);
    toast.success('Quadrants assigned');
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 min-w-[200px] justify-between">
                <span>{activeOption.label}</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[280px]">
              {VIEW_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setCurrentView(opt.value)}
                  className={`flex flex-col items-start gap-0.5 py-2 ${currentView === opt.value ? 'bg-primary/10' : ''}`}
                >
                  <span className={`text-sm font-medium ${currentView === opt.value ? 'text-primary' : ''}`}>
                    {opt.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{opt.description}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <p className="text-xs text-muted-foreground hidden sm:block">{activeOption.description}</p>
        </div>

        <Button size="sm" variant="outline" onClick={handleAutoAssign} disabled={autoAssigning}>
          {autoAssigning ? (
            <span className="animate-spin mr-1.5 text-base leading-none">⟳</span>
          ) : (
            <Wand2 className="h-3.5 w-3.5 mr-1.5" />
          )}
          Auto-assign Quadrants
        </Button>
      </div>

      {/* Views */}
      {currentView === 'matrix'  && <MatrixView  projectId={projectId} ideas={allIdeas} />}
      {currentView === 'scoring' && <ScoringView projectId={projectId} ideas={allIdeas} />}
      {currentView === 'gantt'   && <GanttView   ideas={allIdeas} />}
    </div>
  );
}
