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

export function CostPreviewStrip({ costPreview, removedCount }: Props) {
  return (
    <div className="rounded border bg-muted/30 px-3 py-2">
      <div className="flex items-center justify-between text-[11px]">
        <span className="uppercase tracking-wider text-muted-foreground">Estimated unit cost</span>
        <span className="font-bold tabular-nums text-primary text-base">₹{costPreview.total.toFixed(2)}</span>
      </div>
      <div className="grid grid-cols-5 gap-1 mt-1 text-[10px] tabular-nums text-muted-foreground">
        <span>mat ₹{costPreview.rawMaterial.toFixed(2)}</span>
        <span>proc ₹{costPreview.process.toFixed(2)}</span>
        <span>tool ₹{costPreview.tooling.toFixed(2)}</span>
        <span>log ₹{costPreview.logistics.toFixed(2)}</span>
        <span>buy ₹{costPreview.procuredPart.toFixed(2)}</span>
      </div>
      {removedCount > 0 && (
        <p className="text-[10px] text-amber-600 mt-1">
          Preview includes removed lines — final cost on Apply will exclude {removedCount} removed line{removedCount === 1 ? '' : 's'}.
        </p>
      )}
    </div>
  );
}
