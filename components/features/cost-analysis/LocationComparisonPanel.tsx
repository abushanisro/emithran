'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Globe, ChevronDown, ChevronRight, AlertCircle, RefreshCw } from 'lucide-react';
import { useLocationComparison, type LocationCostEntry } from '@/lib/api/hooks/useLocationComparison';

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtUsd = (v: number) =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtRate = (v: number) =>
  `$${v.toFixed(0)}/hr`;

const LOCATION_FLAGS: Record<string, string> = {
  'India':     '🇮🇳',
  'USA':       '🇺🇸',
  'China':     '🇨🇳',
  'Germany':   '🇩🇪',
  'France':    '🇫🇷',
  'W. Europe': '🇪🇺',
  'E. Europe': '🇪🇺',
  'UK':        '🇬🇧',
  'Vietnam':   '🇻🇳',
  'Mexico':    '🇲🇽',
};

// ── BOM view: aggregate multiple bomItemIds ────────────────────────────────────

interface BomAggregateProps {
  bomItemIds: string[];
}

interface BomLocationRow {
  location: string;
  currencySymbol: string;
  totalMfgCostUsd: number;
  sellingPriceUsd: number;
  vsLowestPct: number;
}

// Client-aggregates results from multiple location-comparison calls.
// We call the hook for a single bomItemId in the Part view.
// For BOM view, the parent collects all results and passes them in.
const BomAggregateView: React.FC<{ rows: BomLocationRow[] }> = ({ rows }) => {
  const sorted = [...rows].sort((a, b) => a.totalMfgCostUsd - b.totalMfgCostUsd);
  const max    = sorted[sorted.length - 1]?.totalMfgCostUsd ?? 1;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="text-left py-2 px-4 font-medium text-muted-foreground">Location</th>
            <th className="text-right py-2 px-2 font-medium text-muted-foreground">Total Mfg Cost</th>
            <th className="text-right py-2 px-2 font-medium text-muted-foreground">Selling Price</th>
            <th className="text-right py-2 px-2 font-medium text-muted-foreground">vs Cheapest</th>
            <th className="py-2 px-4 font-medium text-muted-foreground">Cost Bar</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {sorted.map((row, i) => (
            <tr key={row.location} className="hover:bg-muted/20">
              <td className="py-2 px-4">
                <span className="mr-1.5">{LOCATION_FLAGS[row.location] ?? '🏭'}</span>
                <span className={i === 0 ? 'font-semibold text-primary' : ''}>{row.location}</span>
                {i === 0 && (
                  <Badge variant="secondary" className="ml-2 text-[9px] py-0 px-1 bg-green-500/15 text-green-600 border-green-500/30">
                    Cheapest
                  </Badge>
                )}
              </td>
              <td className="py-2 px-2 text-right tabular-nums font-mono font-medium">
                {fmtUsd(row.totalMfgCostUsd)}
              </td>
              <td className="py-2 px-2 text-right tabular-nums font-mono text-muted-foreground">
                {fmtUsd(row.sellingPriceUsd)}
              </td>
              <td className="py-2 px-2 text-right tabular-nums">
                {i === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="text-red-500">+{row.vsLowestPct.toFixed(1)}%</span>
                )}
              </td>
              <td className="py-2 px-4">
                <div className="w-full bg-muted rounded-full h-1.5">
                  <div
                    className="h-1.5 rounded-full bg-primary/70"
                    style={{ width: `${Math.round((row.totalMfgCostUsd / max) * 100)}%` }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ── Per-op accordion row ──────────────────────────────────────────────────────

const LocationRow: React.FC<{
  entry: LocationCostEntry;
  rank: number;
  isExpanded: boolean;
  onToggle: () => void;
  maxCost: number;
}> = ({ entry, rank, isExpanded, onToggle, maxCost }) => {
  const barWidth = maxCost > 0 ? Math.round((entry.totalMfgCostUsd / maxCost) * 100) : 0;
  const isCheapest = rank === 0;

  return (
    <>
      {/* Summary row */}
      <tr
        onClick={onToggle}
        className="hover:bg-muted/20 cursor-pointer select-none group"
      >
        <td className="py-2 px-4">
          <div className="flex items-center gap-1.5">
            {isExpanded
              ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
              : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
            }
            <span className="mr-1">{LOCATION_FLAGS[entry.location] ?? '🏭'}</span>
            <span className={isCheapest ? 'font-semibold text-primary' : ''}>
              {entry.location}
            </span>
            {isCheapest && (
              <Badge variant="secondary" className="ml-1.5 text-[9px] py-0 px-1 bg-green-500/15 text-green-600 border-green-500/30">
                Cheapest
              </Badge>
            )}
            {entry.ratesSource === 'default' && (
              <Badge variant="outline" className="ml-1 text-[9px] py-0 px-1 text-muted-foreground border-dashed">
                est.
              </Badge>
            )}
          </div>
        </td>
        <td className="py-2 px-2 text-right tabular-nums font-mono text-[11px]">
          {fmtRate(entry.avgMhrUsd)}
        </td>
        <td className="py-2 px-2 text-right tabular-nums font-mono text-[11px]">
          {fmtRate(entry.avgLhrUsd)}
        </td>
        <td className="py-2 px-2 text-right tabular-nums font-mono font-medium">
          {fmtUsd(entry.processCostUsd)}
        </td>
        <td className="py-2 px-2 text-right tabular-nums font-mono font-semibold">
          {fmtUsd(entry.totalMfgCostUsd)}
        </td>
        <td className="py-2 px-2 text-right tabular-nums">
          {rank === 0 ? (
            <span className="text-muted-foreground">base</span>
          ) : entry.vsCurrentPct > 0 ? (
            <span className="text-red-500">+{entry.vsCurrentPct.toFixed(1)}%</span>
          ) : (
            <span className="text-green-500">{entry.vsCurrentPct.toFixed(1)}%</span>
          )}
        </td>
        <td className="py-2 px-4">
          <div className="w-full bg-muted rounded-full h-1.5">
            <div
              className="h-1.5 rounded-full bg-primary/70 transition-all"
              style={{ width: `${barWidth}%` }}
            />
          </div>
        </td>
      </tr>

      {/* Expanded: per-operation rows */}
      {isExpanded && entry.processLines.map((pl, i) => (
        <tr key={i} className="bg-muted/30 text-[10px] text-muted-foreground">
          <td className="py-1.5 pl-11 pr-2">
            <span className="font-medium text-foreground">{pl.operation || '—'}</span>
            <span className="ml-2 text-[9px] opacity-70">{pl.processGroup}</span>
          </td>
          <td className="py-1.5 px-2 text-right tabular-nums font-mono">
            {fmtRate(pl.mhrUsd)}
          </td>
          <td className="py-1.5 px-2 text-right tabular-nums font-mono">
            {fmtRate(pl.lhrUsd)}
          </td>
          <td className="py-1.5 px-2 text-right tabular-nums font-mono">
            {fmtUsd(pl.cycleCostUsd)}
          </td>
          <td className="py-1.5 px-2 text-right tabular-nums font-mono font-medium">
            {fmtUsd(pl.totalCostUsd)}
          </td>
          <td className="py-1.5 px-2" />
          <td className="py-1.5 px-4" />
        </tr>
      ))}
    </>
  );
};

// ── Main panel ────────────────────────────────────────────────────────────────

interface Props {
  bomItemId: string;
  bomId?: string;
  location?: string;
  // BOM view: parallel results from sibling items (keyed by bomItemId)
  bomLocationData?: Map<string, { location: string; totalMfgCostUsd: number; sellingPriceUsd: number; currencySymbol: string }[]>;
}

export const LocationComparisonPanel: React.FC<Props> = ({
  bomItemId,
  bomId,
  location,
  bomLocationData,
}) => {
  const [view, setView]         = useState<'part' | 'bom'>('part');
  const [expandedLoc, setExpandedLoc] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useLocationComparison(bomItemId);

  const handleToggle = (loc: string) =>
    setExpandedLoc(prev => (prev === loc ? null : loc));

  // BOM aggregate: merge all bomLocationData across bomItemIds
  const bomRows = useMemo<BomLocationRow[]>(() => {
    if (!bomLocationData || bomLocationData.size === 0) return [];
    const totals = new Map<string, { totalMfgCostUsd: number; sellingPriceUsd: number; currencySymbol: string }>();
    for (const rows of bomLocationData.values()) {
      for (const row of rows) {
        const existing = totals.get(row.location) ?? { totalMfgCostUsd: 0, sellingPriceUsd: 0, currencySymbol: row.currencySymbol };
        existing.totalMfgCostUsd += row.totalMfgCostUsd;
        existing.sellingPriceUsd += row.sellingPriceUsd;
        totals.set(row.location, existing);
      }
    }
    const sorted = [...totals.entries()].sort((a, b) => a[1].totalMfgCostUsd - b[1].totalMfgCostUsd);
    const baseUsd = sorted[0]?.[1].totalMfgCostUsd ?? 1;
    return sorted.map(([loc, val]) => ({
      location: loc,
      currencySymbol: val.currencySymbol,
      totalMfgCostUsd: val.totalMfgCostUsd,
      sellingPriceUsd: val.sellingPriceUsd,
      vsLowestPct: baseUsd > 0 ? ((val.totalMfgCostUsd - baseUsd) / baseUsd) * 100 : 0,
    }));
  }, [bomLocationData]);

  const hasBomView = bomId && bomLocationData && bomLocationData.size > 0;
  const maxCost    = data ? Math.max(...data.locations.map(l => l.totalMfgCostUsd)) : 0;

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-primary" />
            Digital Factory — Location Cost Comparison
            {data?.cheapestLocation && (
              <Badge variant="secondary" className="ml-2 text-[10px] py-0 px-1.5 bg-green-500/15 text-green-600 border-green-500/30">
                Best: {LOCATION_FLAGS[data.cheapestLocation]} {data.cheapestLocation}
              </Badge>
            )}
          </CardTitle>

          {hasBomView && (
            <div className="flex items-center rounded-md border border-border overflow-hidden text-xs">
              <button
                onClick={() => setView('part')}
                className={`px-3 py-1 transition-colors ${view === 'part' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'}`}
              >
                Part
              </button>
              <button
                onClick={() => setView('bom')}
                className={`px-3 py-1 transition-colors ${view === 'bom' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'}`}
              >
                Full BOM
              </button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="px-0 pb-0">

        {/* ── Loading ── */}
        {isLoading && view === 'part' && (
          <div className="py-8 text-center">
            <RefreshCw className="w-6 h-6 mx-auto text-primary animate-spin mb-2" />
            <p className="text-xs text-muted-foreground">Computing location comparison…</p>
          </div>
        )}

        {/* ── Error ── */}
        {error && view === 'part' && (
          <div className="py-8 text-center">
            <AlertCircle className="w-6 h-6 mx-auto text-muted-foreground mb-2" />
            <p className="text-xs text-muted-foreground mb-2">
              {(error as Error).message?.includes('apply a route')
                ? 'Apply a process route first to enable location comparison.'
                : 'Could not load location data.'}
            </p>
            <button onClick={() => refetch()} className="text-xs text-primary underline underline-offset-2">
              Retry
            </button>
          </div>
        )}

        {/* ── Part view ── */}
        {!isLoading && !error && data && view === 'part' && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left py-2 px-4 font-medium text-muted-foreground">Location</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Avg MHR</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Avg LHR</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Process Cost</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Total Mfg</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">vs Cheapest</th>
                  <th className="py-2 px-4 font-medium text-muted-foreground min-w-[120px]">Cost Bar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {data.locations.map((entry, i) => (
                  <LocationRow
                    key={entry.location}
                    entry={entry}
                    rank={i}
                    isExpanded={expandedLoc === entry.location}
                    onToggle={() => handleToggle(entry.location)}
                    maxCost={maxCost}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-muted/20">
                  <td colSpan={7} className="py-2 px-4 text-[10px] text-muted-foreground">
                    Click any row to drill into per-operation rates at that location.
                    {data.locations.some(l => l.ratesSource === 'default') && (
                      <> · <span className="border border-dashed border-muted-foreground/50 rounded px-1">est.</span> = fallback industry rates (add MHR records for live data)</>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* ── BOM view ── */}
        {view === 'bom' && hasBomView && bomRows.length > 0 && (
          <BomAggregateView rows={bomRows} />
        )}

        {view === 'bom' && hasBomView && bomRows.length === 0 && (
          <div className="py-8 text-center">
            <p className="text-xs text-muted-foreground">Select costed BOM items to see BOM-level comparison.</p>
          </div>
        )}

      </CardContent>
    </Card>
  );
};
