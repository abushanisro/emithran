'use client';

import { useState } from 'react';
import { Loader2, RefreshCw, Calculator, Sparkles, ChevronDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell, CartesianGrid, BarChart, PieChart, Pie,
} from 'recharts';
import { useVaveBom, useVaveShouldCosts, useUpsertShouldCost } from '@/lib/api/hooks/useVave';
import type { VaveBomItem, CostAnalysisResult, ShouldCostResult } from '@/lib/api/vave';
import { toast } from 'sonner';

interface Props { projectId: string }

type AnalysisView = 'pareto' | 'waterfall' | 'supplier' | 'affinity' | 'qfd';

const ANALYSIS_OPTIONS: { value: AnalysisView; label: string; description: string; ai: boolean }[] = [
  { value: 'pareto',    label: 'Pareto Analysis (80/20)',       description: 'Top cost drivers by annual spend',          ai: false },
  { value: 'waterfall', label: 'Cost Waterfall by Subsystem',   description: 'Spend breakdown by BOM level / assembly',   ai: false },
  { value: 'supplier',  label: 'Supplier Spend Analysis',       description: 'Spend ranking, tail-spend & consolidation', ai: false },
  { value: 'affinity',  label: 'Affinity Mapping',              description: 'AI-clustered functional groups',            ai: true  },
  { value: 'qfd',       label: 'QFD Matrix',                    description: 'Customer needs vs. part functions',         ai: true  },
];

const QFD_WEIGHT: Record<string, { label: string; bg: string; text: string }> = {
  Strong: { label: '●●●', bg: 'bg-primary/20',  text: 'text-primary'         },
  Medium: { label: '●●○', bg: 'bg-amber-500/15', text: 'text-amber-400'       },
  Weak:   { label: '●○○', bg: 'bg-muted/60',     text: 'text-muted-foreground' },
  None:   { label: '—',   bg: '',               text: 'text-muted-foreground/30' },
};

