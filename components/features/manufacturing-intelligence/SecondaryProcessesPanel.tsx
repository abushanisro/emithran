'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Check } from 'lucide-react';
import { useSecondaryProcesses, type SecondaryProcessLine } from '@/lib/api/hooks/useSecondaryProcesses';
import { useCreateProcessCost, useProcessCosts } from '@/lib/api/hooks/useProcessCosts';

/** What a clicked row asks the 3D viewer to highlight. */
export interface SecondaryHighlight {
  key: string;
  label: string;
  featureIds: string[];
  wholePart: boolean;
}

const STATUS_STYLE: Record<SecondaryProcessLine['status'], string> = {
  costed: 'text-emerald-500 border-emerald-500/40 bg-emerald-500/10',
  not_applicable: 'text-muted-foreground border-border bg-muted/30',
  gap: 'text-amber-500 border-amber-500/40 bg-amber-500/10',
};
const STATUS_LABEL: Record<SecondaryProcessLine['status'], string> = {
  costed: 'Costed',
  not_applicable: 'Not applicable',
  gap: 'Data gap',
};

const fmtSec = (s: number | null) =>
  s == null ? '—' : s < 60 ? `${s.toFixed(1)} s` : `${(s / 60).toFixed(2)} min`;

/**
 * Every secondary process (inspection, NDT, cleaning, packaging) for this part,
 * from the reference data and the part's CAD facts (GET
 * /bom-items/:id/secondary-processes). Nothing here chooses a time, rate or
 * applicability: each row shows what the backend derived, why, and its trace.
 * "Add to costs" saves the line as a normal process cost record, which is then
 * edited like any other Direct Process Cost.
 */
