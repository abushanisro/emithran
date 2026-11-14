'use client';

import { type PartSummary, usePartSummary } from '@/lib/api/hooks/useBOMItems';

// The Part Summary tab: six panels (component, production and material information; cost by category; cost by process; component costs and targets) under a banner that says
// when the part has operations that failed to cost. Every value is the part summary the backend projects from the applied cost table; a value the model does not hold shows a
// dash and says why on hover, never a made-up number.

const number = (n: number | null | undefined, digits = 2): string =>
  n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const integer = (n: number | null | undefined): string => number(n, 0);

/** The text of the banner: what failed to cost, or null when nothing did. */
export function uncostedBanner(summary: PartSummary | undefined, uncostedWarnings: readonly string[]): string | null {
  const names = [...(summary?.uncosted ?? [])];
  const count = names.length + uncostedWarnings.length;
  if (count === 0) return null;
  return `Part has ${count === 1 ? 'an operation' : `${count} operations`} that failed to cost. ` +
    `${names.length > 0 ? `${names.join(', ')}: no cost was applied. ` : ''}The Cost tab lists the warning for each.`;
}

// A titled card. The grid that holds the panels sizes its columns from the width it is given (not the viewport: the
// tab sits in a resizable pane), so the panels go three, two or one across and no value is ever pushed out of its box.
function Panel({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-md border border-border bg-card/40 ${className}`}>
      <h3 className="border-b border-border/60 px-3 py-1.5 text-[11px] font-semibold tracking-wide">{title}</h3>
      <div className="px-3 py-1.5">{children}</div>
    </section>
  );
}

function Line({ label, value, why }: { label: string; value: React.ReactNode; why?: string | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-[11px]" title={why}>
      <span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{label}</span>
      <span className={`shrink-0 max-w-[60%] text-right tabular-nums [overflow-wrap:anywhere] ${value === '—' ? 'text-muted-foreground' : ''}`}>{value}</span>
    </div>
  );
}

/** One colour per cost category, the same in the stacked bar, the rows and their swatches; readable on a light and a dark card. */
const CATEGORY_COLOR: Record<PartSummary['costByCategory'][number]['key'], string> = {
  material: '#3b82f6', labor: '#f59e0b', overhead: '#8b5cf6', setup: '#14b8a6', investment: '#ec4899', other: '#94a3b8',
};
const PROCESS_COLOR = '#0ea5e9';

const share = (pct: number | null) => `${Math.max(0, Math.min(100, pct ?? 0))}%`;

/** A share of the whole as a bar: the track is the whole, the fill the share. */
function Bar({ pct, color, label }: { pct: number | null; color: string; label: string }) {
  return (
    <span className="block h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted/60" role="img" aria-label={`${label} ${pct ?? 0} percent`}>
      <span className="block h-full rounded-full" style={{ width: share(pct), backgroundColor: color }} />
    </span>
  );
}

export function PartSummaryView({ summary, uncostedWarnings = [] }: { summary: PartSummary; uncostedWarnings?: readonly string[] }) {
  const banner = uncostedBanner(summary, uncostedWarnings);
  const { component: c, production: p, material: m, costs, notModelled: why } = summary;
  const applied = summary.basis === 'applied';
  const categories = summary.costByCategory;
  return (
    <div className="p-3 space-y-3">
      {banner && <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-bold text-red-600 dark:text-red-400">{banner}</p>}
      {!applied && <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] font-semibold text-amber-600 dark:text-amber-400">Nothing has been applied to this part yet: apply the scenario to see its costs.</p>}

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr))]">
        <Panel title="Component Information">
          <Line label="Rough Mass (kg)" value={number(c.roughMassKg, 2)} />
          <Line label="Finish Mass (kg)" value={number(c.finishMassKg, 2)} />
          <Line label="Length (mm)" value={number(c.lengthMm)} />
          <Line label="Width (mm)" value={number(c.widthMm)} />
          <Line label="Height (mm)" value={number(c.heightMm)} />
          <Line label="Surface Area (mm^2)" value={number(c.surfaceAreaMm2)} />
          <Line label="Volume (mm^3)" value={number(c.volumeMm3)} />
        </Panel>

        <Panel title="Production Information">
          <div className="text-[11px] py-1">
            <div className="text-muted-foreground">Digital Factories</div>
            <div className="pl-3 space-y-0.5">
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">-Primary:</span><span>{p.digitalFactory.primary ?? '—'}</span></div>
              <div className="flex justify-between gap-3" title={why.secondaryFactory}><span className="text-muted-foreground">-Secondary:</span><span className="text-muted-foreground">{p.digitalFactory.secondary ?? '—'}</span></div>
              <div className="flex justify-between gap-3" title={why.toolshop}><span className="text-muted-foreground">-Toolshop:</span><span className="text-muted-foreground">{p.digitalFactory.toolshop ?? '—'}</span></div>
            </div>
          </div>
          <Line label="Annual Volume" value={integer(p.annualVolume)} />
          <Line label="Batch Size" value={integer(p.batchSize)} />
          <Line label="Production Life" value={number(p.productionLifeYears, 2)} />
          <Line label="Lifetime Volume" value={integer(p.lifetimeVolume)} />
        </Panel>

        <Panel title="Material Information">
          <Line label="Material Catalog:" value={m.catalog ?? '—'} />
          <Line label="Material:" value={m.name ?? '—'} />
          <Line label="Stock:" value={m.stock ?? <span className="text-muted-foreground">N/A</span>} why={why.stock} />
          <Line label="Utilization (%)" value={number(m.utilizationPct, 2)} />
          <Line label="Unit Cost (USD / kg)" value={number(m.unitCostUsdPerKg, 3)} />
        </Panel>

        <Panel title="Cost by Category (%)">
          {categories.length === 0 && <p className="py-2 text-[11px] text-muted-foreground">No cost applied.</p>}
          {categories.length > 0 && (
            // The piece part cost as one bar, split by category: what the rows below add up to.
            <div className="my-1.5 flex h-2.5 overflow-hidden rounded-full bg-muted/60" role="img" aria-label="Piece part cost by category">
              {categories.filter((row) => (row.pct ?? 0) > 0).map((row) => (
                <span key={row.key} className="h-full" style={{ flexBasis: share(row.pct), backgroundColor: CATEGORY_COLOR[row.key] }} title={`${row.label}: ${number(row.pct, 1)}%`} />
              ))}
            </div>
          )}
          {categories.map((row) => (
            <div key={row.key} className="flex items-center gap-2 py-1 text-[11px]" title={`${row.label}: ${number(row.usd, 4)} USD per part`}>
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: CATEGORY_COLOR[row.key] }} aria-hidden />
              <span className="w-[4.75rem] shrink-0 text-muted-foreground">{row.label}:</span>
              <Bar pct={row.pct} color={CATEGORY_COLOR[row.key]} label={row.label} />
              <span className="w-10 shrink-0 text-right tabular-nums">{number(row.pct, 1)}</span>
            </div>
          ))}
        </Panel>

        <Panel title="Cost by Process (%)">
          <table className="w-full table-fixed text-[11px]">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground"><th className="py-1 font-normal">Process</th><th className="py-1 font-normal text-right w-12">%</th></tr>
            </thead>
            <tbody>
              {summary.costByProcess.map((row) => (
                <tr key={row.process} className="border-b border-border/40 last:border-b-0" title={`${number(row.usd, 4)} USD per part`}>
                  <td className="py-1 pr-2">
                    <span className="block [overflow-wrap:anywhere]">{row.process}</span>
                    <span className="mt-0.5 flex"><Bar pct={row.pct} color={PROCESS_COLOR} label={row.process} /></span>
                  </td>
                  <td className="py-1 text-right align-top tabular-nums">{number(row.pct, 1)}</td>
                </tr>
              ))}
              {summary.costByProcess.length === 0 && <tr><td className="py-2 text-muted-foreground" colSpan={2}>No process applied.</td></tr>}
            </tbody>
          </table>
        </Panel>

        <Panel title="Component Costs And Targets">
          <Line label="Piece Part Cost (USD):" value={number(costs.piecePartCostUsd)} />
          <Line label="Fully Burdened Cost (USD):" value={number(costs.fullyBurdenedCostUsd)} why={why.fullyBurdenedCost} />
          <Line label="Total Capital Investments (USD):" value={number(costs.totalCapitalInvestmentsUsd)} />
          <Line label="Target Cost (USD):" value={number(costs.targetCostUsd)} why={why.targetCost} />
          <Line label="% Variance To Target Cost:" value={number(costs.varianceToTargetCostPct, 1)} why={why.targetCost} />
          <Line label="Target Mass (kg):" value={number(costs.targetMassKg)} why={why.targetMass} />
          <Line label="% Variance To Target Mass:" value={number(costs.varianceToTargetMassPct, 1)} why={why.targetMass} />
        </Panel>
      </div>
    </div>
  );
}

/** The tab: loads the summary and says so while it does. */
export function PartSummaryTab({ itemId, uncostedWarnings = [] }: { itemId: string; uncostedWarnings?: readonly string[] }) {
  const { data, isLoading, error } = usePartSummary(itemId);
  if (isLoading) return <p className="p-3 text-[11px] text-muted-foreground">Reading the part summary…</p>;
  if (error || !data) return <p className="p-3 text-[11px] text-muted-foreground">The part summary could not be loaded.</p>;
  return <PartSummaryView summary={data} uncostedWarnings={uncostedWarnings} />;
}