function fmtUSD(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

// ── Local computation helpers ──────────────────────────────────────────────────

function buildParetoData(items: VaveBomItem[]) {
  const sorted = [...items].sort((a, b) => b.annualSpend - a.annualSpend).slice(0, 15);
  const total = sorted.reduce((s, i) => s + i.annualSpend, 0);
  let cum = 0;
  return sorted.map((item) => {
    cum += item.annualSpend;
    const cumPct = total > 0 ? (cum / total) * 100 : 0;
    return { name: item.partNumber, spend: item.annualSpend, cumPct, isTop: cumPct <= 80 };
  });
}

function buildWaterfallData(items: VaveBomItem[]) {
  const levelMap: Record<number, { spend: number; count: number }> = {};
  items.forEach((item) => {
    const lvl = item.level ?? 1;
    if (!levelMap[lvl]) levelMap[lvl] = { spend: 0, count: 0 };
    levelMap[lvl].spend += item.annualSpend;
    levelMap[lvl].count += 1;
  });
  const LEVEL_LABELS: Record<number, string> = { 1: 'L1 Assembly', 2: 'L2 Sub-Assembly', 3: 'L3 Component' };
  return Object.entries(levelMap)
    .map(([lvl, d]) => ({ name: LEVEL_LABELS[Number(lvl)] ?? `L${lvl}`, spend: d.spend, count: d.count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function buildSupplierData(items: VaveBomItem[]) {
  const map = new Map<string, number>();
  items.forEach((item) => {
    const key = item.supplierName ?? 'Unknown';
    map.set(key, (map.get(key) ?? 0) + item.annualSpend);
  });
  const total = items.reduce((s, i) => s + i.annualSpend, 0);
  const sorted = [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, spend]) => ({ name, spend, pct: total > 0 ? (spend / total) * 100 : 0 }));
  const tailThreshold = total * 0.03;
  return { suppliers: sorted, tailThreshold, total };
}

// ── Chart tooltip style ────────────────────────────────────────────────────────
const TOOLTIP_STYLE = {
  contentStyle: { background: 'hsl(220 18% 10%)', border: '1px solid hsl(220 15% 18%)', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: 'hsl(210 20% 95%)' },
};
const AXIS_TICK = { fontSize: 10, fill: 'hsl(215 15% 55%)' };
const GRID_STROKE = 'hsl(220 15% 18%)';

// ── Sub-views ──────────────────────────────────────────────────────────────────

function ParetoView({ items }: { items: VaveBomItem[] }) {
  const data = buildParetoData(items);
  const total = items.reduce((s, i) => s + i.annualSpend, 0);
  const top20 = data.filter((d) => d.isTop);
  const top20Spend = top20.reduce((s, d) => s + d.spend, 0);

  if (!items.length) return <EmptyState message="Import BOM items to see Pareto analysis" />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Pill color="red" label={`${top20.length} parts = ${total > 0 ? ((top20Spend / total) * 100).toFixed(0) : 0}% of spend (80/20 rule)`} />
        <Pill color="muted" label={`Total annual spend: ${fmtUSD(total)}`} />
        <Pill color="muted" label={`${items.length} parts`} />
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 8, right: 40, bottom: 64, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="name" tick={AXIS_TICK} angle={-40} textAnchor="end" interval={0} />
          <YAxis yAxisId="left" tickFormatter={fmtUSD} tick={AXIS_TICK} />
          <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v.toFixed(0)}%`} tick={AXIS_TICK} domain={[0, 100]} />
          <Tooltip {...TOOLTIP_STYLE} formatter={(v: any, n: string) => n === 'spend' ? [fmtUSD(v), 'Annual Spend'] : [`${Number(v).toFixed(1)}%`, 'Cumulative %']} />
          <ReferenceLine yAxisId="right" y={80} stroke="hsl(0 72% 51%)" strokeDasharray="5 3"
            label={{ value: '80%', position: 'insideTopRight', fontSize: 10, fill: 'hsl(0 72% 51%)' }} />
          <Bar yAxisId="left" dataKey="spend" maxBarSize={40} radius={[4, 4, 0, 0]}>
            {data.map((entry, i) => <Cell key={i} fill={entry.isTop ? 'hsl(0 72% 51%)' : 'hsl(220 15% 30%)'} />)}
          </Bar>
          <Line yAxisId="right" type="monotone" dataKey="cumPct" stroke="hsl(187 100% 42%)" dot={false} strokeWidth={2} />
        </ComposedChart>
      </ResponsiveContainer>
      <Legend3 />
    </div>
  );
}

function WaterfallView({ items }: { items: VaveBomItem[] }) {
  const data = buildWaterfallData(items);
  const total = data.reduce((s, d) => s + d.spend, 0);
  if (!items.length) return <EmptyState message="Import BOM items to see cost waterfall" />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Pill color="muted" label={`Total: ${fmtUSD(total)}`} />
        <Pill color="muted" label={`${data.length} BOM levels`} />
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 8, right: 20, bottom: 24, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="name" tick={AXIS_TICK} />
          <YAxis tickFormatter={fmtUSD} tick={AXIS_TICK} />
          <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [fmtUSD(v), 'Annual Spend']} />
          <Bar dataKey="spend" maxBarSize={80} radius={[6, 6, 0, 0]}>
            {data.map((_, i) => {
              const colors = ['hsl(187 100% 42%)', 'hsl(280 70% 50%)', 'hsl(38 92% 50%)', 'hsl(160 70% 45%)'];
              return <Cell key={i} fill={colors[i % colors.length]} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-muted/40">
            <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">BOM Level</th>
            <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Parts</th>
            <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Annual Spend</th>
            <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">% of Total</th>
          </tr></thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.name} className="border-b last:border-0 hover:bg-muted/20">
                <td className="px-3 py-2 font-medium">{row.name}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">{row.count}</td>
                <td className="px-3 py-2 text-right font-semibold text-primary">{fmtUSD(row.spend)}</td>
                <td className="px-3 py-2 text-right">{total > 0 ? ((row.spend / total) * 100).toFixed(1) : 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SupplierView({ items }: { items: VaveBomItem[] }) {
  const { suppliers, tailThreshold, total } = buildSupplierData(items);
  const PIE_COLORS = ['hsl(187 100% 42%)', 'hsl(280 70% 50%)', 'hsl(38 92% 50%)', 'hsl(160 70% 45%)', 'hsl(0 72% 51%)', 'hsl(200 90% 50%)'];
  const tail = suppliers.filter((s) => s.spend < tailThreshold);
  const top = suppliers.filter((s) => s.spend >= tailThreshold);

  if (!items.length) return <EmptyState message="Import BOM items to see supplier spend" />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Pill color="muted" label={`${suppliers.length} suppliers`} />
        {tail.length > 0 && <Pill color="amber" label={`${tail.length} tail-spend suppliers (<3%)`} />}
        <Pill color="muted" label={`Total: ${fmtUSD(total)}`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie data={top.slice(0, 6).map((s) => ({ name: s.name, value: s.spend }))}
              cx="50%" cy="50%" outerRadius={100} dataKey="value"
              label={({ name, pct }: any) => `${name} ${(pct * 100).toFixed(0)}%`}
              labelLine={false}
            >
              {top.slice(0, 6).map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
            </Pie>
            <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [fmtUSD(v), 'Annual Spend']} />
          </PieChart>
        </ResponsiveContainer>

        <div className="overflow-y-auto max-h-[280px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card"><tr className="border-b">
              <th className="text-left px-2 py-2 text-xs font-medium text-muted-foreground">Supplier</th>
              <th className="text-right px-2 py-2 text-xs font-medium text-muted-foreground">Spend</th>
              <th className="text-right px-2 py-2 text-xs font-medium text-muted-foreground">Share</th>
              <th className="px-2 py-2 text-xs font-medium text-muted-foreground">Status</th>
            </tr></thead>
            <tbody>
              {suppliers.map((s, i) => (
                <tr key={s.name} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-2 py-1.5 font-medium text-xs max-w-[120px] truncate">
                    <span className="inline-block h-2 w-2 rounded-full mr-1.5" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    {s.name}
                  </td>
                  <td className="px-2 py-1.5 text-right text-xs font-semibold">{fmtUSD(s.spend)}</td>
                  <td className="px-2 py-1.5 text-right text-xs text-muted-foreground">{s.pct.toFixed(1)}%</td>
                  <td className="px-2 py-1.5">
                    {s.spend < tailThreshold
                      ? <Badge variant="outline" className="text-[9px] bg-amber-500/10 text-amber-400 border-amber-500/30">Tail</Badge>
                      : i < 3 ? <Badge variant="outline" className="text-[9px] bg-primary/10 text-primary border-primary/30">Top</Badge>
                      : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {tail.length > 0 && (
        <Card className="bg-amber-500/10 border-amber-500/30">
          <CardContent className="pt-3 pb-3">
            <p className="text-xs font-semibold text-amber-400 mb-1">Consolidation Opportunity</p>
            <p className="text-xs text-amber-300/80">
              {tail.length} tail-spend supplier{tail.length !== 1 ? 's' : ''} ({tail.map((s) => s.name).join(', ')}) account for
              &lt;3% of spend each — consider consolidating to reduce supplier management overhead.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AffinityView({ result }: { result: CostAnalysisResult | null }) {
  if (!result) return <AIEmptyState />;
  return (
    <div className="space-y-4">
      {(result.focusAreas?.length ?? 0) > 0 && (
        <Card className="bg-amber-500/10 border-amber-500/30">
          <CardContent className="pt-3 pb-3">
            <p className="text-xs font-semibold text-amber-400 mb-2">AI-Identified Focus Areas</p>
            <ul className="space-y-1">
              {result.focusAreas.map((area, i) => (
                <li key={i} className="text-xs text-amber-300/80 flex gap-2">
                  <span className="text-amber-500 shrink-0">→</span>{area}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {result.affinityGroups.map((group, i) => (
          <Card key={i} className="border-l-4 border-l-primary/60">
            <CardContent className="pt-3 pb-3">
              <div className="flex items-start justify-between mb-2">
                <p className="font-medium text-sm">{group.name}</p>
                <span className="text-xs font-semibold text-primary">{fmtUSD(group.totalCost)}</span>
              </div>
              <p className="text-xs text-muted-foreground mb-2">{group.description}</p>
              <div className="flex flex-wrap gap-1">
                {group.parts.slice(0, 5).map((pn: string) => (
                  <Badge key={pn} variant="secondary" className="text-[9px] font-mono">{pn}</Badge>
                ))}
                {group.parts.length > 5 && <Badge variant="outline" className="text-[9px]">+{group.parts.length - 5}</Badge>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function QFDView({ result }: { result: CostAnalysisResult | null }) {
  if (!result?.qfdMatrix) return <AIEmptyState />;
  const { customerNeeds, functions, relationships } = result.qfdMatrix;

  const getWeight = (need: string, fn: string) =>
    relationships.find((r) => r.need === need && r.function === fn)?.weight ?? 'None';

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Relationship strength between customer requirements and part functional groups.
        <span className="ml-2 text-primary font-medium">●●●</span> Strong &nbsp;
        <span className="text-amber-400 font-medium">●●○</span> Medium &nbsp;
        <span className="text-muted-foreground font-medium">●○○</span> Weak
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="text-left px-3 py-2.5 bg-muted/40 border border-border font-medium text-muted-foreground min-w-[160px]">
                Customer Need ↓ / Function →
              </th>
              {functions.map((fn) => (
                <th key={fn} className="px-3 py-2.5 bg-muted/40 border border-border font-medium text-center min-w-[100px]">
                  {fn}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {customerNeeds.map((need) => (
              <tr key={need} className="hover:bg-muted/10">
                <td className="px-3 py-2.5 border border-border font-medium">{need}</td>
                {functions.map((fn) => {
                  const w = getWeight(need, fn);
                  const cfg = QFD_WEIGHT[w] ?? QFD_WEIGHT['None']!;
                  return (
                    <td key={fn} className={`px-3 py-2.5 border border-border text-center ${cfg?.bg ?? ''}`}>
                      <span className={`font-bold ${cfg?.text ?? ''}`}>{cfg?.label ?? '—'}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
      <div className="h-8 w-8 opacity-30 text-3xl">📊</div>
      <p className="text-sm">{message}</p>
    </div>
  );
}

function AIEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
      <Sparkles className="h-8 w-8 opacity-30" />
      <p className="text-sm">Click <strong className="text-foreground">Run AI Analysis</strong> to generate insights</p>
    </div>
  );
}

function Pill({ color, label }: { color: 'red' | 'amber' | 'muted'; label: string }) {
  const cls = color === 'red' ? 'bg-red-500/10 border-red-500/25 text-red-400'
    : color === 'amber' ? 'bg-amber-500/10 border-amber-500/25 text-amber-400'
    : 'bg-muted/50 border-border text-muted-foreground';
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium ${cls}`}>
      {color === 'red' && <span className="h-2 w-2 rounded-full bg-red-500" />}
      {label}
    </div>
  );
}

