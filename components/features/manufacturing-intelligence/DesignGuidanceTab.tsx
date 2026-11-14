'use client';

import { Info } from 'lucide-react';
import { useState } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { type DesignGuidance, type DesignGuidanceItem, type DesignGuidanceRange, useDesignGuidance } from '@/lib/api/hooks/useBOMItems';
import type { FeatureNodeV2 } from '@/lib/types/manufacturing';

// The Design Guidance tab: what in the part's design drives its cost, panel by panel (cost drivers, material, thickness, special mold tooling, machining, tolerances,
// setups, holes and fillets, slow operations). Every number is the backend's projection of the CAD analysis, the staged reference data and the applied cost; a value
// none of them holds shows a dash and says why on hover. Review opens the instances behind a number, and choosing one lights it on the model.

const number = (n: number | null | undefined, digits = 2): string =>
  n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const count = (n: number | null | undefined): string => (n == null ? '—' : n.toLocaleString('en-US'));

/** An operation of the live cost, as the Slow Operations panel reads it. */
export interface GuidanceOperation { operation: string; process: string; timeSec: number; count: number }

/** The node the viewer highlights for an item: its feature instances when the analysis has them, its faces otherwise; null when it points at nothing. */
export function guidanceHighlight(item: DesignGuidanceItem, features: readonly FeatureNodeV2[]): FeatureNodeV2 | null {
  const byId = new Map(features.map((f) => [f.id, f]));
  const hit = item.occurrences.flatMap((ref) => {
    const feature = byId.get(ref.featureId);
    const occurrence = feature?.occurrences[ref.occurrenceIndex];
    return feature && occurrence ? [{ feature, occurrence }] : [];
  });
  const first = hit[0];
  if (first) {
    return { id: `guidance_${item.label}`, feature_type: first.feature.feature_type, occurrences: hit.map(({ occurrence }) => ({ centroid: occurrence.centroid, face_ids: occurrence.face_ids })) };
  }
  if (item.faces.length === 0) return null;
  return { id: `guidance_${item.label}`, feature_type: 'Blank', occurrences: [{ centroid: [0, 0, 0], face_ids: item.faces }] };
}

/**
 * Where a value sits between the least and the greatest of the comparable materials, 0 to 1. The scale is logarithmic: prices and densities of a material library span
 * orders of magnitude (a commodity steel to a precious alloy), and on a linear scale every common material would sit in the first segment.
 */
export function rangePosition(r: DesignGuidanceRange): number | null {
  if (r.value == null || r.min == null || r.max == null || r.value <= 0 || r.min <= 0 || r.max <= r.min) return null;
  const p = (Math.log(r.value) - Math.log(r.min)) / (Math.log(r.max) - Math.log(r.min));
  return Math.max(0, Math.min(1, p));
}

/** Ten steps from green (the least of the range) to red (the greatest). */
const SEGMENTS = ['#16a34a', '#4ade80', '#84cc16', '#a3e635', '#facc15', '#fbbf24', '#fb923c', '#f97316', '#ef4444', '#dc2626'];

