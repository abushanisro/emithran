'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  FileText,
  RefreshCw,
  AlertCircle,
  TrendingUp,
} from 'lucide-react';
import { useBomItemCostAnalysis } from '@/lib/api/hooks/useCostAnalysis';
import { useCostData } from '@/lib/providers/cost-data-provider';
import { useEffect } from 'react';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (v: number) => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number) => `${v.toFixed(1)}%`;

const COLORS = {
  process:       '#3b82f6',
  raw_material:  '#f97316',
  tooling:       '#f59e0b',
  procured_part: '#8b5cf6',
  packaging:     '#10b981',
};

// ─── Compact pie chart ────────────────────────────────────────────────────────

const MiniPie = ({ data }: { data: Array<{ label: string; value: number; color: string }> }) => {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;
  let angle = 0;
  return (
    <svg width="120" height="120" className="-rotate-90">
      {data.filter(d => d.value > 0).map((d, i) => {
        const pctVal = d.value / total;
        const sweep  = pctVal * 360;
        const start  = angle;
        const end    = angle + sweep;
        angle += sweep;
        const r = 52;
        const cx = 60; const cy = 60;
        const x1 = cx + r * Math.cos((start - 90) * Math.PI / 180);
        const y1 = cy + r * Math.sin((start - 90) * Math.PI / 180);
        const x2 = cx + r * Math.cos((end   - 90) * Math.PI / 180);
        const y2 = cy + r * Math.sin((end   - 90) * Math.PI / 180);
        const large = sweep > 180 ? 1 : 0;
        return (
          <path
            key={i}
            d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`}
            fill={d.color}
          />
        );
      })}
    </svg>
  );
};

// ─── Props ───────────────────────────────────────────────────────────────────

interface CostAnalysisEngineProps {
  bomId: string;
  bomName?: string;
  itemCount?: number;
  bomItemId?: string;
  thumbnailUrl?: string;
  partNumber?: string;
  partName?: string;
  material?: string;
}

// ─── Main component ───────────────────────────────────────────────────────────

export const CostAnalysisEngine: React.FC<CostAnalysisEngineProps> = ({
  bomId,
  bomName = 'Assembly',
  itemCount = 0,
  bomItemId,
  thumbnailUrl,
  partNumber,
  partName,
  material,
}) => {
  const { calculateBomCosts, getCostData, isCalculating } = useCostData();
  const costData = getCostData(bomId);

  useEffect(() => {
    if (bomId && !costData && !isCalculating) {
      calculateBomCosts(bomId, itemCount);
    }
  }, [bomId, costData, isCalculating, calculateBomCosts, itemCount]);

  const { data: analysis, isLoading, error, refetch } = useBomItemCostAnalysis(bomItemId);

  // ── No item selected ──────────────────────────────────────────────────────

  if (!bomItemId) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium text-foreground mb-1">Select a BOM item</p>
            <p className="text-xs text-muted-foreground">
              Choose an item from the left panel to view its a-priori cost estimate
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="py-10 text-center">
            <RefreshCw className="w-8 h-8 mx-auto text-primary animate-spin mb-3" />
            <p className="text-sm text-muted-foreground">Computing cost estimate…</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────

  if (error || !analysis) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="py-10 text-center">
            <AlertCircle className="w-8 h-8 mx-auto text-destructive mb-3" />
            <p className="text-sm font-medium text-foreground mb-1">Cost data unavailable</p>
            <p className="text-xs text-muted-foreground mb-3">
              No cost records found for this item. Apply a process plan first.
            </p>
            <button
              onClick={() => refetch()}
              className="text-xs text-primary underline underline-offset-2"
            >
              Retry
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const mfg = analysis.manufacturingCost;

  const chartData = [
    { label: 'Process',        value: analysis.processCost,      color: COLORS.process },
    { label: 'Raw Material',   value: analysis.rawMaterialCost,  color: COLORS.raw_material },
    { label: 'Procured Parts', value: analysis.procuredPartCost, color: COLORS.procured_part },
    { label: 'Tooling',        value: analysis.toolingCost,       color: COLORS.tooling },
    { label: 'Packaging',      value: analysis.packagingCost,     color: COLORS.packaging },
  ].filter(d => d.value > 0);

  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div id="cost-engine-part-report" className="space-y-4">

      {/* ── 1. Part Header ──────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start gap-4">
            {/* Thumbnail */}
            {thumbnailUrl ? (
              <img
                src={thumbnailUrl}
                alt="Part thumbnail"
                className="w-24 h-24 object-contain rounded border border-border bg-muted/20 shrink-0"
              />
            ) : (
              <div className="w-24 h-24 rounded border border-border bg-muted/20 flex items-center justify-center shrink-0">
                <FileText className="w-8 h-8 text-muted-foreground" />
              </div>
            )}

            {/* Part metadata */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <Badge variant="secondary" className="text-[10px] py-0 font-semibold tracking-wide">
                  <svg className="w-2.5 h-2.5 mr-1" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <text x="0" y="13" fontSize="13" fontWeight="700" fill="currentColor" fontFamily="sans-serif">e</text>
                  </svg>
                  EMithran Report
                </Badge>
                <span className="text-[10px] text-muted-foreground">{today}</span>
              </div>
              <h3 className="text-base font-semibold text-foreground leading-tight truncate">
                {partName || bomName}
              </h3>
              {partNumber && (
                <p className="text-xs text-muted-foreground font-mono mt-0.5">{partNumber}</p>
              )}
              {material && (
                <p className="text-xs text-muted-foreground mt-0.5">{material}</p>
              )}
              <div className="flex gap-4 mt-2">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Mfg Cost</p>
                  <p className="text-sm font-bold text-primary">{fmt(mfg)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Selling Price</p>
                  <p className="text-sm font-bold text-green-600">{fmt(analysis.sellingPrice)}</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── 2 & 3. Cost Summary + Cost Drivers side-by-side ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Cost Summary Table */}
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">Cost Summary</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1.5 text-muted-foreground font-medium">Cost Element</th>
                  <th className="text-right py-1.5 text-muted-foreground font-medium">₹ / Part</th>
                  <th className="text-right py-1.5 text-muted-foreground font-medium w-16">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {[
                  { label: 'Raw Materials',         value: analysis.rawMaterialCost,  color: COLORS.raw_material },
                  { label: 'Process Costs',          value: analysis.processCost,      color: COLORS.process },
                  { label: 'Tooling & Fixtures',     value: analysis.toolingCost,       color: COLORS.tooling },
                  { label: 'Packaging & Logistics',  value: analysis.packagingCost,     color: COLORS.packaging },
                  { label: 'Procured Parts',         value: analysis.procuredPartCost, color: COLORS.procured_part },
                ].map(row => (
                  <tr key={row.label}>
                    <td className="py-1.5 flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: row.color }} />
                      {row.label}
                    </td>
                    <td className="py-1.5 text-right tabular-nums font-mono">{fmt(row.value)}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {mfg > 0 ? pct((row.value / mfg) * 100) : '—'}
                    </td>
                  </tr>
                ))}

                {/* Subtotal */}
                <tr className="border-t-2 border-border font-semibold">
                  <td className="py-1.5">Total Mfg Cost</td>
                  <td className="py-1.5 text-right tabular-nums font-mono">{fmt(mfg)}</td>
                  <td className="py-1.5 text-right text-muted-foreground">100%</td>
                </tr>
                <tr>
                  <td className="py-1 text-muted-foreground">SGA (12.5%)</td>
                  <td className="py-1 text-right tabular-nums font-mono text-muted-foreground">{fmt(analysis.sgaCost)}</td>
                  <td />
                </tr>
                <tr>
                  <td className="py-1 text-muted-foreground">Profit (8%)</td>
                  <td className="py-1 text-right tabular-nums font-mono text-muted-foreground">{fmt(analysis.profitCost)}</td>
                  <td />
                </tr>
                <tr className="border-t border-border font-bold text-primary">
                  <td className="py-2">Selling Price</td>
                  <td className="py-2 text-right tabular-nums font-mono">{fmt(analysis.sellingPrice)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Top Cost Drivers + Pie */}
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5" />
              Top Cost Drivers
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {analysis.costDrivers.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No cost records</p>
            ) : (
              <>
                <div className="flex gap-4 items-start">
                  {/* Pie */}
                  <div className="shrink-0">
                    <MiniPie data={chartData} />
                  </div>
                  {/* Legend */}
                  <div className="flex-1 min-w-0 space-y-1 pt-1">
                    {chartData.map(d => (
                      <div key={d.label} className="flex items-center gap-1.5 text-[10px]">
                        <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: d.color }} />
                        <span className="text-muted-foreground truncate">{d.label}</span>
                        <span className="ml-auto font-mono font-medium tabular-nums">
                          {mfg > 0 ? pct((d.value / mfg) * 100) : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                  {analysis.costDrivers.map((d, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground w-4 text-right shrink-0">{i + 1}.</span>
                      <span className="flex-1 text-[11px] truncate" title={d.label}>{d.label}</span>
                      <span className="text-[11px] tabular-nums font-mono font-medium shrink-0">{fmt(d.costPerPart)}</span>
                      <span className="text-[10px] text-muted-foreground w-10 text-right shrink-0">{pct(d.pctOfMfgCost)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── 5. Process Cost Breakdown (per-op) ──────────────────────────── */}
      {analysis.processLines.length > 0 && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">Process Cost Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left py-2 px-4 font-medium text-muted-foreground">Op#</th>
                    <th className="text-left py-2 px-2 font-medium text-muted-foreground">Operation</th>
                    <th className="text-right py-2 px-2 font-medium text-muted-foreground">Cycle (s)</th>
                    <th className="text-right py-2 px-2 font-medium text-muted-foreground">MHR</th>
                    <th className="text-right py-2 px-2 font-medium text-muted-foreground">LHR</th>
                    <th className="text-right py-2 px-2 font-medium text-muted-foreground">Setup/part</th>
                    <th className="text-right py-2 px-2 font-medium text-muted-foreground">Cycle/part</th>
                    <th className="text-right py-2 px-4 font-medium text-muted-foreground">Total/part</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {analysis.processLines.map((pl, i) => (
                    <tr key={i} className="hover:bg-muted/20">
                      <td className="py-1.5 px-4 tabular-nums">{pl.opNbr}</td>
                      <td className="py-1.5 px-2">
                        <div className="max-w-[180px]">
                          <p className="truncate font-medium">{pl.operation || '—'}</p>
                          {pl.processGroup && (
                            <p className="truncate text-muted-foreground text-[10px]">{pl.processGroup}</p>
                          )}
                        </div>
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{pl.cycleTimeSec.toFixed(0)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">₹{pl.machineRate.toFixed(0)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">₹{pl.laborRate.toFixed(0)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums font-mono">₹{pl.setupCostPerPart.toFixed(4)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums font-mono">₹{pl.cycleCostPerPart.toFixed(4)}</td>
                      <td className="py-1.5 px-4 text-right tabular-nums font-mono font-semibold">₹{pl.totalCostPerPart.toFixed(4)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border bg-muted/20 font-semibold">
                    <td colSpan={7} className="py-2 px-4 text-right text-muted-foreground">Total Process Cost</td>
                    <td className="py-2 px-4 text-right tabular-nums font-mono text-primary">{fmt(analysis.processCost)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── 6. Raw Material Breakdown ────────────────────────────────────── */}
      {analysis.materialLines.length > 0 && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">Raw Material Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left py-2 px-4 font-medium text-muted-foreground">Material</th>
                    <th className="text-left py-2 px-2 font-medium text-muted-foreground">Grade / Spec</th>
                    <th className="text-right py-2 px-2 font-medium text-muted-foreground">Net (kg)</th>
                    <th className="text-right py-2 px-2 font-medium text-muted-foreground">Gross (kg)</th>
                    <th className="text-right py-2 px-2 font-medium text-muted-foreground">Scrap %</th>
                    <th className="text-right py-2 px-2 font-medium text-muted-foreground">₹/kg</th>
                    <th className="text-right py-2 px-4 font-medium text-muted-foreground">Total/part</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {analysis.materialLines.map((ml, i) => (
                    <tr key={i} className="hover:bg-muted/20">
                      <td className="py-1.5 px-4 font-medium">{ml.materialName}</td>
                      <td className="py-1.5 px-2 text-muted-foreground">{ml.materialDescription || '—'}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums font-mono">{ml.netUsage.toFixed(4)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums font-mono">{ml.grossUsage.toFixed(4)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{ml.scrap}%</td>
                      <td className="py-1.5 px-2 text-right tabular-nums font-mono">₹{ml.unitCost.toFixed(2)}</td>
                      <td className="py-1.5 px-4 text-right tabular-nums font-mono font-semibold">₹{ml.totalCost.toFixed(4)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border bg-muted/20 font-semibold">
                    <td colSpan={6} className="py-2 px-4 text-right text-muted-foreground">Total Material Cost</td>
                    <td className="py-2 px-4 text-right tabular-nums font-mono text-primary">{fmt(analysis.rawMaterialCost)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
};