function Legend3() {
  return (
    <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-red-500" />Top cost drivers</span>
      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-muted-foreground/40" />Remaining</span>
      <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-primary" />Cumulative %</span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function CostAnalysis({ projectId }: Props) {
  const [activeView, setActiveView] = useState<AnalysisView>('pareto');
  const [aiResult, setAiResult] = useState<CostAnalysisResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [calculatingAll, setCalculatingAll] = useState(false);
  const [calculatingId, setCalculatingId] = useState<string | null>(null);

  const { data: bomItems } = useVaveBom(projectId);
  const { data: shouldCosts } = useVaveShouldCosts(projectId);
  const upsertShouldCost = useUpsertShouldCost(projectId);

  const items = (bomItems as VaveBomItem[]) ?? [];
  const costs = (shouldCosts as any[]) ?? [];
  const shouldCostMap = new Map(costs.map((c) => [c.partNumber, c]));

  const currentOption = ANALYSIS_OPTIONS.find((o) => o.value === activeView)!;

  const handleRunAI = async () => {
    if (!items.length) { toast.error('Add BOM items first'); return; }
    setAiLoading(true);
    try {
      const res = await fetch('/api/vave/cost-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bomItems: items }),
      });
      if (!res.ok) throw new Error();
      const result: CostAnalysisResult = await res.json();
      setAiResult(result);
      toast.success('AI analysis complete');
    } catch {
      toast.error('AI analysis failed — check API configuration');
    } finally {
      setAiLoading(false);
    }
  };

  const calculateShouldCost = async (item: VaveBomItem) => {
    setCalculatingId(item.id);
    try {
      const res = await fetch('/api/vave/should-cost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ part: item }),
      });
      if (!res.ok) throw new Error();
      const result: ShouldCostResult = await res.json();
      await upsertShouldCost.mutateAsync({
        partNumber: item.partNumber,
        description: item.description ?? undefined,
        actualCost: item.unitCost,
        shouldCost: result.shouldCost,
        deltaPct: result.deltaPct,
        materialCost: result.materialCost,
        processCost: result.processCost,
        overhead: result.overhead,
        margin: result.margin,
        benchmarkSource: result.benchmarkSource,
      });
    } catch {
      toast.error(`Failed for ${item.partNumber}`);
    } finally {
      setCalculatingId(null);
    }
  };

  const handleCalculateAll = async () => {
    if (!items.length) return;
    setCalculatingAll(true);
    for (const item of items) await calculateShouldCost(item);
    setCalculatingAll(false);
    toast.success('Should cost calculated for all parts');
  };

  return (
    <div className="space-y-6">

      {/* ── Analysis selector + action button ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2 min-w-[230px] justify-between">
                    <span className="font-medium">{currentOption.label}</span>
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  {ANALYSIS_OPTIONS.map((opt) => (
                    <DropdownMenuItem
                      key={opt.value}
                      onClick={() => setActiveView(opt.value)}
                      className="flex flex-col items-start gap-0.5 py-2.5"
                    >
                      <div className="flex items-center gap-2 w-full">
                        <span className="font-medium text-sm">{opt.label}</span>
                        {opt.ai && (
                          <Badge variant="secondary" className="text-[9px] ml-auto">AI</Badge>
                        )}
                        {activeView === opt.value && (
                          <span className="h-1.5 w-1.5 rounded-full bg-primary ml-auto" />
                        )}
                      </div>
                      <span className="text-[11px] text-muted-foreground">{opt.description}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <CardDescription className="text-xs hidden sm:block">{currentOption.description}</CardDescription>
            </div>

            {currentOption.ai ? (
              <Button size="sm" onClick={handleRunAI} disabled={aiLoading || !items.length}>
                {aiLoading
                  ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Analyzing…</>
                  : <><Sparkles className="h-3.5 w-3.5 mr-1.5" />{aiResult ? 'Re-run AI' : 'Run AI Analysis'}</>}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {activeView === 'pareto'    && <ParetoView items={items} />}
          {activeView === 'waterfall' && <WaterfallView items={items} />}
          {activeView === 'supplier'  && <SupplierView items={items} />}
          {activeView === 'affinity'  && <AffinityView result={aiResult} />}
          {activeView === 'qfd'       && <QFDView result={aiResult} />}
        </CardContent>
      </Card>

      {/* ── Should Cost Gap — always visible ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Should Cost Gap Analysis</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Bottom-up should cost vs. actual cost · Δ flags negotiation opportunities
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={handleCalculateAll} disabled={calculatingAll || !items.length}>
              {calculatingAll
                ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Calculating…</>
                : <><Calculator className="h-3.5 w-3.5 mr-1.5" />Calculate All</>}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!items.length ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Add BOM items to calculate should costs</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Part No.</th>
                    <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Description</th>
                    <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">Actual</th>
                    <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">Should Cost</th>
                    <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">Breakdown</th>
                    <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">Δ</th>
                    <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">Δ%</th>
                    <th className="px-3 py-2.5 w-20" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const cost = shouldCostMap.get(item.partNumber);
                    return (
                      <tr key={item.id} className="border-b last:border-0 hover:bg-muted/20">
                        <td className="px-3 py-2 font-mono text-xs font-medium">{item.partNumber}</td>
                        <td className="px-3 py-2 text-muted-foreground text-xs max-w-[140px] truncate">{item.description ?? '—'}</td>
                        <td className="px-3 py-2 text-right">${item.unitCost.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-semibold">
                          {cost ? <span className="text-primary">${cost.shouldCost.toFixed(2)}</span> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {cost ? (
                            <div className="text-[10px] text-muted-foreground leading-relaxed text-right">
                              <div>Mat: ${(cost.materialCost ?? 0).toFixed(2)}</div>
                              <div>Proc: ${(cost.processCost ?? 0).toFixed(2)}</div>
                              <div>OH+Mgn: ${((cost.overhead ?? 0) + (cost.margin ?? 0)).toFixed(2)}</div>
                            </div>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {cost ? (
                            <span className={cost.delta > 0 ? 'text-red-400' : 'text-emerald-400'}>
                              {cost.delta > 0 ? '+' : ''}${cost.delta.toFixed(2)}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {cost?.deltaPct != null ? (
                            <Badge variant="outline" className={`text-xs ${cost.deltaPct > 0
                              ? 'bg-red-500/10 text-red-400 border-red-500/30'
                              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'}`}>
                              {cost.deltaPct > 0 ? '+' : ''}{cost.deltaPct.toFixed(1)}%
                            </Badge>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          <Button variant="ghost" size="sm" className="h-7 text-xs"
                            disabled={calculatingId === item.id} onClick={() => calculateShouldCost(item)}>
                            {calculatingId === item.id
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : cost ? <RefreshCw className="h-3 w-3" /> : 'Calc'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
