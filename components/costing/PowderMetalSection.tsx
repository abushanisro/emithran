'use client';

import { NumberField } from '@/components/costing/NumberField';
import type { CostSummaryDto } from '@/lib/api/hooks/useBOMItems';
import { parsePositive } from '@/lib/costing/sand-scenario';

type PowderMetalSummary = NonNullable<CostSummaryDto['powderMetal']>;

/**
 * Why the Cost Summary has no powder metal route: the reason on its uncosted Powder Metal line (backend powder-metal-cost-summary.ts), such
 * as a location with no powder metal machines. Null when there is a route, or no line says why.
 */
export function powderMetalUncostedReason(summary: Pick<CostSummaryDto, 'powderMetal' | 'processLines'>): string | null {
  if (summary.powderMetal) return null;
  for (const l of summary.processLines) {
    if (l.processGroup === 'Powder Metal' && l.physicsGap?.gapType === 'unsupported_operation') return l.physicsGap.reason;
  }
  return null;
}

interface Props {
  powderMetal: PowderMetalSummary | null | undefined;
  /** Why there is no route (powderMetalUncostedReason); shown in its place. */
  uncostedReason?: string | null;
  /** The green density the engineer set (kg/m³); null: the powder's own. */
  greenDensity: number | null;
  /** Writes the green density; null gives it back to the powder. */
  onChange: (value: number | null) => void;
}

const rowClass = 'flex items-center gap-2 py-0.5';
const labelClass = 'text-xs text-muted-foreground w-24 shrink-0';

/**
 * The Cost Guide's powder metal settings: the green density the part is pressed to (the powder's own until set, which must lie within its
 * range), and what the route makes of it: the compaction pressure and force, the powder fill, and the sintering belt.
 */
export function PowderMetalSection({ powderMetal, uncostedReason, greenDensity, onChange }: Props) {
  const pm = powderMetal;
  return (
    <div className="space-y-1 text-xs">
      <NumberField
        label="Green density"
        value={greenDensity}
        placeholder={pm ? `${pm.greenDensityKgM3} kg/m³` : "the powder's"}
        parse={parsePositive}
        onCommit={onChange}
        title="The density the powder is compacted to (kg/m³), within the powder's minimum and maximum green density. Empty: the powder's own green density. A denser part takes more compaction pressure."
      />
      {!pm && uncostedReason && <p className="text-amber-600 dark:text-amber-400">{uncostedReason}</p>}
      {pm && (
        <>
          <div className={rowClass} title="The powder's compaction curve at the green density.">
            <span className={labelClass}>Compaction</span>
            <span className="flex-1 tabular-nums">{pm.compactionPressureMpa} MPa · {Math.round(pm.pressForceKn).toLocaleString('en-US')} kN</span>
          </div>
          <div className={rowClass} title="The depth of loose powder the die is filled to: the part's height times the compression ratio (green over apparent density).">
            <span className={labelClass}>Powder fill</span>
            <span className="flex-1 tabular-nums">{pm.fillHeightMm} mm (ratio {pm.compressionRatio})</span>
          </div>
          <div className={rowClass} title="The mesh belt of the sintering furnace chosen: its speed and the parts it carries.">
            <span className={labelClass}>Sintering belt</span>
            <span className="flex-1 tabular-nums">
              {pm.belt ? `${pm.belt.speedMmPerMin} mm/min · ${pm.belt.partsAcross} across · ${pm.belt.partsPerMetre} per m` : 'no furnace takes the part'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
