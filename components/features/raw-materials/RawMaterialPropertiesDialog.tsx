'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  useRawMaterialProperties,
  useRawMaterialStockPrices,
  useSaveRawMaterialStockPrice,
  useStockForms,
} from '@/lib/api/hooks/useRawMaterials';

// "specific_heat_rt_j_kg_k" -> "Specific heat rt j kg k". The key is the
// normalized source header; the unit column carries the real unit.
function labelOf(key: string): string {
  const words = key.split('_').filter(Boolean);
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}

// The stock section prices this material in the cost region the page is set to.
const STOCK_LOCATION = 'USA';

function StockPricesSection({ materialId }: { materialId: string }) {
  const { data: forms } = useStockForms();
  const { data: prices, isLoading } = useRawMaterialStockPrices(materialId);
  const save = useSaveRawMaterialStockPrice(materialId);
  const [form, setForm] = useState<string>('');
  const [price, setPrice] = useState<string>('');

  const current = (prices ?? []).filter((p) => p.location === STOCK_LOCATION);

  const onSave = () => {
    const value = Number(price);
    if (!form) { toast.error('Choose a stock form'); return; }
    if (!Number.isFinite(value) || value <= 0) { toast.error('Enter a price above zero'); return; }
    save.mutate(
      { stockForm: form, location: STOCK_LOCATION, pricePerKg: value },
      {
        onSuccess: () => { toast.success('Stock price saved'); setPrice(''); },
        onError: () => toast.error('Could not save the stock price'),
      },
    );
  };

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
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <span className="text-xs text-muted-foreground">Stock form</span>
          <Select value={form} onValueChange={setForm}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Choose a form" />
            </SelectTrigger>
            <SelectContent>
              {(forms?.forms ?? []).map((f) => (
                <SelectItem key={f} value={f} className="text-xs">{labelOf(f)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-32 space-y-1">
          <span className="text-xs text-muted-foreground">USD per kg</span>
          <Input
            className="h-8 text-xs"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.000"
          />
        </div>
        <Button size="sm" className="h-8 text-xs" onClick={onSave} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
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
        {materialId && <StockPricesSection materialId={materialId} />}
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
      </DialogContent>
    </Dialog>
  );
}
