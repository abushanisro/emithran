'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Cpu, AlertCircle, Maximize2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { BOMItem } from '@/lib/api/hooks/useBOMItems';
import type {
  FeatureGraph,
  FeatureGraphSummary,
  ProcessRecommendation,
  FamilyClassification,
  FeatureSelection,
} from '@/lib/types/manufacturing';

interface Props {
  item: BOMItem;
  onFeatureSelect?: (selection: FeatureSelection) => void;
  projectId?: string;
  bomId?: string;
}

function buildSummaryFromItem(item: BOMItem): FeatureGraphSummary {
  return {
    bendCount: item.bendCount ?? 0,
    cutLengthMm: item.cutLengthMm ?? 0,
    holeCount: item.holeCount ?? 0,
    sheetThicknessMm: item.sheetThicknessMm ?? 0,
    slotCount: 0,
    pierceCount: item.pierceCount ?? 0,
    flatPatternAreaMm2: item.flatPatternAreaMm2 ?? 0,
  };
}

function fmt(n: number | undefined | null, decimals = 1): string {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

function fmtInt(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('en-IN');
}

function confidenceColor(c: number): string {
  if (c >= 0.85) return 'text-emerald-600 bg-emerald-50 border-emerald-200';
  if (c >= 0.65) return 'text-amber-600 bg-amber-50 border-amber-200';
  return 'text-red-600 bg-red-50 border-red-200';
}

function familyLabel(family: string): string {
  const map: Record<string, string> = {
    sheet_metal: 'Sheet Metal',
    cnc_milled: 'CNC Milled',
    cnc_turned: 'CNC Turned',
    injection_molded: 'Injection Moulded',
    casting: 'Casting',
    forging: 'Forging',
  };
  return map[family] ?? family;
}

// ── Family Classification Card ────────────────────────────────────────────────

function FamilyClassificationCard({ classification }: { classification: FamilyClassification }) {
  const pct = Math.round(classification.confidence * 100);
  const colorClass = confidenceColor(classification.confidence);

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-violet-500" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Family Classification
          </span>
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${colorClass}`}>
          {pct}% confidence
        </span>
      </div>
      <p className="text-lg font-semibold">{familyLabel(classification.family)}</p>
      {classification.signals?.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {classification.signals.map((s, i) => (
            <Badge key={i} variant="secondary" className="text-xs font-normal">
              {s}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Part Summary Card ─────────────────────────────────────────────────────────

function PartSummaryCard({ item }: { item: BOMItem }) {
  const rows: [string, string][] = [
    ['Finish Mass', item.weight != null ? `${fmt(item.weight, 3)} kg` : '—'],
    ['Length', item.maxLength != null ? `${fmt(item.maxLength, 1)} mm` : '—'],
    ['Width', item.maxWidth != null ? `${fmt(item.maxWidth, 1)} mm` : '—'],
    ['Height', item.maxHeight != null ? `${fmt(item.maxHeight, 1)} mm` : '—'],
    ['Surface Area', item.surfaceArea != null ? `${fmtInt(item.surfaceArea)} mm²` : '—'],
    ['Volume', item.volume != null ? `${fmtInt(item.volume)} mm³` : '—'],
    ['Material', [item.material, item.materialGrade].filter(Boolean).join(' / ') || '—'],
    ['Annual Volume', `${fmtInt(item.annualVolume)} pcs`],
  ];

  return (
    <div className="border rounded-lg p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Part Summary
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-xs font-medium text-right tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ── Collapsible section ───────────────────────────────────────────────────────

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 w-full text-left py-1"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
      </button>
      {open && <div className="ml-5 mt-1 space-y-0.5">{children}</div>}
    </div>
  );
}

function FeatureLine({ label, value, cost }: { label: string; value: string; cost?: string }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="text-xs text-foreground/80 flex-1">{label}</span>
      <span className="text-xs tabular-nums font-medium">{value}</span>
      {cost && (
        <span className="text-xs text-violet-500 tabular-nums">[{cost}]</span>
      )}
    </div>
  );
}

// ── Manufacturing Features Tree ───────────────────────────────────────────────

function SelectableFeatureLine({
  featureId,
  label,
  value,
  cost,
  onFeatureSelect,
}: {
  featureId: string;
  label: string;
  value: string;
  cost?: string;
  onFeatureSelect?: (s: FeatureSelection) => void;
}) {
  const clickable = !!onFeatureSelect;
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => onFeatureSelect?.({ featureId, faces: [], edges: [] })}
      className={`flex items-baseline gap-2 py-0.5 w-full text-left rounded ${
        clickable ? 'hover:bg-primary/10 cursor-pointer px-1 -mx-1' : 'cursor-default'
      }`}
    >
      <span className="text-xs text-foreground/80 flex-1">{label}</span>
      <span className="text-xs tabular-nums font-medium">{value}</span>
      {cost && <span className="text-xs text-violet-500 tabular-nums">[{cost}]</span>}
    </button>
  );
}

function ManufacturingFeaturesTree({
  summary,
  onFeatureSelect,
}: {
  summary: FeatureGraphSummary;
  onFeatureSelect?: (s: FeatureSelection) => void;
}) {
  const isSheetMetal = summary.sheetThicknessMm > 0 || summary.cutLengthMm > 0 || summary.bendCount > 0;

  return (
    <div className="border rounded-lg p-4 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
        Manufacturing Features
      </p>

      {isSheetMetal && (
        <Section title="Sheet Metal">
          {summary.flatPatternAreaMm2 > 0 && (
            <Section title="Flat Pattern" defaultOpen>
              <SelectableFeatureLine featureId="flat_pattern" onFeatureSelect={onFeatureSelect}
                label="Area" value={`${fmtInt(summary.flatPatternAreaMm2)} mm²`} cost="MatCost" />
              {summary.cutLengthMm > 0 && (
                <SelectableFeatureLine featureId="cut_length" onFeatureSelect={onFeatureSelect}
                  label="Cut Length" value={`${fmt(summary.cutLengthMm, 0)} mm`} cost="LaserTime" />
              )}
              {summary.pierceCount > 0 && (
                <SelectableFeatureLine featureId="pierce_count" onFeatureSelect={onFeatureSelect}
                  label="Pierce Count" value={`${fmtInt(summary.pierceCount)}`} cost="PierceTime" />
              )}
            </Section>
          )}

          {summary.bendCount > 0 && (
            <Section title={`Bends (${summary.bendCount})`} defaultOpen>
              {Array.from({ length: summary.bendCount }, (_, i) => (
                <SelectableFeatureLine
                  key={i}
                  featureId={`bend_${i + 1}`}
                  onFeatureSelect={onFeatureSelect}
                  label={`Bend #${i + 1}`}
                  value="—"
                  cost="1 PB hit"
                />
              ))}
            </Section>
          )}

          {summary.holeCount > 0 && (
            <Section title={`Holes (${summary.holeCount})`} defaultOpen>
              <SelectableFeatureLine featureId="holes" onFeatureSelect={onFeatureSelect}
                label={`${summary.holeCount} hole${summary.holeCount !== 1 ? 's' : ''}`}
                value="—" cost="Laser" />
            </Section>
          )}

          {summary.slotCount > 0 && (
            <FeatureLine label="Slots" value={`${fmtInt(summary.slotCount)}`} />
          )}

          {summary.sheetThicknessMm > 0 && (
            <FeatureLine label="Thickness" value={`${fmt(summary.sheetThicknessMm, 1)} mm`} />
          )}
        </Section>
      )}

      {!isSheetMetal && summary.holeCount > 0 && (
        <Section title="Features">
          <SelectableFeatureLine featureId="holes" onFeatureSelect={onFeatureSelect}
            label="Holes" value={`${fmtInt(summary.holeCount)}`} cost="Drilling" />
        </Section>
      )}
    </div>
  );
}

