'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Upload, Trash2, Microscope, Search, ChevronDown, Filter, Sparkles, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useVaveBom, useBulkImportVaveBom, useDeleteVaveBomItem } from '@/lib/api/hooks/useVave';
import { useProjects, useBOMs, useBOMItems } from '@/lib/api/hooks';
import { useProcesses } from '@/lib/api/hooks/useProcesses';
import type { Process } from '@/lib/api/hooks/useProcesses';
import type { VaveBomItem, DrawingAnalysisResult } from '@/lib/api/vave';
import { toast } from 'sonner';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface Props {
  projectId: string;
  sourceProjectId?: string | null;
}

type BomView = 'flat' | 'hierarchy' | 'spend';

const VIEW_OPTIONS: { value: BomView; label: string }[] = [
  { value: 'flat',      label: 'Flat Table'     },
  { value: 'hierarchy', label: 'Hierarchy Tree'  },
  { value: 'spend',     label: 'Spend Analysis'  },
];

function formatUSD(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function fmtShort(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

/** Dark-theme Pareto band colors */
function getSpendColor(spend: number, items: VaveBomItem[]) {
  if (!items.length) return '';
  const sorted = [...items].sort((a, b) => b.annualSpend - a.annualSpend);
  const total = sorted.reduce((s, i) => s + i.annualSpend, 0);
  let cum = 0;
  for (const item of sorted) {
    cum += item.annualSpend;
    if (item.annualSpend === spend) {
      const pct = (cum / total) * 100;
      if (pct <= 50) return 'bg-red-500/10 text-red-400 border-red-500/30';
      if (pct <= 80) return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
      return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    }
  }
  return '';
}

// ── Drawing analysis popover ──────────────────────────────────────────────────

interface AnalysisPopoverProps {
  item: VaveBomItem;
  analysis: DrawingAnalysisResult | null;
  analyzingId: string | null;
  onAnalyze: (item: VaveBomItem) => void;
}

function AnalysisPopover({ item, analysis, analyzingId, onAnalyze }: AnalysisPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => !analysis && onAnalyze(item)}
        >
          {analyzingId === item.id ? (
            <span className="animate-spin text-xs">⟳</span>
          ) : (
            <Microscope className="h-3.5 w-3.5" />
          )}
        </Button>
      </PopoverTrigger>
      {analysis && (
        <PopoverContent className="w-72 text-xs">
          <p className="font-semibold mb-2">Drawing Analysis</p>
          <div className="space-y-1">
            <p><span className="text-muted-foreground">Material:</span> {analysis.material}</p>
            <p><span className="text-muted-foreground">Process:</span> {analysis.process}</p>
            <p><span className="text-muted-foreground">Complexity:</span> {analysis.complexity}</p>
            <p><span className="text-muted-foreground">Tightest tolerance:</span> ±{analysis.tightest_tolerance_mm}mm</p>
            <p><span className="text-muted-foreground">Surface finish:</span> Ra {analysis.surface_finish_ra}µm</p>
            {analysis.heat_treatment && analysis.heat_treatment !== 'None' && (
              <p><span className="text-muted-foreground">Heat treatment:</span> {analysis.heat_treatment}</p>
            )}
            {analysis.coating && analysis.coating !== 'None' && (
              <p><span className="text-muted-foreground">Coating:</span> {analysis.coating}</p>
            )}
          </div>
        </PopoverContent>
      )}
    </Popover>
  );
}

// ── Flat table row ────────────────────────────────────────────────────────────

interface FlatRowProps {
  item: VaveBomItem;
  items: VaveBomItem[];
  allProcesses: Process[];
  analysis: DrawingAnalysisResult | null;
  analyzingId: string | null;
  onAnalyze: (item: VaveBomItem) => void;
  onDelete: (id: string) => void;
  indentPx?: number;
}

function ProcessCell({ processValue, allProcesses }: { processValue: string | null | undefined; allProcesses: Process[] }) {
  if (!processValue) return <span className="text-muted-foreground">—</span>;
  const matched = allProcesses.find(
    (p) => p.processName.toLowerCase() === processValue.toLowerCase()
  );
  return (
    <div className="flex flex-col gap-0.5">
      <Badge
        variant="outline"
        className={`text-[10px] w-fit ${matched
          ? 'bg-primary/10 border-primary/30 text-primary'
          : 'bg-muted/40 border-border text-muted-foreground'
        }`}
      >
        {processValue}
      </Badge>
      {matched?.processCategory && (
        <span className="text-[9px] text-muted-foreground/70">{matched.processCategory}</span>
      )}
    </div>
  );
}

