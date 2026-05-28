'use client';

import { useState } from 'react';
import {
  Printer, Download, TrendingUp, Clock, DollarSign, BarChart2, FileOutput,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { useVaveIdeas, useVaveShouldCosts } from '@/lib/api/hooks/useVave';
import type { VaveIdea } from '@/lib/api/vave';
import { toast } from 'sonner';

interface Props {
  projectId: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatUSD(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function calcNPV(annualSavings: number, investment: number, years: number, rate = 0.08) {
  let npv = -investment;
  for (let t = 1; t <= years; t++) {
    npv += annualSavings / Math.pow(1 + rate, t);
  }
  return npv;
}

function calcIRR(annualSavings: number, investment: number, years: number): number | null {
  if (annualSavings <= 0 || investment <= 0) return null;
  let lo = -0.5, hi = 10.0;
  for (let iter = 0; iter < 100; iter++) {
    const mid = (lo + hi) / 2;
    let npv = -investment;
    for (let t = 1; t <= years; t++) npv += annualSavings / Math.pow(1 + mid, t);
    if (Math.abs(npv) < 0.01) return mid * 100;
    if (npv > 0) lo = mid; else hi = mid;
  }
  return ((lo + hi) / 2) * 100;
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

const QUADRANT_COLORS: Record<string, { bar: string; text: string; border: string; bg: string }> = {
  QuickWin:  { bar: 'bg-emerald-500', text: 'text-emerald-400', border: 'border-emerald-500/40', bg: 'bg-emerald-500/10' },
  Strategic: { bar: 'bg-blue-500',    text: 'text-blue-400',    border: 'border-blue-500/40',    bg: 'bg-blue-500/10' },
  FillIn:    { bar: 'bg-amber-500',   text: 'text-amber-400',   border: 'border-amber-500/40',   bg: 'bg-amber-500/10' },
  Avoid:     { bar: 'bg-muted-foreground', text: 'text-muted-foreground', border: 'border-border', bg: 'bg-muted/40' },
};

const FRAMEWORK_COLORS: Record<string, { bar: string; text: string }> = {
  SCAMPER: { bar: 'bg-primary',            text: 'text-primary' },
  TRIZ:    { bar: 'bg-purple-500',         text: 'text-purple-400' },
  FAST:    { bar: 'bg-amber-500',          text: 'text-amber-400' },
  Manual:  { bar: 'bg-muted-foreground',   text: 'text-muted-foreground' },
};

function getBarStyle(idea: VaveIdea): { bar: string; text: string; border: string; bg: string } {
  const qc = idea.quadrant ? QUADRANT_COLORS[idea.quadrant] : undefined;
  if (qc) return qc;
  const fc = FRAMEWORK_COLORS[idea.framework];
  return {
    bar:    fc?.bar    ?? 'bg-muted-foreground',
    text:   fc?.text   ?? 'text-muted-foreground',
    border: 'border-border',
    bg:     'bg-muted/20',
  };
}

// ── Section 2: A3 Business Case Report ────────────────────────────────────────

interface A3Props {
  ideas: VaveIdea[];
  annualSavings: number;
  investment: number;
  npv: number;
  irr: number | null;
  roi: number | null;
  paybackMonths: number | null;
  years: number;
  totalSpend: number;
}

function A3Report({
  ideas, annualSavings, investment, npv, irr, roi, paybackMonths, years, totalSpend,
}: A3Props) {
  const today = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
  const maxTimeline = Math.max(...ideas.map((i) => i.timeToImplementMonths ?? 3), 1);
  const frameworks = [...new Set(ideas.map((i) => i.framework))];
  const affectedParts = [...new Set(ideas.flatMap((i) => i.affectedParts))];
  const highRiskCount = ideas.filter((i) => i.risk === 'High').length;
  const ecoRequired = ideas.some((i) => i.complexity === 'L3' || i.risk === 'High');

  return (
    <div className="rounded-xl border-2 border-border overflow-hidden text-sm">
      {/* A3 Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-primary/10 border-b border-primary/30">
        <div>
          <p className="font-bold text-base tracking-wide text-foreground">VAVE A3 BUSINESS CASE</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Value Analysis · Value Engineering</p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Mithran MFG</p>
          <p>{today}</p>
        </div>
      </div>

      {/* Row 1: Problem Statement | Current State */}
      <div className="grid grid-cols-2 border-b border-border">
        <div className="px-4 py-3 border-r border-border">
          <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1.5">Problem Statement</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Current product cost structure has identifiable reduction opportunities.
            VAVE analysis identified <strong className="text-foreground">{ideas.length} initiative{ideas.length !== 1 ? 's' : ''}</strong> across{' '}
            <strong className="text-foreground">{frameworks.join(', ')}</strong> frameworks
            affecting <strong className="text-foreground">{affectedParts.length}</strong> parts.
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1.5">Current State</p>
          <div className="space-y-1 text-xs text-muted-foreground">
            {totalSpend > 0 && (
              <p>Total annual spend on selected parts: <span className="text-foreground font-semibold">{formatUSD(totalSpend)}</span></p>
            )}
            <p>Est. annual savings opportunity: <span className="text-emerald-400 font-semibold">{formatUSD(annualSavings)}</span></p>
            <p>Required investment: <span className="text-primary font-semibold">{formatUSD(investment)}</span></p>
          </div>
        </div>
      </div>

      {/* Row 2: Target | Analysis Summary */}
      <div className="grid grid-cols-2 border-b border-border">
        <div className="px-4 py-3 border-r border-border">
          <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1.5">Target</p>
          <div className="text-xs text-muted-foreground space-y-1">
            <p>Achieve <span className="text-emerald-400 font-semibold">{formatUSD(annualSavings)}</span>/yr savings</p>
            <p>Payback in <span className="text-foreground font-semibold">{paybackMonths != null ? `${paybackMonths.toFixed(1)} months` : 'N/A'}</span></p>
            <p>Implementation span: <span className="text-foreground font-semibold">{maxTimeline} months</span></p>
            <p>NPV ({years}yr @ 8%): <span className={`font-semibold ${npv >= 0 ? 'text-emerald-400' : 'text-destructive'}`}>{formatUSD(npv)}</span></p>
          </div>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1.5">Analysis Summary</p>
          <div className="grid grid-cols-3 gap-2 mt-1">
            <div className="text-center rounded-lg bg-muted/30 py-2 px-1">
              <p className="text-lg font-bold text-foreground">{ideas.length}</p>
              <p className="text-[9px] text-muted-foreground">Ideas</p>
            </div>
            <div className="text-center rounded-lg bg-muted/30 py-2 px-1">
              <p className="text-lg font-bold text-foreground">{frameworks.length}</p>
              <p className="text-[9px] text-muted-foreground">Frameworks</p>
            </div>
            <div className="text-center rounded-lg bg-muted/30 py-2 px-1">
              <p className="text-lg font-bold text-foreground">{affectedParts.length}</p>
              <p className="text-[9px] text-muted-foreground">Parts</p>
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: Selected Initiatives Table (full width) */}
      <div className="border-b border-border">
        <div className="px-4 pt-3 pb-2">
          <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-2">Selected Initiatives</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-4 py-2 text-left font-semibold text-muted-foreground">#</th>
                <th className="px-4 py-2 text-left font-semibold text-muted-foreground">Title</th>
                <th className="px-4 py-2 text-left font-semibold text-muted-foreground">Framework</th>
                <th className="px-4 py-2 text-right font-semibold text-muted-foreground">Savings</th>
                <th className="px-4 py-2 text-right font-semibold text-muted-foreground">Investment</th>
                <th className="px-4 py-2 text-center font-semibold text-muted-foreground">Complexity</th>
                <th className="px-4 py-2 text-center font-semibold text-muted-foreground">Risk</th>
                <th className="px-4 py-2 text-center font-semibold text-muted-foreground">Timeline</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {ideas.map((idea, idx) => (
                <tr key={idea.id} className="hover:bg-muted/10">
                  <td className="px-4 py-2 text-muted-foreground">{idx + 1}</td>
                  <td className="px-4 py-2">
                    <p className="font-medium max-w-[240px] truncate" title={idea.title}>{idea.title}</p>
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant="outline" className="text-[9px] h-4 px-1">{idea.framework}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right font-semibold text-emerald-400">{formatUSD(idea.estSavingsUsd)}</td>
                  <td className="px-4 py-2 text-right text-muted-foreground">{formatUSD(idea.estInvestmentUsd)}</td>
                  <td className="px-4 py-2 text-center">
                    <Badge variant="secondary" className="text-[9px] h-4 px-1">{idea.complexity}</Badge>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <span className={`text-[10px] font-medium ${
                      idea.risk === 'High' ? 'text-destructive' :
                      idea.risk === 'Medium' ? 'text-amber-400' : 'text-emerald-400'
                    }`}>{idea.risk}</span>
                  </td>
                  <td className="px-4 py-2 text-center text-muted-foreground">
                    {idea.timeToImplementMonths ? `${idea.timeToImplementMonths}mo` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Row 4: Financial Summary | Implementation Notes */}
      <div className="grid grid-cols-2">
        <div className="px-4 py-3 border-r border-border">
          <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-2">Financial Summary</p>
          <div className="space-y-1.5 text-xs">
            {[
              { label: 'NPV', value: formatUSD(npv), color: npv >= 0 ? 'text-emerald-400' : 'text-destructive' },
              { label: 'IRR', value: irr != null ? `${irr.toFixed(1)}%` : 'N/A', color: 'text-primary' },
              { label: 'Payback', value: paybackMonths != null ? `${paybackMonths.toFixed(1)} months` : 'N/A', color: 'text-amber-400' },
              { label: `ROI (${years}yr)`, value: roi != null ? `${roi.toFixed(1)}%` : 'N/A', color: 'text-foreground' },
              { label: 'Discount Rate', value: '8%', color: 'text-muted-foreground' },
              { label: 'Analysis Period', value: `${years} years`, color: 'text-muted-foreground' },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex justify-between items-center">
                <span className="text-muted-foreground">{label}</span>
                <span className={`font-semibold ${color}`}>{value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-2">Implementation Notes</p>
          <div className="space-y-1.5 text-xs text-muted-foreground">
            <p>• Approval required: <span className="text-foreground">Engineering + Finance sign-off</span></p>
            <p>• ECO required: <span className={`font-semibold ${ecoRequired ? 'text-amber-400' : 'text-emerald-400'}`}>{ecoRequired ? 'Yes — L3/High-risk changes' : 'No'}</span></p>
            <p>• Risk level: <span className={`font-semibold ${
              highRiskCount > ideas.length / 2 ? 'text-destructive' :
              highRiskCount > 0 ? 'text-amber-400' : 'text-emerald-400'
            }`}>{highRiskCount > ideas.length / 2 ? 'High' : highRiskCount > 0 ? 'Medium' : 'Low'}</span></p>
            <p>• High-risk ideas: <span className="text-foreground">{highRiskCount}</span> of {ideas.length}</p>
            <p>• Frameworks used: <span className="text-foreground">{frameworks.join(', ')}</span></p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Section 3: Implementation Gantt ───────────────────────────────────────────

function ImplementationGantt({ ideas }: { ideas: VaveIdea[] }) {
  const ideasWithMonths = ideas.map((idea) => ({
    ...idea,
    months: idea.timeToImplementMonths ?? 3,
    isDefault: !idea.timeToImplementMonths,
  }));

  const maxMonths = Math.max(...ideasWithMonths.map((i) => i.months), 6);
  const gridMonths = Math.max(maxMonths, 12);
  const monthCols = Array.from({ length: gridMonths }, (_, i) => i + 1);

  // Phase markers
  const phases = [
    { label: 'Design Review', month: 2,                        color: 'text-primary' },
    { label: 'ECO',           month: Math.round(maxMonths / 2), color: 'text-amber-400' },
    { label: 'Production',    month: maxMonths,                 color: 'text-emerald-400' },
  ].filter((p, i, arr) => arr.findIndex((x) => x.month === p.month) === i); // deduplicate

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Total Timeline:</span>
        <span className="font-semibold text-foreground">{maxMonths} months</span>
        <span>·</span>
        <span>{ideas.length} initiatives</span>
        {ideasWithMonths.some((i) => i.isDefault) && (
          <span className="text-[10px]">(dashed = default 3mo)</span>
        )}
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        {/* Phase markers */}
        <div className="flex border-b border-border bg-muted/60">
          <div className="w-[200px] shrink-0 px-3 py-1.5 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
            Initiative
          </div>
          <div className="flex-1 relative" style={{ height: '28px' }}>
            <div
              className="absolute inset-0 grid"
              style={{ gridTemplateColumns: `repeat(${gridMonths}, minmax(0, 1fr))` }}
            >
              {monthCols.map((m) => (
                <div key={m} className={`text-center border-l border-border/30 flex flex-col justify-center ${m % 2 === 0 ? 'bg-muted/20' : ''}`}>
                  <span className="text-[8px] text-muted-foreground/60">M{m}</span>
                </div>
              ))}
            </div>
            {/* Phase labels */}
            {phases.map((phase) => (
              <div
                key={phase.label}
                className="absolute top-0 bottom-0 flex flex-col justify-center pointer-events-none"
                style={{ left: `${((phase.month - 1) / gridMonths) * 100}%`, transform: 'translateX(-50%)' }}
              >
                <span className={`text-[8px] font-semibold whitespace-nowrap px-1 ${phase.color}`}>
                  ▼ {phase.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Idea rows */}
        <div className="divide-y divide-border/30">
          {ideasWithMonths.map((idea) => {
            const { text: barTextColor, border: barBorder, bg: barBg } = getBarStyle(idea);
            const widthPct = (idea.months / gridMonths) * 100;

            return (
              <div key={idea.id} className="flex items-center hover:bg-muted/10 transition-colors">
                <div className="w-[200px] shrink-0 px-3 py-3">
                  <p className="text-xs font-medium truncate" title={idea.title}>
                    {truncate(idea.title, 28)}
                  </p>
                  <p className="text-[9px] text-muted-foreground mt-0.5">{idea.framework}</p>
                </div>
                <div className="flex-1 relative py-3" style={{ height: '52px' }}>
                  {/* Grid */}
                  <div
                    className="absolute inset-0 grid pointer-events-none"
                    style={{ gridTemplateColumns: `repeat(${gridMonths}, minmax(0, 1fr))` }}
                  >
                    {monthCols.map((m) => (
                      <div key={m} className={`border-l border-border/20 ${m % 2 === 0 ? 'bg-muted/10' : ''}`} />
                    ))}
                  </div>

                  {/* Bar */}
                  <div
                    className={`absolute top-1/2 -translate-y-1/2 h-6 rounded-md flex items-center px-2 ${
                      idea.isDefault
                        ? `border border-dashed ${barBorder} bg-transparent`
                        : `${barBg} border ${barBorder}`
                    }`}
                    style={{ left: 0, width: `${widthPct}%`, minWidth: '28px' }}
                  >
                    <span className={`text-[9px] font-semibold truncate ${barTextColor}`}>
                      {idea.months}mo
                    </span>
                  </div>

                  {/* Phase tick markers */}
                  {phases.map((phase) => (
                    <div
                      key={phase.label}
                      className="absolute top-0 bottom-0 border-l border-dashed border-border/40 pointer-events-none"
                      style={{ left: `${((phase.month - 1) / gridMonths) * 100}%` }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 flex-wrap text-[10px] text-muted-foreground">
        <span className="font-medium">Color by:</span>
        {(['QuickWin', 'Strategic', 'FillIn', 'Avoid'] as const).map((q) => {
          const c = QUADRANT_COLORS[q];
          if (!c) return null;
          return (
            <div key={q} className="flex items-center gap-1">
              <span className={`h-2.5 w-4 rounded-sm ${c.bg} border ${c.border}`} />
              <span>{q === 'QuickWin' ? 'Quick Win' : q === 'FillIn' ? 'Fill-in' : q}</span>
            </div>
          );
        })}
        <span className="ml-1">·</span>
        {(['SCAMPER', 'TRIZ', 'FAST', 'Manual'] as const).map((f) => {
          const c = FRAMEWORK_COLORS[f];
          if (!c) return null;
          return (
            <div key={f} className="flex items-center gap-1">
              <span className={`h-2.5 w-4 rounded-sm ${c.bar} opacity-30`} />
              <span>{f}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function BusinessCaseGenerator({ projectId }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [investmentOverride, setInvestmentOverride] = useState('');
  const [years, setYears] = useState(3);

  const { data: ideas } = useVaveIdeas(projectId);
  const { data: shouldCosts } = useVaveShouldCosts(projectId);

  const allIdeas = (ideas as VaveIdea[]) ?? [];
  const approvedIdeas = allIdeas.filter(
    (i) => i.status === 'approved' || i.status === 'in-progress' || i.status === 'done'
  );
  const selectedIdeas = approvedIdeas.filter((i) => selectedIds.has(i.id));

  // Financials
  const annualSavings = selectedIdeas.reduce((s, i) => s + i.estSavingsUsd, 0);
  const autoInvestment = selectedIdeas.reduce((s, i) => s + i.estInvestmentUsd, 0);
  const investment = parseFloat(investmentOverride) || autoInvestment;
  const paybackMonths = investment > 0 && annualSavings > 0 ? (investment / annualSavings) * 12 : null;
  const npv = calcNPV(annualSavings, investment, years);
  const irr = calcIRR(annualSavings, investment, years);
  const roi = investment > 0 ? ((annualSavings * years - investment) / investment) * 100 : null;

  // Total spend from should-costs (for A3 current state)
  const totalSpend = (shouldCosts as { actualCost: number }[] | undefined)
    ?.reduce((s, sc) => s + (sc.actualCost ?? 0), 0) ?? 0;

  const toggleIdea = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelectedIds(new Set(approvedIdeas.map((i) => i.id)));
  const clearAll = () => setSelectedIds(new Set());

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handlePrint = () => window.print();

  const handleExcelDownload = () => {
    try {
      const XLSX = require('xlsx') as typeof import('xlsx');
      const wb = XLSX.utils.book_new();

      const ideasRows = selectedIdeas.map((idea) => ({
        'Title': idea.title,
        'Framework': idea.framework,
        'Est. Savings ($)': idea.estSavingsUsd,
        'Est. Investment ($)': idea.estInvestmentUsd,
        'Feasibility': idea.feasibility,
        'Complexity': idea.complexity,
        'Risk': idea.risk,
        'Status': idea.status,
        'Timeline (months)': idea.timeToImplementMonths ?? 3,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ideasRows), 'VAVE Ideas');

      const roiRows = [
        ['Annual Savings', annualSavings],
        ['Total Investment', investment],
        ['Analysis Period (years)', years],
        ['Payback Period (months)', paybackMonths?.toFixed(1) ?? 'N/A'],
        [`NPV (${years}yr @ 8%)`, npv.toFixed(0)],
        ['IRR (%)', irr?.toFixed(1) ?? 'N/A'],
        ['ROI (%)', roi?.toFixed(1) ?? 'N/A'],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(roiRows), 'ROI Summary');

      XLSX.writeFile(wb, 'vave-business-case.xlsx');
      toast.success('Excel exported');
    } catch {
      toast.error('Export failed');
    }
  };

  const handleApprovalRequest = () => {
    if (selectedIdeas.length === 0) return;
    const today = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
    const ideasRows = selectedIdeas
      .map(
        (idea, i) =>
          `<tr style="background:${i % 2 === 0 ? '#f9fafb' : '#ffffff'}">
            <td style="padding:6px 10px;border:1px solid #e2e8f0">${i + 1}</td>
            <td style="padding:6px 10px;border:1px solid #e2e8f0;font-weight:500">${idea.title}</td>
            <td style="padding:6px 10px;border:1px solid #e2e8f0">${idea.framework}</td>
            <td style="padding:6px 10px;border:1px solid #e2e8f0;color:#059669;font-weight:600">$${idea.estSavingsUsd.toLocaleString()}</td>
            <td style="padding:6px 10px;border:1px solid #e2e8f0">$${idea.estInvestmentUsd.toLocaleString()}</td>
            <td style="padding:6px 10px;border:1px solid #e2e8f0">${idea.complexity}</td>
            <td style="padding:6px 10px;border:1px solid #e2e8f0">${idea.risk}</td>
            <td style="padding:6px 10px;border:1px solid #e2e8f0">${idea.timeToImplementMonths ? idea.timeToImplementMonths + ' mo' : '3 mo (est.)'}</td>
          </tr>`
      )
      .join('');

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>VAVE Approval Request</title>
  <style>
    body { font-family: -apple-system, Arial, sans-serif; margin: 0; padding: 32px; color: #1a202c; }
    .header { border-bottom: 3px solid #0ea5e9; padding-bottom: 16px; margin-bottom: 24px; }
    .header h1 { margin: 0 0 4px; font-size: 22px; color: #0284c7; }
    .header p { margin: 0; color: #64748b; font-size: 13px; }
    .meta { display: flex; gap: 32px; margin-bottom: 24px; }
    .meta-item { }
    .meta-item label { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
    .meta-item p { margin: 2px 0 0; font-size: 14px; font-weight: 600; }
    .section { margin-bottom: 24px; }
    .section h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: #475569; margin: 0 0 12px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
    .financials { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
    .fin-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; text-align: center; }
    .fin-card .val { font-size: 20px; font-weight: 700; }
    .fin-card .lbl { font-size: 11px; color: #94a3b8; margin-top: 4px; }
    .green { color: #059669; }
    .blue { color: #0284c7; }
    .amber { color: #d97706; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { background: #f1f5f9; padding: 8px 10px; text-align: left; border: 1px solid #e2e8f0; font-size: 11px; text-transform: uppercase; color: #475569; }
    .signature { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 32px; margin-top: 40px; }
    .sig-line { border-top: 1px solid #94a3b8; padding-top: 6px; font-size: 11px; color: #64748b; }
    @media print { body { margin: 0; padding: 16px; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>VAVE Approval Request</h1>
    <p>Value Analysis · Value Engineering Program — Engineering Change Authorization</p>
  </div>

  <div class="meta">
    <div class="meta-item"><label>Date</label><p>${today}</p></div>
    <div class="meta-item"><label>Initiatives</label><p>${selectedIdeas.length}</p></div>
    <div class="meta-item"><label>Analysis Period</label><p>${years} Years</p></div>
    <div class="meta-item"><label>Discount Rate</label><p>8%</p></div>
  </div>

  <div class="financials">
    <div class="fin-card"><div class="val green">$${annualSavings.toLocaleString()}</div><div class="lbl">Annual Savings</div></div>
    <div class="fin-card"><div class="val blue">$${investment.toLocaleString()}</div><div class="lbl">Required Investment</div></div>
    <div class="fin-card"><div class="val amber">${paybackMonths != null ? paybackMonths.toFixed(1) + ' mo' : 'N/A'}</div><div class="lbl">Payback Period</div></div>
    <div class="fin-card"><div class="val ${npv >= 0 ? 'green' : ''}" style="${npv < 0 ? 'color:#dc2626' : ''}">$${Math.round(npv).toLocaleString()}</div><div class="lbl">NPV (${years}yr @ 8%)</div></div>
  </div>

  <div class="section">
    <h2>Additional Financial Metrics</h2>
    <p><strong>IRR:</strong> ${irr != null ? irr.toFixed(1) + '%' : 'N/A'} &nbsp;·&nbsp; <strong>ROI (${years}yr):</strong> ${roi != null ? roi.toFixed(1) + '%' : 'N/A'}</p>
  </div>

  <div class="section">
    <h2>Selected VAVE Initiatives</h2>
    <table>
      <thead>
        <tr>
          <th>#</th><th>Title</th><th>Framework</th><th>Savings</th><th>Investment</th><th>Complexity</th><th>Risk</th><th>Timeline</th>
        </tr>
      </thead>
      <tbody>${ideasRows}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>Authorization</h2>
    <p style="font-size:12px;color:#64748b">By signing below, the approver authorizes implementation of the selected VAVE initiatives as described.</p>
    <div class="signature">
      <div>
        <div class="sig-line">Engineering Lead / Date</div>
      </div>
      <div>
        <div class="sig-line">Finance Approval / Date</div>
      </div>
      <div>
        <div class="sig-line">Program Manager / Date</div>
      </div>
    </div>
  </div>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=900,height=700');
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* ── Section 1: ROI Calculator ── */}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">ROI Calculator</h3>
        <p className="text-xs text-muted-foreground">Select approved ideas to compute return metrics.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Idea selector */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Select Ideas for Business Case
            </h4>
            <div className="flex gap-2 text-xs">
              <button onClick={selectAll} className="text-primary underline-offset-2 hover:underline">All</button>
              <span className="text-muted-foreground">·</span>
              <button onClick={clearAll} className="text-primary underline-offset-2 hover:underline">None</button>
            </div>
          </div>

          {approvedIdeas.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No approved ideas yet. Approve ideas in the Idea Repository first.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
              {approvedIdeas
                .sort((a, b) => b.estSavingsUsd - a.estSavingsUsd)
                .map((idea) => (
                  <div
                    key={idea.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedIds.has(idea.id)
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border hover:bg-muted/30'
                    }`}
                    onClick={() => toggleIdea(idea.id)}
                  >
                    <Checkbox
                      checked={selectedIds.has(idea.id)}
                      onCheckedChange={() => toggleIdea(idea.id)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium line-clamp-1">{idea.title}</p>
                        <span className="text-sm font-bold text-emerald-400 shrink-0">
                          {formatUSD(idea.estSavingsUsd)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-[9px] h-4 px-1">{idea.framework}</Badge>
                        <Badge variant="outline" className="text-[9px] h-4 px-1">{idea.complexity}</Badge>
                        {idea.timeToImplementMonths && (
                          <span className="text-[10px] text-muted-foreground">{idea.timeToImplementMonths}mo</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Right: ROI metrics */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Investment ($)</Label>
              <Input
                type="number"
                value={investmentOverride || autoInvestment.toFixed(0)}
                onChange={(e) => setInvestmentOverride(e.target.value)}
                className="h-8 text-sm"
              />
              <p className="text-[10px] text-muted-foreground">Auto: {formatUSD(autoInvestment)}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Analysis Period (years)</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={years}
                onChange={(e) => setYears(Math.max(1, Math.min(10, parseInt(e.target.value) || 3)))}
                className="h-8 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Card className="bg-emerald-500/10 border-emerald-500/30">
              <CardContent className="pt-3 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs text-muted-foreground">Annual Savings</span>
                </div>
                <p className="text-xl font-bold text-emerald-400">{formatUSD(annualSavings)}</p>
              </CardContent>
            </Card>
            <Card className="bg-primary/10 border-primary/30">
              <CardContent className="pt-3 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="h-4 w-4 text-primary" />
                  <span className="text-xs text-muted-foreground">Investment</span>
                </div>
                <p className="text-xl font-bold text-primary">{formatUSD(investment)}</p>
              </CardContent>
            </Card>
            <Card className="bg-amber-500/10 border-amber-500/30">
              <CardContent className="pt-3 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="h-4 w-4 text-amber-400" />
                  <span className="text-xs text-muted-foreground">Payback Period</span>
                </div>
                <p className="text-xl font-bold text-amber-400">
                  {paybackMonths != null ? `${paybackMonths.toFixed(1)} mo` : '—'}
                </p>
              </CardContent>
            </Card>
            <Card className={npv >= 0 ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-destructive/10 border-destructive/30'}>
              <CardContent className="pt-3 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart2 className="h-4 w-4 text-primary" />
                  <span className="text-xs text-muted-foreground">NPV ({years}yr @ 8%)</span>
                </div>
                <p className={`text-xl font-bold ${npv >= 0 ? 'text-emerald-400' : 'text-destructive'}`}>
                  {formatUSD(npv)}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="flex items-center gap-4 px-3 py-2 bg-muted/30 rounded-lg text-sm">
            <div>
              <span className="text-muted-foreground text-xs">IRR</span>
              <p className="font-bold">{irr != null ? `${irr.toFixed(1)}%` : '—'}</p>
            </div>
            <div className="w-px h-8 bg-border" />
            <div>
              <span className="text-muted-foreground text-xs">ROI ({years}yr)</span>
              <p className="font-bold">{roi != null ? `${roi.toFixed(1)}%` : '—'}</p>
            </div>
            <div className="w-px h-8 bg-border" />
            <div>
              <span className="text-muted-foreground text-xs">Ideas Selected</span>
              <p className="font-bold">{selectedIdeas.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 2: A3 Business Case Report ── */}
      {selectedIdeas.length > 0 && (
        <div className="print-scope space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">A3 Business Case Report</h3>
              <p className="text-xs text-muted-foreground">{selectedIdeas.length} initiative{selectedIdeas.length !== 1 ? 's' : ''} · {new Date().toLocaleDateString()}</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="h-3.5 w-3.5 mr-1.5" />
                Print / PDF
              </Button>
              <Button variant="outline" size="sm" onClick={handleExcelDownload}>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export Excel
              </Button>
              <Button variant="outline" size="sm" onClick={handleApprovalRequest}>
                <FileOutput className="h-3.5 w-3.5 mr-1.5" />
                Export as Approval Request
              </Button>
            </div>
          </div>

          <A3Report
            ideas={selectedIdeas}
            annualSavings={annualSavings}
            investment={investment}
            npv={npv}
            irr={irr}
            roi={roi}
            paybackMonths={paybackMonths}
            years={years}
            totalSpend={totalSpend}
          />
        </div>
      )}

      {/* ── Section 3: Implementation Gantt ── */}
      {selectedIdeas.length > 0 && (
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Implementation Gantt</h3>
            <p className="text-xs text-muted-foreground">
              Horizontal timeline for selected initiatives with phase markers.
            </p>
          </div>
          <ImplementationGantt ideas={selectedIdeas} />
        </div>
      )}
    </div>
  );
}
