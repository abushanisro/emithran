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

function Panel({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <fieldset className={`min-w-0 border border-border rounded-sm px-3 pb-2 pt-0 ${className}`}>
      <legend className="px-1 text-[11px] font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

function Line({ label, value, why }: { label: string; value: React.ReactNode; why?: string | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-[11px]" title={why}>
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums text-right ${value === '—' ? 'text-muted-foreground' : ''}`}>{value}</span>
    </div>
  );
}

const BAR_COLOR = '#c0502d';

export function PartSummaryView({ summary, uncostedWarnings = [] }: { summary: PartSummary; uncostedWarnings?: readonly string[] }) {
  const banner = uncostedBanner(summary, uncostedWarnings);
  const { component: c, production: p, material: m, costs, notModelled: why } = summary;
  const applied = summary.basis === 'applied';
  return (
    <div className="p-3 space-y-3">
      {banner && <p className="text-[11px] font-bold text-red-600">{banner}</p>}
      {!applied && <p className="text-[11px] font-bold text-amber-600">Nothing has been applied to this part yet: apply the scenario to see its costs.</p>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
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
          <Line label="Stock:" value="" />
          <div className="min-h-[3.5rem] border border-border rounded-sm px-2 py-1 text-[11px]" title={why.stock}>{m.stock ?? <span className="text-muted-foreground">N/A</span>}</div>
          <Line label="Utilization (%)" value={number(m.utilizationPct, 2)} />
          <Line label="Unit Cost (USD / kg)" value={number(m.unitCostUsdPerKg, 3)} />
        </Panel>

        <Panel title="Cost by Category (%)">
          {summary.costByCategory.length === 0 && <p className="py-2 text-[11px] text-muted-foreground">No cost applied.</p>}
          {summary.costByCategory.map((row) => (
            <div key={row.key} className="flex items-center gap-3 py-1 text-[11px]" title={`${row.label}: ${number(row.usd, 4)} USD per part`}>
              <span className="w-20 shrink-0 text-muted-foreground">{row.label}:</span>
              <span className="flex-1 h-2.5 bg-muted/60 rounded-[1px] overflow-hidden" role="img" aria-label={`${row.label} ${row.pct ?? 0} percent`}>
                <span className="block h-full" style={{ width: `${Math.min(100, row.pct ?? 0)}%`, backgroundColor: BAR_COLOR }} />
              </span>
              <span className="w-10 shrink-0 text-right tabular-nums">{number(row.pct, 1)}</span>
            </div>
          ))}
        </Panel>

        <Panel title="Cost by Process (%)">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground"><th className="py-1 font-normal">Process</th><th className="py-1 font-normal text-right w-14">%</th></tr>
            </thead>
            <tbody>
              {summary.costByProcess.map((row) => (
                <tr key={row.process} className="border-b border-border/40" title={`${number(row.usd, 4)} USD per part`}>
                  <td className="py-1">{row.process}</td>
                  <td className="py-1 text-right tabular-nums">{number(row.pct, 1)}</td>
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
