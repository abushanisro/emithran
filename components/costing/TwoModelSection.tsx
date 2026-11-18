'use client';

import type { BOMItem } from '@/lib/api/hooks/useBOMItems';
import { blankProcessOf, DERIVABLE_BLANK_PROCESSES, type SourceComponentSummary } from '@/lib/costing/two-model-view';

interface Props {
  item: BOMItem;
  /** The engine's blank block (absent while the part cannot be costed: the cost names why). */
  source: SourceComponentSummary | null | undefined;
  /** Saves the process the blank is made by (scenario key twoModelBlankProcess). */
  onBlankProcess: (process: string) => void;
}

const rowClass = 'flex items-start gap-2 py-0.5';
const labelClass = 'text-xs text-muted-foreground w-24 shrink-0';
const controlClass = 'flex-1 min-w-0 text-xs border border-border rounded px-2 py-1 bg-background focus:outline-hidden focus:ring-1 focus:ring-brand-500';
const money = (n: number) => n.toFixed(2);
const mm3 = (v: number) => `${Math.round(v).toLocaleString('en-US')} mm³`;

/**
 * The Cost Guide's 2-Model Machining settings: the part is costed from its own 3D model. Its blank is derived from it (the part as cast, with
 * its machining allowance), its cost is the part's material, and only what the casting cannot hold is machined.
 */
export function TwoModelSection({ item, source, onBlankProcess }: Props) {
  const process = blankProcessOf(item.scenarioOverrides);
  return (
    <div className="space-y-1 text-xs">
      <div className={rowClass}>
        <span className={labelClass}>Blank made by</span>
        <select
          className={`${controlClass} cursor-pointer`}
          value={process}
          onChange={(e) => { onBlankProcess(e.target.value); }}
          title="The blank is derived from this part's 3D model: the part as cast by this process, with its machining allowance."
        >
          {DERIVABLE_BLANK_PROCESSES.map((p) => <option key={p} value={p}>{p}</option>)}
          {!DERIVABLE_BLANK_PROCESSES.includes(process) && <option value={process}>{process} (cannot be derived)</option>}
        </select>
      </div>
      <p className="text-muted-foreground">
        The blank is derived from this part&apos;s 3D model, as a {process.toLowerCase()} with its machining allowance; only what the casting cannot
        hold is machined.
      </p>

      {source && (
        <div className="mt-2 rounded border border-border p-2 space-y-0.5" title="The blank's cost is this part's material (useSourceModelFBCAsMaterialCost), shown in its own categories.">
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground">Blank</span>
            <span className="text-muted-foreground">{source.name}</span>
          </div>
          <div className={rowClass}><span className={labelClass}>Material</span><span className="flex-1 tabular-nums">{money(source.materialCost)}</span></div>
          <div className={rowClass}><span className={labelClass}>Process</span><span className="flex-1 tabular-nums">{money(source.processCost)}</span></div>
          {source.basis === 'fully_burdened' && (
            <div className={rowClass}><span className={labelClass}>Tooling / part</span><span className="flex-1 tabular-nums">{money(source.toolingCost)}</span></div>
          )}
          <div className={rowClass}>
            <span className={labelClass}>Total</span>
            <span className="flex-1 tabular-nums font-medium text-foreground">
              {money(source.totalCost)} <span className="font-normal text-muted-foreground">{source.basis === 'fully_burdened' ? 'fully burdened' : 'piece part'}</span>
            </span>
          </div>
          <div className={rowClass} title="The metal the casting carries on its machined faces (the machining allowance × the faces' area), machined off.">
            <span className={labelClass}>Allowance</span>
            <span className="flex-1 tabular-nums">{mm3(source.allowanceVolumeMm3 ?? 0)} on the machined faces</span>
          </div>
          <div className={rowClass}>
            <span className={labelClass}>As supplied</span>
            <span className="flex-1 tabular-nums">{source.asSuppliedFeatures} feature{source.asSuppliedFeatures === 1 ? '' : 's'}, not machined</span>
          </div>
        </div>
      )}
    </div>
  );
}