const DRIVER_TYPE_LABEL: Record<string, string> = {
  laser_time: 'Laser Time',
  press_brake_hits: 'PB Hits',
  pierce_count: 'Pierce',
  material_usage: 'Material',
  drill_time: 'Drill Time',
  mill_time: 'Mill Time',
  turn_time: 'Turn Time',
  setup_time: 'Setup',
  inspection_time: 'Inspect',
};

// ── Geometric Cost Drivers Table ──────────────────────────────────────────────

function GeometricCostDriversTable({ summary }: { summary: FeatureGraphSummary }) {
  // Prefer typed cost drivers from featureGraph; fall back to geometric counts
  if (summary.costDrivers && summary.costDrivers.length > 0) {
    return (
      <div className="border rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 bg-muted/40 border-b">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Geometric Cost Drivers
          </p>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="text-left px-4 py-1.5 font-medium">Driver</th>
              <th className="text-left px-4 py-1.5 font-medium">Type</th>
              <th className="text-right px-4 py-1.5 font-medium">Quantity</th>
            </tr>
          </thead>
          <tbody>
            {summary.costDrivers.map((d, i) => (
              <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                <td className="px-4 py-1.5">{d.name}</td>
                <td className="px-4 py-1.5 text-muted-foreground">
                  {d.driverType ? DRIVER_TYPE_LABEL[d.driverType] ?? d.driverType : '—'}
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums font-medium">
                  {d.quantity != null ? `${fmtInt(d.quantity)} ${d.unit}` : `${fmt(d.value, 1)} ${d.unit}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Fallback: geometric counts only (no typed drivers stored yet)
  type Row = { feature: string; property: string; value: string };
  const rows: Row[] = [];
  if (summary.cutLengthMm > 0) rows.push({ feature: 'Flat Pattern', property: 'Cut Length', value: `${fmt(summary.cutLengthMm, 0)} mm` });
  if (summary.flatPatternAreaMm2 > 0) rows.push({ feature: 'Flat Pattern', property: 'Pattern Area', value: `${fmt(summary.flatPatternAreaMm2 / 100, 1)} cm²` });
  if (summary.sheetThicknessMm > 0) rows.push({ feature: 'Sheet', property: 'Thickness', value: `${fmt(summary.sheetThicknessMm, 1)} mm` });
  if (summary.bendCount > 0) rows.push({ feature: 'Bends', property: 'Count (PB hits)', value: `${fmtInt(summary.bendCount)}` });
  if (summary.holeCount > 0) rows.push({ feature: 'Holes', property: 'Count', value: `${fmtInt(summary.holeCount)}` });
  if (summary.pierceCount > 0) rows.push({ feature: 'Pierce Points', property: 'Total', value: `${fmtInt(summary.pierceCount)}` });
  if (summary.slotCount > 0) rows.push({ feature: 'Slots', property: 'Count', value: `${fmtInt(summary.slotCount)}` });

  if (rows.length === 0) return null;

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 bg-muted/40 border-b">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Geometric Cost Drivers
        </p>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="text-left px-4 py-1.5 font-medium">Feature</th>
            <th className="text-left px-4 py-1.5 font-medium">Property</th>
            <th className="text-right px-4 py-1.5 font-medium">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
              <td className="px-4 py-1.5 text-muted-foreground">{r.feature}</td>
              <td className="px-4 py-1.5">{r.property}</td>
              <td className="px-4 py-1.5 text-right tabular-nums font-medium">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Process Routing Card ──────────────────────────────────────────────────────

function ProcessRoutingCard({ recommendations }: { recommendations: ProcessRecommendation[] }) {
  return (
    <div className="border rounded-lg p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Recommended Process Routing
      </p>
      <ol className="space-y-2">
        {recommendations.map((r) => (
          <li key={r.sequence} className="flex items-start gap-3">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center">
              {r.sequence}
            </span>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium">{r.process}</span>
              {r.machine && (
                <span className="ml-2 text-xs text-muted-foreground">· {r.machine}</span>
              )}
              {r.estimated_time_sec != null && (
                <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                  · {fmt(r.estimated_time_sec / 60, 1)} min
                </span>
              )}
            </div>
            {r.status === 'optional' && (
              <Badge variant="outline" className="text-xs font-normal shrink-0">optional</Badge>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState({ item }: { item: BOMItem }) {
  return (
    <div className="border rounded-lg p-8 text-center">
      <AlertCircle className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
      <p className="text-sm font-medium text-muted-foreground">No manufacturing intelligence data</p>
      <p className="text-xs text-muted-foreground mt-1">
        {item.file3dPath
          ? 'Re-run Auto-Fill to extract feature data from this 3D model.'
          : 'Upload a STEP file and run Auto-Fill to analyse this part.'}
      </p>
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

export default function ManufacturingIntelligenceView({ item, onFeatureSelect, projectId, bomId }: Props) {
  const fg = item.featureGraph ?? null;
  const summary = fg?.summary ?? buildSummaryFromItem(item);
  const hasData =
    summary.bendCount > 0 ||
    summary.cutLengthMm > 0 ||
    summary.holeCount > 0 ||
    summary.pierceCount > 0 ||
    summary.flatPatternAreaMm2 > 0;

  const workspaceHref =
    projectId && bomId
      ? `/projects/${projectId}/bom/${bomId}/items/${item.id}/manufacturing-intelligence`
      : null;

  return (
    <div className="p-4 space-y-4">
      {fg?.classification ? (
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <FamilyClassificationCard classification={fg.classification} />
          </div>
          {workspaceHref && (
            <Link
              href={workspaceHref}
              title="Open full workspace"
              className="mt-1 p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <Maximize2 className="h-4 w-4" />
            </Link>
          )}
        </div>
      ) : workspaceHref ? (
        <div className="flex justify-end">
          <Link
            href={workspaceHref}
            title="Open full workspace"
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <Maximize2 className="h-4 w-4" />
          </Link>
        </div>
      ) : null}

      <PartSummaryCard item={item} />

      {hasData ? (
        <>
          <ManufacturingFeaturesTree summary={summary} onFeatureSelect={onFeatureSelect} />
          <GeometricCostDriversTable summary={summary} />
          {fg?.processRecommendations && fg.processRecommendations.length > 0 && (
            <ProcessRoutingCard recommendations={fg.processRecommendations} />
          )}
        </>
      ) : (
        <EmptyState item={item} />
      )}
    </div>
  );
}
