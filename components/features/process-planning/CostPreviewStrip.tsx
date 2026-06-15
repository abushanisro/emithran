'use client';

interface Props {
  costPreview: {
    rawMaterial: number;
    process: number;
    tooling: number;
    logistics: number;
    procuredPart: number;
    total: number;
  };
  removedCount: number;
}

const SECTIONS: Array<{ key: keyof Props['costPreview']; label: string; abbr: string }> = [
  { key: 'rawMaterial', label: 'Raw Material', abbr: 'RM' },
  { key: 'process',     label: 'Process',      abbr: 'PROC' },
  { key: 'tooling',     label: 'Tooling',      abbr: 'TOOL' },
  { key: 'logistics',   label: 'Logistics',    abbr: 'LOG' },
  { key: 'procuredPart', label: 'Procured',    abbr: 'BUY' },
];

export function CostPreviewStrip({ costPreview, removedCount }: Props) {
  const nonZero = SECTIONS.filter((s) => costPreview[s.key] > 0);

  return (
    <div className="rounded border bg-muted/30 px-3 py-2 space-y-2">
      {/* Total headline */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Estimated unit cost</span>
        <span className="font-bold tabular-nums text-primary text-lg">₹{costPreview.total.toFixed(2)}</span>
      </div>

      {/* Section breakdown */}
      <div className="space-y-0.5">
        {SECTIONS.map(({ key, label }) => {
          const val = costPreview[key];
          const pct = costPreview.total > 0 ? (val / costPreview.total) * 100 : 0;
          return (
            <div key={key} className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground w-24">{label}</span>
              <div className="flex-1 h-1 rounded-full bg-border overflow-hidden">
                <div
                  className={`h-full rounded-full ${val > 0 ? 'bg-primary/60' : 'bg-transparent'}`}
                  style={{ width: `${pct.toFixed(1)}%` }}
                />
              </div>
              <span className="text-[10px] tabular-nums text-foreground w-20 text-right">
                ₹{val.toFixed(2)}
                <span className="text-muted-foreground ml-1">({pct.toFixed(0)}%)</span>
              </span>
            </div>
          );
        })}
      </div>

      {/* Composition formula */}
      {nonZero.length > 1 && (
        <p className="text-[9px] font-mono text-muted-foreground leading-snug border-t pt-1.5">
          {nonZero.map((s) => `${s.abbr} ₹${costPreview[s.key].toFixed(2)}`).join(' + ')} = ₹{costPreview.total.toFixed(2)}
        </p>
      )}

      {removedCount > 0 && (
        <p className="text-[10px] text-amber-600">
          Preview includes {removedCount} removed line{removedCount === 1 ? '' : 's'} — final cost on Apply will exclude them.
        </p>
      )}
    </div>
  );
}
