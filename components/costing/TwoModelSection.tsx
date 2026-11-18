'use client';

import Link from 'next/link';

import type { BOMItem } from '@/lib/api/hooks/useBOMItems';
import { comparisonState, currentComparison, sourceCandidates, type SourceComponentSummary } from '@/lib/costing/two-model-view';

interface Props {
  item: BOMItem;
  /** Every item of the part's BOM: the source is picked among them. */
  bomItems: readonly BOMItem[];
  /** The engine's source block (absent while the part cannot be costed: the cost names why). */
  source: SourceComponentSummary | null | undefined;
  /** Link (or, with null, unlink) the source component. */
  onLink: (sourceItemId: string | null) => void;
  linking: boolean;
  /** The item page of a BOM item, for the link to the source. */
  hrefOf: (itemId: string) => string;
}

const rowClass = 'flex items-start gap-2 py-0.5';
const labelClass = 'text-xs text-muted-foreground w-24 shrink-0';
const controlClass = 'flex-1 min-w-0 text-xs border border-border rounded px-2 py-1 bg-background focus:outline-hidden focus:ring-1 focus:ring-brand-500';
const money = (n: number) => n.toFixed(2);
const mm3 = (v: number) => `${Math.round(v).toLocaleString('en-US')} mm³`;

/**
 * The Cost Guide's 2-Model Machining settings: the source component the part is machined from (another item of its BOM), whether the two
 * models line up, and what the source costs this part. Only the faces not on the source are machined; the source's cost is the material.
 */
export function TwoModelSection({ item, bomItems, source, onLink, linking, hrefOf }: Props) {
  const candidates = sourceCandidates(bomItems, item);
  const linked = bomItems.find((i) => i.id === item.sourceItemId) ?? null;
  const state = comparisonState(currentComparison(item, linked));
  const removed = item.twoModelComparison?.result.removed_volume_mm3;
  return (
    <div className="space-y-1 text-xs">
      <div className={rowClass}>
        <span className={labelClass}>Source</span>
        <select
          className={`${controlClass} cursor-pointer`}
          value={item.sourceItemId ?? ''}
          disabled={linking}
          onChange={(e) => { onLink(e.target.value || null); }}
          title="The item of this BOM the part is machined from (the casting or forging blank). Its STEP model is compared with this part's."
        >
          <option value="">None: pick the item this part is machined from</option>
          {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}{c.partNumber ? ` (${c.partNumber})` : ''}</option>)}
        </select>
      </div>
      {!item.fileStepPath && <p className="text-amber-600 dark:text-amber-400">This part has no STEP model to compare with its source.</p>}
      {candidates.length === 0 && <p className="text-muted-foreground">No other item of this BOM has a STEP model to be the source.</p>}

      {item.sourceItemId && (
        <>
          <div className={rowClass} title="The part must lie inside its source in the same coordinates (cadModelMisalignmentSensitivity). Models are never moved to fit.">
            <span className={labelClass}>Models</span>
            <span className={`flex-1 min-w-0 ${state.tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : state.tone === 'ok' ? 'text-foreground' : 'text-muted-foreground'}`}>
              {linking ? 'Comparing the two models…' : state.text}
            </span>
          </div>
          {removed != null && state.tone === 'ok' && (
            <div className={rowClass} title="The source's volume less the part's: the material machining takes off.">
              <span className={labelClass}>Removed</span>
              <span className="flex-1 tabular-nums">{mm3(removed)}</span>
            </div>
          )}
        </>
      )}

      {source && (
        <div className="mt-2 rounded border border-border p-2 space-y-0.5" title="The source component's cost is this part's material (useSourceModelFBCAsMaterialCost), shown in its own categories.">
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground">Source component</span>
            <Link className="text-brand-600 hover:underline" href={hrefOf(source.itemId)}>{source.name}</Link>
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
          <div className={rowClass}>
            <span className={labelClass}>As supplied</span>
            <span className="flex-1 tabular-nums">{source.asSuppliedFeatures} feature{source.asSuppliedFeatures === 1 ? '' : 's'}, not machined</span>
          </div>
        </div>
      )}
    </div>
  );
}