function BomTableRow({ item, items, allProcesses, analysis, analyzingId, onAnalyze, onDelete, indentPx = 0 }: FlatRowProps) {
  return (
    <tr className="border-b last:border-0 hover:bg-muted/20">
      <td className="px-3 py-2 text-muted-foreground">{item.level}</td>
      <td className="px-3 py-2 font-mono text-xs font-medium" style={{ paddingLeft: `${12 + indentPx}px` }}>
        {item.partNumber}
      </td>
      <td className="px-3 py-2 max-w-[200px] truncate text-muted-foreground">{item.description}</td>
      <td className="px-3 py-2 text-right">{formatUSD(item.unitCost)}</td>
      <td className="px-3 py-2 text-right text-muted-foreground">{item.annualVolume.toLocaleString()}</td>
      <td className="px-3 py-2 text-right">
        <Badge variant="outline" className={`text-xs ${getSpendColor(item.annualSpend, items)}`}>
          {formatUSD(item.annualSpend)}
        </Badge>
      </td>
      <td className="px-3 py-2 text-muted-foreground text-xs">{item.material ?? '—'}</td>
      <td className="px-3 py-2 text-xs"><ProcessCell processValue={item.process} allProcesses={allProcesses} /></td>
      <td className="px-3 py-2 text-muted-foreground text-xs truncate max-w-[120px]">{item.supplierName ?? '—'}</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1 justify-end">
          {item.drawingUrl && (
            <AnalysisPopover
              item={item}
              analysis={analysis}
              analyzingId={analyzingId}
              onAnalyze={onAnalyze}
            />
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive/70 hover:text-destructive"
            onClick={() => onDelete(item.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ── Table header ──────────────────────────────────────────────────────────────

function BomTableHead() {
  return (
    <thead>
      <tr className="border-b bg-muted/40">
        <th className="text-left px-3 py-2.5 font-medium text-xs text-muted-foreground w-8">Lvl</th>
        <th className="text-left px-3 py-2.5 font-medium text-xs text-muted-foreground">Part No.</th>
        <th className="text-left px-3 py-2.5 font-medium text-xs text-muted-foreground">Description</th>
        <th className="text-right px-3 py-2.5 font-medium text-xs text-muted-foreground">Unit Cost</th>
        <th className="text-right px-3 py-2.5 font-medium text-xs text-muted-foreground">Ann. Volume</th>
        <th className="text-right px-3 py-2.5 font-medium text-xs text-muted-foreground">Ann. Spend</th>
        <th className="text-left px-3 py-2.5 font-medium text-xs text-muted-foreground">Material</th>
        <th className="text-left px-3 py-2.5 font-medium text-xs text-muted-foreground">Process</th>
        <th className="text-left px-3 py-2.5 font-medium text-xs text-muted-foreground">Supplier</th>
        <th className="px-3 py-2.5 w-20" />
      </tr>
    </thead>
  );
}

// ── Hierarchy tree view ───────────────────────────────────────────────────────

interface HierarchyViewProps {
  items: VaveBomItem[];
  allProcesses: Process[];
  analysisResults: Record<string, DrawingAnalysisResult>;
  analyzingId: string | null;
  onAnalyze: (item: VaveBomItem) => void;
  onDelete: (id: string) => void;
}

function HierarchyView({ items, allProcesses, analysisResults, analyzingId, onAnalyze, onDelete }: HierarchyViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>();
    items.forEach((i) => { if (i.level === 1 || i.level === 2) s.add(i.partNumber); });
    return s;
  });

  // Build tree: roots are level === 1, children matched by parentPn
  const roots = useMemo(() => items.filter((i) => i.level === 1), [items]);
  const childrenOf = useMemo(() => {
    const map = new Map<string, VaveBomItem[]>();
    items.forEach((item) => {
      if (item.parentPn) {
        const existing = map.get(item.parentPn) ?? [];
        existing.push(item);
        map.set(item.parentPn, existing);
      }
    });
    return map;
  }, [items]);

  const toggleExpand = (pn: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(pn)) next.delete(pn);
      else next.add(pn);
      return next;
    });
  };

  // Recursively render item rows
  const renderRows = (item: VaveBomItem, depth: number): React.ReactNode => {
    const children = childrenOf.get(item.partNumber) ?? [];
    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(item.partNumber);
    const analysis = analysisResults[item.id] ?? item.drawingAnalysis;
    const indentPx = depth * 16;

    return (
      <React.Fragment key={item.id}>
        <tr className="border-b last:border-0 hover:bg-muted/20">
          <td className="px-3 py-2 text-muted-foreground">{item.level}</td>
          <td className="px-3 py-2 font-mono text-xs font-medium" style={{ paddingLeft: `${12 + indentPx}px` }}>
            <div className="flex items-center gap-1">
              {hasChildren ? (
                <button
                  onClick={() => toggleExpand(item.partNumber)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {isExpanded
                    ? <ChevronDown className="h-3 w-3" />
                    : <ChevronRight className="h-3 w-3" />
                  }
                </button>
              ) : (
                <span className="w-3" />
              )}
              {item.partNumber}
            </div>
          </td>
          <td className="px-3 py-2 max-w-[200px] truncate text-muted-foreground">{item.description}</td>
          <td className="px-3 py-2 text-right">{formatUSD(item.unitCost)}</td>
          <td className="px-3 py-2 text-right text-muted-foreground">{item.annualVolume.toLocaleString()}</td>
          <td className="px-3 py-2 text-right">
            <Badge variant="outline" className={`text-xs ${getSpendColor(item.annualSpend, items)}`}>
              {formatUSD(item.annualSpend)}
            </Badge>
          </td>
          <td className="px-3 py-2 text-muted-foreground text-xs">{item.material ?? '—'}</td>
          <td className="px-3 py-2 text-xs"><ProcessCell processValue={item.process} allProcesses={allProcesses} /></td>
          <td className="px-3 py-2 text-muted-foreground text-xs truncate max-w-[120px]">{item.supplierName ?? '—'}</td>
          <td className="px-3 py-2">
            <div className="flex items-center gap-1 justify-end">
              {item.drawingUrl && (
                <AnalysisPopover
                  item={item}
                  analysis={analysis}
                  analyzingId={analyzingId}
                  onAnalyze={onAnalyze}
                />
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive/70 hover:text-destructive"
                onClick={() => onDelete(item.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </td>
        </tr>
        {hasChildren && isExpanded && children.map((child) => renderRows(child, depth + 1))}
      </React.Fragment>
    );
  };

  // Items without parentPn and level > 1 are rendered as children of roots
  // Items that have no matching parent are rendered as orphan roots
  const orphans = useMemo(
    () => items.filter((i) => i.level !== 1 && !i.parentPn),
    [items]
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <BomTableHead />
        <tbody>
          {roots.map((root) => renderRows(root, 0))}
          {orphans.map((item) => {
            const analysis = analysisResults[item.id] ?? item.drawingAnalysis;
            return (
              <BomTableRow
                key={item.id}
                item={item}
                items={items}
                allProcesses={allProcesses}
                analysis={analysis}
                analyzingId={analyzingId}
                onAnalyze={onAnalyze}
                onDelete={onDelete}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Spend Analysis view ───────────────────────────────────────────────────────

const CHART_COLORS = [
  'hsl(187 100% 42%)',
  'hsl(187 100% 55%)',
  'hsl(187 80% 35%)',
  'hsl(160 60% 45%)',
  'hsl(215 80% 55%)',
  'hsl(250 70% 60%)',
  'hsl(30 90% 55%)',
  'hsl(350 70% 55%)',
];

interface SpendAnalysisViewProps {
  items: VaveBomItem[];
}

function SpendAnalysisView({ items }: SpendAnalysisViewProps) {
  const total = items.reduce((s, i) => s + i.annualSpend, 0);
  const avgUnitCost = items.length ? items.reduce((s, i) => s + i.unitCost, 0) / items.length : 0;

  // Top 5 by spend
  const top5 = useMemo(
    () => [...items].sort((a, b) => b.annualSpend - a.annualSpend).slice(0, 5),
    [items]
  );

  // Top supplier
  const supplierMap = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((i) => {
      const k = i.supplierName ?? 'Unknown';
      map.set(k, (map.get(k) ?? 0) + i.annualSpend);
    });
    return map;
  }, [items]);

  const topSupplierSpend = Math.max(0, ...supplierMap.values());

  // Material group bar data
  const materialData = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((i) => {
      const k = i.material ?? 'Unknown';
      map.set(k, (map.get(k) ?? 0) + i.annualSpend);
    });
    return [...map.entries()]
      .map(([name, spend]) => ({ name, spend }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 8);
  }, [items]);

  // Supplier bar data
  const supplierData = useMemo(
    () =>
      [...supplierMap.entries()]
        .map(([name, spend]) => ({ name, spend }))
        .sort((a, b) => b.spend - a.spend)
        .slice(0, 8),
    [supplierMap]
  );

  const statCards = [
    {
      label: 'Total Annual Spend',
      value: formatUSD(total),
      accent: 'text-primary',
      bg: 'bg-primary/10',
      border: 'border-primary/20',
    },
    {
      label: 'Parts Count',
      value: items.length.toLocaleString(),
      accent: 'text-blue-400',
      bg: 'bg-blue-500/10',
      border: 'border-blue-500/20',
    },
    {
      label: 'Top Supplier Spend',
      value: formatUSD(topSupplierSpend),
      accent: 'text-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20',
    },
    {
      label: 'Avg Unit Cost',
      value: formatUSD(avgUnitCost),
      accent: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/20',
    },
  ];

  return (
    <div className="space-y-6 p-1">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map((card) => (
          <div
            key={card.label}
            className={`rounded-lg border p-4 ${card.bg} ${card.border}`}
          >
            <p className="text-xs text-muted-foreground mb-1">{card.label}</p>
            <p className={`text-xl font-bold ${card.accent}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Top 5 parts table */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Top 5 Parts by Spend
        </p>
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">#</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Part No.</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Description</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Spend</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {top5.map((item, idx) => (
                  <tr key={item.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-3 py-2 text-muted-foreground text-xs">{idx + 1}</td>
                    <td className="px-3 py-2 font-mono text-xs font-medium">{item.partNumber}</td>
                    <td className="px-3 py-2 text-muted-foreground text-xs truncate max-w-[200px]">
                      {item.description ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-primary">
                      {formatUSD(item.annualSpend)}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground text-xs">
                      {total > 0 ? ((item.annualSpend / total) * 100).toFixed(1) : '0.0'}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Spend by material */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Spend by Material Group
          </p>
          <Card>
            <CardContent className="pt-4 pb-2 px-2">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={materialData} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                  <XAxis
                    type="number"
                    tickFormatter={(v: number) => fmtShort(v)}
                    tick={{ fontSize: 10, fill: 'hsl(220 15% 55%)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={80}
                    tick={{ fontSize: 10, fill: 'hsl(220 15% 55%)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <RechartsTooltip
                    formatter={(v: number) => [formatUSD(v), 'Spend']}
                    contentStyle={{
                      background: 'hsl(220 18% 10%)',
                      border: '1px solid hsl(220 15% 18%)',
                      borderRadius: '6px',
                      fontSize: 11,
                    }}
                    labelStyle={{ color: 'hsl(220 15% 70%)' }}
                    itemStyle={{ color: 'hsl(187 100% 42%)' }}
                  />
                  <Bar dataKey="spend" radius={[0, 3, 3, 0]}>
                    {materialData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Spend by supplier */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Spend by Supplier
          </p>
          <Card>
            <CardContent className="pt-4 pb-2 px-2">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={supplierData} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                  <XAxis
                    type="number"
                    tickFormatter={(v: number) => fmtShort(v)}
                    tick={{ fontSize: 10, fill: 'hsl(220 15% 55%)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={80}
                    tick={{ fontSize: 10, fill: 'hsl(220 15% 55%)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <RechartsTooltip
                    formatter={(v: number) => [formatUSD(v), 'Spend']}
                    contentStyle={{
                      background: 'hsl(220 18% 10%)',
                      border: '1px solid hsl(220 15% 18%)',
                      borderRadius: '6px',
                      fontSize: 11,
                    }}
                    labelStyle={{ color: 'hsl(220 15% 70%)' }}
                    itemStyle={{ color: 'hsl(187 100% 42%)' }}
                  />
                  <Bar dataKey="spend" radius={[0, 3, 3, 0]}>
                    {supplierData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[(i + 2) % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function BOMExplorer({ projectId, sourceProjectId }: Props) {
  const [view, setView] = useState<BomView>('flat');
  const [importOpen, setImportOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState(sourceProjectId ?? '');
  const [selectedBomId, setSelectedBomId] = useState('');
  const [search, setSearch] = useState('');
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [analysisResults, setAnalysisResults] = useState<Record<string, DrawingAnalysisResult>>({});
  const [enrichProgress, setEnrichProgress] = useState<{ done: number; total: number } | null>(null);

  // Filter state
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [filterSupplier, setFilterSupplier] = useState<string>('all');
  const [filterSpend, setFilterSpend] = useState<string>('all');
  const [filterProcess, setFilterProcess] = useState<string>('all');

  const { data: bomItems, isLoading } = useVaveBom(projectId);
  const { data: processesData } = useProcesses({ limit: 100 });
  const allProcesses: Process[] = (processesData as any)?.processes ?? [];
  const bulkImport = useBulkImportVaveBom(projectId);
  const deleteItem = useDeleteVaveBomItem(projectId);

  const { data: projectsData } = useProjects();
  const projects = (projectsData as any)?.projects ?? [];

  const { data: bomsData } = useBOMs(selectedProjectId ? { projectId: selectedProjectId } : undefined);
  const boms = (bomsData as any)?.boms ?? [];

  // Auto-open import dialog when VAVE BOM is empty and we have a source project
  useEffect(() => {
    if (!isLoading && (bomItems as VaveBomItem[] | undefined)?.length === 0 && sourceProjectId) {
      setImportOpen(true);
    }
  }, [isLoading, bomItems, sourceProjectId]);

  // Auto-select the first BOM once boms load in the dialog
  useEffect(() => {
    if (boms.length === 1 && !selectedBomId) {
      setSelectedBomId(boms[0].id);
    }
  }, [boms, selectedBomId]);

  const { data: bomItemsData } = useBOMItems(selectedBomId || undefined);
  const sourceBomItems = (bomItemsData as any)?.items ?? [];

  const items = (bomItems as VaveBomItem[]) ?? [];

  // Unique suppliers for filter dropdown
  const uniqueSuppliers = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => { if (i.supplierName) set.add(i.supplierName); });
    return [...set].sort();
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (search && !item.partNumber.toLowerCase().includes(search.toLowerCase()) &&
          !(item.description ?? '').toLowerCase().includes(search.toLowerCase())) return false;
      if (filterLevel !== 'all') {
        if (filterLevel === 'L1' && item.level !== 1) return false;
        if (filterLevel === 'L2' && item.level !== 2) return false;
        if (filterLevel === 'L3+' && item.level < 3) return false;
      }
      if (filterSupplier !== 'all' && item.supplierName !== filterSupplier) return false;
      if (filterSpend !== 'all') {
        const threshold = filterSpend === '>$10K' ? 10_000 : filterSpend === '>$50K' ? 50_000 : 100_000;
        if (item.annualSpend <= threshold) return false;
      }
      if (filterProcess !== 'all') {
        const itemProc = (item.process ?? '').toLowerCase();
        const match = filterProcess.toLowerCase();
        if (!itemProc.includes(match)) return false;
      }
      return true;
    });
  }, [items, search, filterLevel, filterSupplier, filterSpend, filterProcess]);

  const currentView = VIEW_OPTIONS.find((o) => o.value === view) ?? { value: 'flat' as BomView, label: 'Flat Table' };

  const activeFilterCount =
    (filterLevel !== 'all' ? 1 : 0) +
    (filterSupplier !== 'all' ? 1 : 0) +
    (filterSpend !== 'all' ? 1 : 0) +
    (filterProcess !== 'all' ? 1 : 0);

  const handleImport = async () => {
    if (!sourceBomItems.length) {
      toast.error('No BOM items found in selected BOM');
      return;
    }
    const mapped = sourceBomItems.map((i: any) => ({
      partNumber: i.partNumber ?? i.part_number ?? i.id,
      description: i.name ?? i.description ?? null,
      level: Number(i.bomLevel ?? i.level ?? 1),
      quantity: i.quantity ?? 1,
      unitCost: i.unitCost ?? i.unit_cost ?? 0,
      annualVolume: i.annualVolume ?? i.annual_volume ?? 0,
      material: i.material ?? null,
      process: i.process ?? i.makeBuy ?? null,
      supplierName: i.supplierName ?? i.supplier_name ?? null,
      drawingUrl: i.file2dPath ?? i.drawing_url ?? null,
      modelUrl: i.file3dPath ?? i.model_url ?? null,
    }));
    await bulkImport.mutateAsync(mapped);
    setImportOpen(false);
    setSelectedProjectId(sourceProjectId ?? '');
    setSelectedBomId('');
  };

  const handleAnalyzeDrawing = async (item: VaveBomItem) => {
    if (!item.drawingUrl) return;
    setAnalyzingId(item.id);
    try {
      const res = await fetch('/api/vave/drawing-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: item.drawingUrl, partNumber: item.partNumber }),
      });
      if (!res.ok) throw new Error('Analysis failed');
      const result: DrawingAnalysisResult = await res.json();
      setAnalysisResults((prev) => ({ ...prev, [item.id]: result }));
      toast.success('Drawing analyzed');
    } catch {
      toast.error('Drawing analysis failed');
    } finally {
      setAnalyzingId(null);
    }
  };

  const handleEnrichAll = async () => {
    const enrichable = items.filter((i) => i.drawingUrl && !analysisResults[i.id] && !i.drawingAnalysis);
    if (!enrichable.length) {
      toast.info('All drawings already analyzed');
      return;
    }
    setEnrichProgress({ done: 0, total: enrichable.length });
    let done = 0;
    for (const item of enrichable) {
      try {
        const res = await fetch('/api/vave/drawing-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: item.drawingUrl, partNumber: item.partNumber }),
        });
        if (res.ok) {
          const result: DrawingAnalysisResult = await res.json();
          setAnalysisResults((prev) => ({ ...prev, [item.id]: result }));
        }
      } catch {
        // continue on individual failures
      }
      done++;
      setEnrichProgress({ done, total: enrichable.length });
    }
    setEnrichProgress(null);
    toast.success(`Enriched ${done} drawings`);
  };

  const handleDeleteItem = (id: string) => {
    deleteItem.mutateAsync(id);
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-sm"
            placeholder="Search parts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* View selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 min-w-[160px] justify-between">
              <span>{currentView.label}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {VIEW_OPTIONS.map((opt) => (
              <DropdownMenuItem
                key={opt.value}
                onClick={() => setView(opt.value)}
                className={view === opt.value ? 'bg-muted/60' : ''}
              >
                {opt.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Filter toggle */}
        <Button
          variant="outline"
          size="sm"
          className={`gap-1.5 ${filterOpen || activeFilterCount > 0 ? 'border-primary/50 text-primary' : ''}`}
          onClick={() => setFilterOpen((o) => !o)}
        >
          <Filter className="h-3.5 w-3.5" />
          Filters
          {activeFilterCount > 0 && (
            <Badge className="ml-0.5 h-4 px-1 text-[9px] bg-primary text-primary-foreground">
              {activeFilterCount}
            </Badge>
          )}
        </Button>

        {/* Enrich with AI */}
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={handleEnrichAll}
          disabled={!!enrichProgress}
        >
          {enrichProgress ? (
            <>
              <span className="animate-spin text-xs">⟳</span>
              Analyzing {enrichProgress.done}/{enrichProgress.total}…
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" />
              Enrich with AI
            </>
          )}
        </Button>

        <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
          <Upload className="h-3.5 w-3.5 mr-1.5" />
          Import from Mithran BOM
        </Button>
      </div>

      {/* Filter panel */}
      {filterOpen && (
        <div className="flex items-center gap-3 flex-wrap px-4 py-3 rounded-lg border bg-muted/20">
          {/* Level badges */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground mr-1">Level:</span>
            {(['all', 'L1', 'L2', 'L3+'] as const).map((lvl) => (
              <button
                key={lvl}
                onClick={() => setFilterLevel(lvl)}
                className={`px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors ${
                  filterLevel === lvl
                    ? 'bg-primary/20 border-primary/50 text-primary'
                    : 'bg-transparent border-border text-muted-foreground hover:border-primary/30'
                }`}
              >
                {lvl === 'all' ? 'All' : lvl}
              </button>
            ))}
          </div>

          {/* Supplier filter */}
          <Select value={filterSupplier} onValueChange={setFilterSupplier}>
            <SelectTrigger className="h-7 w-44 text-xs">
              <SelectValue placeholder="Supplier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All suppliers</SelectItem>
              {uniqueSuppliers.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Spend threshold */}
          <Select value={filterSpend} onValueChange={setFilterSpend}>
            <SelectTrigger className="h-7 w-36 text-xs">
              <SelectValue placeholder="Spend" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All spend</SelectItem>
              <SelectItem value=">$10K">&gt;$10K</SelectItem>
              <SelectItem value=">$50K">&gt;$50K</SelectItem>
              <SelectItem value=">$100K">&gt;$100K</SelectItem>
            </SelectContent>
          </Select>

          {/* Process filter — populated from the Processes API */}
          <Select value={filterProcess} onValueChange={setFilterProcess}>
            <SelectTrigger className="h-7 w-48 text-xs">
              <SelectValue placeholder="Process" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All processes</SelectItem>
              <SelectItem value="make">Make</SelectItem>
              <SelectItem value="buy">Buy</SelectItem>
              {allProcesses.map((p) => (
                <SelectItem key={p.id} value={p.processName}>
                  {p.processName}
                  {p.processCategory ? ` · ${p.processCategory}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {activeFilterCount > 0 && (
            <button
              onClick={() => { setFilterLevel('all'); setFilterSupplier('all'); setFilterSpend('all'); setFilterProcess('all'); }}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {/* Content area */}
      {view === 'spend' ? (
        <div>
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <p className="text-sm">No BOM items yet. Import from a Mithran BOM to get started.</p>
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                Import BOM
              </Button>
            </div>
          ) : (
            <SpendAnalysisView items={filtered} />
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                <p className="text-sm">No BOM items yet. Import from a Mithran BOM to get started.</p>
                <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  Import BOM
                </Button>
              </div>
            ) : view === 'hierarchy' ? (
              <HierarchyView
                items={filtered}
                allProcesses={allProcesses}
                analysisResults={analysisResults}
                analyzingId={analyzingId}
                onAnalyze={handleAnalyzeDrawing}
                onDelete={handleDeleteItem}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <BomTableHead />
                  <tbody>
                    {filtered.map((item) => {
                      const analysis = analysisResults[item.id] ?? item.drawingAnalysis;
                      return (
                        <BomTableRow
                          key={item.id}
                          item={item}
                          items={items}
                          allProcesses={allProcesses}
                          analysis={analysis}
                          analyzingId={analyzingId}
                          onAnalyze={handleAnalyzeDrawing}
                          onDelete={handleDeleteItem}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {items.length > 0 && view !== 'spend' && (
        <p className="text-xs text-muted-foreground">
          {filtered.length} of {items.length} parts · Total annual spend:{' '}
          {formatUSD(filtered.reduce((s, i) => s + i.annualSpend, 0))}
          <span className="ml-2 text-red-400">■ Top 50% cost</span>
          <span className="ml-1 text-amber-400">■ 50–80%</span>
          <span className="ml-1 text-emerald-400">■ Bottom 20%</span>
        </p>
      )}

      {/* Import dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import from Mithran BOM</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Select Project</Label>
              <Select
                value={selectedProjectId}
                onValueChange={(v) => { setSelectedProjectId(v); setSelectedBomId(''); }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a project…" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedProjectId && (
              <div className="space-y-1.5">
                <Label>Select BOM</Label>
                <Select value={selectedBomId} onValueChange={setSelectedBomId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a BOM…" />
                  </SelectTrigger>
                  <SelectContent>
                    {boms.map((b: any) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {selectedBomId && sourceBomItems.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {sourceBomItems.length} parts will be imported.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button
              onClick={handleImport}
              disabled={!selectedBomId || !sourceBomItems.length || bulkImport.isPending}
            >
              {bulkImport.isPending ? 'Importing…' : 'Import BOM'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