export function SecondaryProcessesPanel({
  itemId, batchSize, location, onHighlight,
}: {
  itemId: string;
  batchSize: number | undefined;
  location: string;
  onHighlight: (h: SecondaryHighlight | null) => void;
}) {
  const { data, isLoading, error } = useSecondaryProcesses(itemId, batchSize, location);
  const { data: records } = useProcessCosts({ bomItemId: itemId });
  const createProcessCost = useCreateProcessCost();
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  // The process_taxonomy group each line belongs to (migrations 790/818/820).
  const groupOf = (l: SecondaryProcessLine) =>
    l.machineClass.startsWith('surface_') ? 'Surface Treatment'
      : l.machineClass.startsWith('heat_treat_') ? 'Heat Treatment'
        : 'Other Secondary Processes';
  const added = new Set(
    (records?.records ?? [])
      .filter((r) => ['Other Secondary Processes', 'Surface Treatment', 'Heat Treatment'].includes(r.processGroup ?? ''))
      .map((r) => `${r.processGroup}::${r.operation ?? ''}`),
  );

  if (isLoading) return <p className="p-3 text-xs text-muted-foreground">Evaluating secondary processes…</p>;
  if (error || !data) return <p className="p-3 text-xs text-red-500">Could not load secondary processes: {String((error as any)?.message ?? 'unknown error')}</p>;

  const select = (l: SecondaryProcessLine) => {
    const key = `secondary_${l.machineClass}`;
    if (selected === key || l.highlight === 'none') {
      setSelected(null);
      onHighlight(null);
      return;
    }
    setSelected(key);
    onHighlight({ key, label: l.process, featureIds: l.featureIds, wholePart: l.highlight === 'whole_part' });
  };

  const add = (l: SecondaryProcessLine) => {
    if (!l.machine || l.cycleTimeSec == null || l.setupMin == null || l.local.machineRate == null || l.local.laborRate == null || data.batchSize == null) return;
    createProcessCost.mutate({
      bomItemId: itemId,
      processGroup: groupOf(l),
      operation: l.process,
      location,
      mhrId: l.machine.id,
      machineRate: l.local.machineRate,
      directRate: l.local.laborRate,
      laborRate: l.local.laborRate,
      currency: l.local.currency,
      heads: l.machine.operators,
      setupManning: l.machine.operators,
      setupTime: l.setupMin,
      batchSize: data.batchSize,
      cycleTime: l.cycleTimeSec,
      partsPerCycle: 1,
      // Yield loss is already inside cycleTimeSec (divided by good-part yield).
      scrap: 0,
      notes: `${groupOf(l)} from reference data: ${l.trace.map((t) => `${t.label} ${t.value}${t.unit ? ' ' + t.unit : ''}`).join('; ')}`,
    });
  };

  const summary = (lines: SecondaryProcessLine[]) => {
    const c = lines.reduce((acc, l) => ({ ...acc, [l.status]: (acc[l.status] ?? 0) + 1 }), {} as Record<string, number>);
    return `${c.costed ?? 0} costed · ${c.not_applicable ?? 0} not applicable · ${c.gap ?? 0} data gaps`;
  };

  const renderLines = (lines: SecondaryProcessLine[]) => lines.map((l) => {
        const key = `secondary_${l.machineClass}`;
        const isOpen = open === key;
        const isAdded = added.has(`${groupOf(l)}::${l.process}`);
        return (
          <div key={key} className={`border-b ${selected === key ? 'bg-primary/5' : ''}`}>
            <div className="flex items-center gap-2 px-3 py-2">
              <button type="button" onClick={() => setOpen(isOpen ? null : key)} className="text-muted-foreground shrink-0">
                {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => select(l)}
                disabled={l.highlight === 'none'}
                title={l.highlight === 'none' ? 'Nothing to highlight' : l.highlight === 'features' ? 'Highlight the features this process measures' : 'Highlight the part surface'}
                className="flex-1 min-w-0 text-left disabled:cursor-default"
              >
                <div className="text-xs font-medium truncate">
                  {l.process}
                  {data.heatTreatmentCalloutProcess === l.process && (
                    <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-primary/15 text-primary">On drawing</span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {l.machine ? l.machine.name : '—'}
                  {l.status === 'costed' && ` · ${fmtSec(l.cycleTimeSec)}/part`}
                  {l.local.costPerPart != null && ` · ${l.local.currency} ${l.local.costPerPart.toFixed(2)}/part`}
                </div>
              </button>
              <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${STATUS_STYLE[l.status]}`}>{STATUS_LABEL[l.status]}</span>
              {l.status === 'costed' && l.cycleTimeSec == null && (
                <span className="text-[10px] text-muted-foreground shrink-0" title="A per-area priced service, not machine time: it is costed on the quote from the drawing's surface-treatment callout.">Priced service</span>
              )}
              {l.status === 'costed' && l.cycleTimeSec != null && (
                isAdded ? (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-500 shrink-0"><Check className="h-3 w-3" />In costs</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => add(l)}
                    disabled={createProcessCost.isPending || data.batchSize == null}
                    className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-border hover:bg-muted shrink-0 disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" />Add to costs
                  </button>
                )
              )}
            </div>
            {isOpen && (
              <div className="px-8 pb-2 space-y-1 text-[10px]">
                <p className="text-muted-foreground">{l.reason}</p>
                {l.trace.map((t, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="w-44 shrink-0 text-muted-foreground">{t.label}</span>
                    <span className="font-mono">{t.value}{t.unit ? ` ${t.unit}` : ''}</span>
                    <span className="text-muted-foreground/70 truncate" title={t.source}>{t.source}</span>
                  </div>
                ))}
                {l.materialUsdPerPart > 0 && (
                  <p className="text-amber-500">Carton material USD {l.materialUsdPerPart.toFixed(4)}/part is included in the cost here but is not part of a saved process cost record.</p>
                )}
                {l.warnings.map((w) => <p key={w} className="text-amber-500">{w}</p>)}
              </div>
            )}
          </div>
        );
      });

  return (
    <div className="flex flex-col">
      <div className="px-3 py-2 border-b text-[11px] text-muted-foreground space-y-0.5">
        <div>
          Batch {data.batchSize ?? '—'} · {data.location}
          {data.materialCutCode != null ? ` · material cut code ${data.materialCutCode}` : ' · material not resolved'}
          {data.materialTypeName ? ` · ${data.materialTypeName}` : ''}
        </div>
        {data.dataWarnings.map((w) => <div key={w} className="text-amber-500">{w}</div>)}
      </div>
      <div className="px-3 py-1.5 bg-muted/40 border-b text-[11px] font-semibold flex justify-between">
        <span>Secondary processes ({data.lines.length})</span>
        <span className="font-normal text-muted-foreground">{summary(data.lines)}</span>
      </div>
      {renderLines(data.lines)}
      <div className="px-3 py-1.5 bg-muted/40 border-b text-[11px] font-semibold flex justify-between">
        <span>Surface treatment ({data.surfaceLines.length})</span>
        <span className="font-normal text-muted-foreground">{summary(data.surfaceLines)}</span>
      </div>
      {renderLines(data.surfaceLines)}
      <div className="px-3 py-1.5 bg-muted/40 border-b text-[11px] font-semibold flex justify-between">
        <span>Heat treatment ({data.heatTreatmentLines.length})</span>
        <span className="font-normal text-muted-foreground">{summary(data.heatTreatmentLines)}</span>
      </div>
      {renderLines(data.heatTreatmentLines)}
      <div className="px-3 py-1.5 bg-muted/40 border-b text-[11px] font-semibold flex justify-between">
        <span>Chemical milling ({data.chemicalMillingLines.length}){data.chemicalMillingCallout ? ` — drawing: "${data.chemicalMillingCallout}"` : ''}</span>
        <span className="font-normal text-muted-foreground">{summary(data.chemicalMillingLines)}</span>
      </div>
      {renderLines(data.chemicalMillingLines)}
    </div>
  );
}
