'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useRawMaterialProperties, useRawMaterialStockPrices } from '@/lib/api/hooks/useRawMaterials';

// "specific_heat_rt_j_kg_k" -> "Specific heat rt j kg k". The key is the
// normalized source header; the unit column carries the real unit.
function labelOf(key: string): string {
  const words = key.split('_').filter(Boolean);
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}

// The stock section prices this material in the cost region the page is set to.
const STOCK_LOCATION = 'USA';

function StockPricesSection({ materialId }: { materialId: string }) {
  const { data: prices, isLoading } = useRawMaterialStockPrices(materialId);
  const current = (prices ?? []).filter((p) => p.location === STOCK_LOCATION);

  return (
    <div className="mt-5 space-y-3">
      <div className="text-sm font-semibold">Stock prices ({STOCK_LOCATION}, USD/kg)</div>
      {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {!isLoading && current.length === 0 && (
        <p className="text-xs text-muted-foreground">No stock prices for this material yet.</p>
      )}
      {current.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-1 pr-2 font-medium">Stock form</th>
              <th className="py-1 pr-2 font-medium text-right">Price</th>
            </tr>
          </thead>
          <tbody>
            {current.map((p) => (
              <tr key={p.stockForm} className="border-b border-border/40">
                <td className="py-1 pr-2">{labelOf(p.stockForm)}</td>
                <td className="py-1 pr-2 text-right font-mono">{p.pricePerKg.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function RawMaterialPropertiesDialog({
  materialId,
  materialName,
  onClose,
}: {
  materialId: string | null;
  materialName: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useRawMaterialProperties(materialId);
  return (
    <Dialog open={!!materialId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{materialName ?? 'Material'} — properties</DialogTitle>
          <DialogDescription>Every property on file for this material, with its unit and source.</DialogDescription>
        </DialogHeader>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-red-500">Could not load properties.</p>}
        {data && data.length === 0 && <p className="text-sm text-muted-foreground">No properties on file.</p>}
        {data && data.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Property</th>
                <th className="py-1 pr-2 font-medium">Value</th>
                <th className="py-1 pr-2 font-medium">Unit</th>
                <th className="py-1 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.propertyKey} className="border-b border-border/40">
                  <td className="py-1 pr-2">{labelOf(p.propertyKey)}</td>
                  <td className="py-1 pr-2 font-mono">{p.valueNum ?? p.valueText ?? '—'}</td>
                  <td className="py-1 pr-2">{p.unit ?? '—'}</td>
                  <td className="py-1 text-muted-foreground">{p.sourceVersion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {materialId && <StockPricesSection materialId={materialId} />}
      </DialogContent>
    </Dialog>
  );
}