function RangeBar({ range, digits, label }: { range: DesignGuidanceRange; digits: number; label: string }) {
  const position = rangePosition(range);
  const active = position == null ? -1 : Math.min(SEGMENTS.length - 1, Math.floor(position * SEGMENTS.length));
  return (
    <div className="pb-1.5" role="img" aria-label={position == null ? `${label}: no range` : `${label}: ${Math.round(position * 100)} percent of the way from the least to the greatest comparable material`}>
      <div className="flex h-3 items-end gap-0.5" title="Logarithmic scale, from the least to the greatest of the comparable materials">
        {SEGMENTS.map((color, i) => (
          <span key={color} className={`min-w-0 flex-1 rounded-[2px] ${i === active ? 'h-3 ring-1 ring-foreground/70' : 'h-1.5 opacity-80'}`} style={{ backgroundColor: color }} />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] tabular-nums text-muted-foreground">
        <span>{number(range.min, digits)}</span>
        <span>{number(range.max, digits)}</span>
      </div>
    </div>
  );
}

// ── Help ───────────────────────────────────────────────────────────────────────────────────────────────────────────

type Topic = 'costDrivers' | 'material' | 'thickness' | 'moldTooling' | 'machining' | 'tolerances' | 'setups' | 'holesAndFillets' | 'slowOperations';

const HELP: Record<Topic, { title: string; body: { heading?: string; text: string }[] }> = {
  costDrivers: {
    title: 'Cost Drivers',
    body: [
      { text: 'A cost driver is a feature of the design that makes the part dearer to make than it needs to be: it calls for an extra operation, a slower one, a special tool or a more capable machine.' },
      { text: 'The count is the number of findings of the design checks of the part\'s process, each against a limit of the reference data. Review lists them with the recommendation for each; choosing one lights the faces it is about on the model.' },
    ],
  },
  material: {
    title: 'Material',
    body: [
      { heading: 'Cost / Volume', text: 'The price of the material times its density: what one cubic centimetre of the part costs in this material. It compares materials fairly for a fixed shape, where a price per kilogram does not (a light, dear material can cost less per part than a heavy, cheap one).' },
      { heading: 'Mass', text: 'The part\'s volume in this material.' },
      { heading: 'The bars', text: 'Each bar runs from the least to the greatest value among the library materials the part\'s process draws from, on a logarithmic scale. The raised segment is where this material sits. Toward green, most alternatives cost (or weigh) more; toward red, most cost less.' },
    ],
  },
  thickness: {
    title: 'Thickness',
    body: [
      { text: 'The recommended minimum and maximum are the wall the process and the material are advised to stay within, read from the process\'s own table. Below the minimum a wall may not fill, or deflects under a cutter; above the maximum it cools slowly, sinks, or holds porosity.' },
      { heading: 'Part Max/Min Ratio', text: 'The thickest wall over the thinnest. A part formed in a mold or die wants an even wall: the thick sections set the cycle time and pull against the thin ones as they cool. The nearer the ratio is to 1 the better.' },
    ],
  },
  moldTooling: {
    title: 'Special Mold Tooling',
    body: [
      { heading: 'Undercuts', text: 'An undercut is a feature the tool cannot release by opening in its draw direction: a side hole, a snap hook, a recess facing sideways. The tool needs a moving member to form it, which adds to the tool\'s cost, its size and its maintenance. Remove an undercut wherever the design allows.' },
      { heading: 'Slides', text: 'A slide forms an undercut on the outside of the part. It moves in from the side as the tool closes and out again before the part is ejected.' },
      { heading: 'Lifters', text: 'A lifter forms an undercut the ejection can release: it rides up with the ejectors at an angle and steps clear of the feature. It is used where a slide has no room.' },
      { heading: 'Cores', text: 'A core forms a cavity inside the part that the two halves of the tool cannot reach. In a sand mold a core is a separate sand shape set into the mold for each casting.' },
    ],
  },
  machining: {
    title: 'Machining',
    body: [
      { heading: 'Routing', text: 'The machining operations of the applied cost, in order.' },
      { heading: 'Machining Scrap', text: 'The share of the stock that is cut away as chips. A high share is material bought and then machined off: a nearer-net stock, or a different primary process, may cost less.' },
      { heading: 'Machined Features', text: 'On a machined part, every feature. On a cast or molded part, the features the primary process cannot form or cannot hold to tolerance, which are machined afterwards.' },
    ],
  },
  tolerances: {
    title: 'Tolerances and Finishing Operations',
    body: [
      { text: 'A tolerance tighter than the primary process holds costs an operation. The first count is the features carrying a tolerance requirement (from the model, the drawing, or the part\'s tolerance policy).' },
      { heading: 'Driving machining', text: 'Features whose tolerance the primary process cannot hold, so they are machined after it.' },
      { heading: 'Driving specialized finishing', text: 'Features whose tolerance only an abrasive process holds (grinding, honing, lapping): a further, slower operation on a separate machine.' },
    ],
  },
  setups: {
    title: 'Machining Setups',
    body: [
      { text: 'A setup is one direction the part is approached from. Each setup beyond the first means the part is re-fixtured or the table is indexed, and each adds setup time and a chance of error between the features of one setup and the next.' },
      { text: 'An oblique setup is not square to the part\'s main directions: it needs a tilting table or an angled fixture, and so a more capable machine.' },
      { heading: 'Setups with few features', text: 'A setup that reaches only a few features is worth a second look: moving those features to a direction another setup already uses removes it.' },
    ],
  },
  holesAndFillets: {
    title: 'Machined Holes and Fillets',
    body: [
      { text: 'Every distinct hole diameter is a drill to stock, to load and to change to. Every distinct fillet radius in a corner is a cutter of that radius. Fewer sizes mean fewer tools and fewer tool changes.' },
      { heading: 'Non-standard tools', text: 'A hole whose diameter is not on the standard drill chart needs a special drill, or is bored or interpolated instead: slower and dearer than drilling.' },
    ],
  },
  slowOperations: {
    title: 'Slow Operations',
    body: [
      { text: 'The operations of the current cost by the share of the cycle each takes, longest first. The features behind the longest are where a design change saves the most machine time.' },
    ],
  },
};

// A side view of a part with a side hole in a tool that opens upward: the hole is the undercut, and the slide is what forms it.
function UndercutFigure() {
  return (
    <svg viewBox="0 0 320 130" className="mx-auto my-2 h-28 w-full max-w-sm" role="img" aria-label="A part with a side hole: the tool opens upward, so a slide moving sideways forms the hole">
      <rect x="20" y="92" width="200" height="22" rx="2" className="fill-muted stroke-border" />
      <text x="120" y="107" textAnchor="middle" className="fill-muted-foreground text-[9px]">core half</text>
      <path d="M70 92 V40 H170 V92 H150 V58 H90 V92 Z" className="fill-emerald-500/60 stroke-emerald-700" />
      <rect x="150" y="66" width="20" height="10" className="fill-background stroke-emerald-700" />
      <rect x="176" y="60" width="62" height="22" rx="2" className="fill-sky-500/50 stroke-sky-700" />
      <rect x="152" y="67" width="26" height="8" className="fill-sky-500/50 stroke-sky-700" />
      <text x="207" y="74" textAnchor="middle" className="fill-foreground text-[9px]">slide</text>
      <path d="M244 71 H276 M270 66 L277 71 L270 76" className="fill-none stroke-sky-700" strokeWidth="1.5" />
      <path d="M120 34 V10 M115 16 L120 9 L125 16" className="fill-none stroke-foreground" strokeWidth="1.5" />
      <text x="128" y="16" className="fill-foreground text-[9px]">draw direction</text>
      <text x="62" y="70" textAnchor="end" className="fill-foreground text-[9px]">part</text>
      <text x="160" y="100" textAnchor="middle" className="fill-muted-foreground text-[8px]">side hole = undercut</text>
    </svg>
  );
}

// ── Panels ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const SEVERITY_DOT: Record<string, string> = { critical: 'bg-red-500', major: 'bg-amber-500', minor: 'bg-sky-500' };

function Panel({ title, topic, onHelp, children }: { title: string; topic: Topic; onHelp: (t: Topic) => void; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-md border border-border bg-card/40">
      <h3 className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5 text-[11px] font-semibold tracking-wide">
        <span className="min-w-0 [overflow-wrap:anywhere]">{title}</span>
        <button type="button" onClick={() => { onHelp(topic); }} aria-label={`About ${title}`} className="shrink-0 rounded-full p-0.5 text-sky-600 hover:bg-sky-500/10 dark:text-sky-400">
          <Info className="h-3.5 w-3.5" />
        </button>
      </h3>
      <div className="px-3 py-1.5">{children}</div>
    </section>
  );
}

interface Review { key: string; items: DesignGuidanceItem[] }

function Row({ label, value, why, review, open, onReview }: {
  label: string; value: React.ReactNode; why?: string | undefined; review?: Review | undefined; open?: string | null; onReview?: (key: string) => void;
}) {
  const canReview = !!review && review.items.length > 0 && !!onReview;
  return (
    <div className="flex items-center justify-between gap-2 py-1 text-[11px]" title={why}>
      <span className="min-w-0 flex-1 text-muted-foreground [overflow-wrap:anywhere]">{label}</span>
      <span className={`shrink-0 max-w-[55%] text-right font-medium tabular-nums [overflow-wrap:anywhere] ${value === '—' ? 'font-normal text-muted-foreground' : ''}`}>{value}</span>
      {review && (
        <button type="button" disabled={!canReview} onClick={() => onReview?.(review.key)} aria-expanded={open === review.key}
          className={`shrink-0 rounded border px-2 py-0.5 text-[10px] font-medium transition-colors ${open === review.key ? 'border-brand-500 bg-brand-500/10 text-brand-600 dark:text-brand-400' : 'border-border hover:bg-muted/60'} disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent`}>
          Review
        </button>
      )}
    </div>
  );
}

function ReviewList({ items, selected, onSelect }: { items: DesignGuidanceItem[]; selected: string | null; onSelect: (item: DesignGuidanceItem) => void }) {
  return (
    <ul className="my-1 max-h-56 space-y-1 overflow-y-auto rounded border border-border/60 bg-background/60 p-1.5">
      {items.map((item, i) => {
        const key = `${i}:${item.label}`;
        const pointsAtModel = item.occurrences.length > 0 || item.faces.length > 0;
        return (
          <li key={key}>
            <button type="button" onClick={() => { onSelect(item); }} aria-pressed={selected === item.label}
              className={`flex w-full items-start gap-2 rounded px-1.5 py-1 text-left text-[11px] ${selected === item.label ? 'bg-brand-500/15' : 'hover:bg-muted/60'}`}>
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${(item.severity && SEVERITY_DOT[item.severity]) ?? 'bg-muted-foreground/50'}`} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block [overflow-wrap:anywhere]">{item.label}</span>
                {item.detail && <span className="block text-[10px] text-muted-foreground [overflow-wrap:anywhere]">{item.detail}</span>}
                {!pointsAtModel && <span className="block text-[10px] text-muted-foreground">About the part as a whole: nothing to light on the model.</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function DesignGuidanceView({ guidance: g, features = [], operations = [], onSelectHighlight }: {
  guidance: DesignGuidance; features?: readonly FeatureNodeV2[]; operations?: readonly GuidanceOperation[]; onSelectHighlight?: ((node: FeatureNodeV2 | null) => void) | undefined;
}) {
  const [help, setHelp] = useState<Topic | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const why = g.notModelled;

  const review = (key: string) => {
    setSelected(null);
    onSelectHighlight?.(null);
    setOpen((cur) => (cur === key ? null : key));
  };
  const select = (item: DesignGuidanceItem) => {
    if (selected === item.label) { setSelected(null); onSelectHighlight?.(null); return; }
    setSelected(item.label);
    onSelectHighlight?.(guidanceHighlight(item, features));
  };
  const rowProps = { open, onReview: review };
  const list = (key: string, items: DesignGuidanceItem[]) => (open === key && items.length > 0 ? <ReviewList items={items} selected={selected} onSelect={select} /> : null);

  const totalSec = operations.reduce((s, o) => s + o.timeSec, 0);
  const slow = [...operations].sort((a, b) => b.timeSec - a.timeSec).slice(0, 6);
  const m = g.material;

  return (
    <div className="space-y-3 p-3">
      <p className="text-[11px] text-muted-foreground">
        {g.processGroup ?? 'No process'} · read from the CAD analysis, the reference limits and the applied cost. Review opens what a number counts; choose a line to see it on the model.
      </p>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr))]">
        <Panel title="Cost Drivers" topic="costDrivers" onHelp={setHelp}>
          <p className="pb-1 text-[10px] text-muted-foreground">Issues that may add cost through extra or specialized operations.</p>
          <Row label="Potential Cost Drivers" value={count(g.costDrivers.count)} why={why.costDrivers} review={{ key: 'costDrivers', items: g.costDrivers.items }} {...rowProps} />
          {list('costDrivers', g.costDrivers.items)}
        </Panel>

        <Panel title="Material" topic="material" onHelp={setHelp}>
          <Row label="Material Name" value={m.name ?? '—'} why={why.materialValue} />
          <Row label={`Cost/Volume (${m.currency} / cm³)`} value={number(m.costPerCm3.value, 4)} why={why.materialValue ?? why.materialRange} />
          <RangeBar range={m.costPerCm3} digits={4} label="Cost per volume" />
          <Row label="Mass (kg)" value={number(m.massKg.value, 4)} why={why.materialValue ?? why.materialRange} />
          <RangeBar range={m.massKg} digits={4} label="Mass" />
          <p className="text-[10px] text-muted-foreground">
            {m.comparedWith > 0 ? `Range over ${m.comparedWith.toLocaleString('en-US')} library materials (${m.comparedGroups.join(', ')}).` : why.materialRange}
          </p>
        </Panel>

        <Panel title="Thickness" topic="thickness" onHelp={setHelp}>
          <Row label="Recommended Maximum (mm)" value={number(g.thickness.recommendedMaxMm, 3)} why={why.thicknessRecommendedMax ?? g.thickness.source ?? undefined} />
          <Row label="Recommended Minimum (mm)" value={number(g.thickness.recommendedMinMm, 3)} why={why.thicknessRecommendedMin ?? g.thickness.source ?? undefined} />
          <Row label="Part Maximum (mm)" value={number(g.thickness.partMaxMm, 3)} why={why.thicknessMeasured} />
          <Row label="Part Minimum (mm)" value={number(g.thickness.partMinMm, 3)} why={why.thicknessMeasured} />
          <Row label="Part Max/Min Ratio" value={number(g.thickness.maxMinRatio, 3)} why={why.thicknessMeasured} review={{ key: 'thickness', items: g.thickness.items }} {...rowProps} />
          {list('thickness', g.thickness.items)}
          {g.thickness.source && <p className="text-[10px] text-muted-foreground [overflow-wrap:anywhere]">Limits: {g.thickness.source}</p>}
        </Panel>

        {g.moldTooling && (
          <Panel title="Special Mold Tooling" topic="moldTooling" onHelp={setHelp}>
            <Row label="Slides" value={count(g.moldTooling.slides)} />
            <Row label="Lifters" value={count(g.moldTooling.lifters)} why={why.lifters} />
            <Row label="Cores" value={count(g.moldTooling.cores)} why={why.cores} />
          </Panel>
        )}

        {g.machining && (
          <Panel title="Machining" topic="machining" onHelp={setHelp}>
            <Row label="Routing" value={g.machining.routing ?? '—'} why={why.routing} />
            <Row label="Machining Scrap (%)" value={number(g.machining.scrapPct, 1)} why={why.machiningScrap} />
            <Row label="Machined Features" value={count(g.machining.machinedFeatures)} why={why.machinedFeatures} review={{ key: 'machined', items: g.machining.items }} {...rowProps} />
            {list('machined', g.machining.items)}
          </Panel>
        )}

        <Panel title="Tolerances and Finishing Operations" topic="tolerances" onHelp={setHelp}>
          <Row label="Features with tolerances" value={count(g.tolerances.withTolerances)} why={why.tolerances} review={{ key: 'toleranced', items: g.tolerances.items }} {...rowProps} />
          {list('toleranced', g.tolerances.items)}
          <Row label="Driving machining" value={count(g.tolerances.drivingMachining)} why={why.drivingMachining} review={{ key: 'drivingMachining', items: g.tolerances.machiningItems }} {...rowProps} />
          {list('drivingMachining', g.tolerances.machiningItems)}
          <Row label="Driving specialized finishing" value={count(g.tolerances.drivingFinishing)} why={why.drivingFinishing} review={{ key: 'drivingFinishing', items: g.tolerances.finishingItems }} {...rowProps} />
          {list('drivingFinishing', g.tolerances.finishingItems)}
        </Panel>

        {g.setups && (
          <Panel title="Machining Setups" topic="setups" onHelp={setHelp}>
            <Row label="Setups" value={count(g.setups.count)} why={why.setups} review={{ key: 'setups', items: g.setups.items }} {...rowProps} />
            {list('setups', g.setups.items)}
            <Row label="Perpendicular / oblique" value={g.setups.count == null ? '—' : `${count(g.setups.perpendicular)} / ${count(g.setups.oblique)}`} why={why.setups} />
            <Row label={`Setups with fewer than ${g.setups.fewFeatureLimit} features`} value={count(g.setups.fewFeatureSetups)} why={why.setups} />
          </Panel>
        )}

        {g.holesAndFillets && (
          <Panel title="Machined Holes and Fillets" topic="holesAndFillets" onHelp={setHelp}>
            <Row label="Distinct hole diameters" value={count(g.holesAndFillets.holeDiametersMm.length)} review={{ key: 'holes', items: g.holesAndFillets.holeItems }} {...rowProps} />
            {list('holes', g.holesAndFillets.holeItems)}
            <Row label="Distinct fillet radii" value={count(g.holesAndFillets.filletRadiiMm.length)} review={{ key: 'fillets', items: g.holesAndFillets.filletItems }} {...rowProps} />
            {list('fillets', g.holesAndFillets.filletItems)}
            <Row label="Non-standard tools" value={count(g.holesAndFillets.nonStandardTools)} why={why.nonStandardTools} review={{ key: 'nonStandard', items: g.holesAndFillets.nonStandardItems }} {...rowProps} />
            {list('nonStandard', g.holesAndFillets.nonStandardItems)}
          </Panel>
        )}

        <Panel title="Slow Operations – Cycle Time Contribution" topic="slowOperations" onHelp={setHelp}>
          {slow.length === 0 || totalSec <= 0 ? (
            <p className="py-1 text-[11px] text-muted-foreground">The current cost lists no operation times for this process.</p>
          ) : (
            <ul className="space-y-1.5 py-1">
              {slow.map((o, i) => {
                const pct = Math.round((o.timeSec / totalSec) * 1000) / 10;
                return (
                  <li key={`${i}:${o.operation}`} className="text-[11px]">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 [overflow-wrap:anywhere]">{o.operation}{o.count > 1 ? ` × ${o.count}` : ''} <span className="text-muted-foreground">· {o.process}</span></span>
                      <span className="shrink-0 tabular-nums">{number(pct, 1)}% · {number(o.timeSec, 0)} s</span>
                    </div>
                    <span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-muted/60" role="img" aria-label={`${o.operation} ${pct} percent of the cycle`}>
                      <span className="block h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: SEGMENTS[Math.min(SEGMENTS.length - 1, Math.floor(pct / 10))] }} />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <Dialog open={help != null} onOpenChange={(o) => { if (!o) setHelp(null); }}>
        <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto">
          {help && (
            <>
              <DialogHeader>
                <DialogTitle className="text-sm">{HELP[help].title}</DialogTitle>
                <DialogDescription className="sr-only">What the {HELP[help].title} panel shows and why it matters for cost.</DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-xs leading-relaxed">
                {help === 'moldTooling' && <UndercutFigure />}
                {HELP[help].body.map((b) => (
                  <p key={b.text}>{b.heading && <span className="font-semibold">{b.heading}. </span>}{b.text}</p>
                ))}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function DesignGuidanceTab({ itemId, features, operations, onSelectHighlight }: {
  itemId: string; features?: readonly FeatureNodeV2[]; operations?: readonly GuidanceOperation[]; onSelectHighlight?: ((node: FeatureNodeV2 | null) => void) | undefined;
}) {
  const { data, isLoading, error } = useDesignGuidance(itemId);
  if (isLoading) return <p className="p-3 text-[11px] text-muted-foreground">Reading the design guidance…</p>;
  if (error || !data) return <p className="p-3 text-[11px] text-muted-foreground">The design guidance could not be loaded.</p>;
  return <DesignGuidanceView guidance={data} features={features ?? []} operations={operations ?? []} onSelectHighlight={onSelectHighlight} />;
}
