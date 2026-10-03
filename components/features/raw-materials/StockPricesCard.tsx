'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useMaterialStockPrices } from '@/lib/api/hooks/useRawMaterials';

// Material price by stock form and location, as material_stock_prices holds it
// (migration 833, from memory/). Machining quotes price a milled billet on
// plate and a turned part on round bar from this table at the quote location
// (backend costing/machining/stock-price.ts). Read-only; one row per material,
// one column per stock form present in the data.

const labelOf = (form: string) => form.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// location follows the page's cost region; null when that region has no stock data.
export function StockPricesCard({ location }: { location: string | null }) {
  const { data, isLoading, error } = useMaterialStockPrices();
  const [open, setOpen] = useState(false);
  const loc = location;

  const { forms, byMaterial, unmatched } = useMemo(() => {
    const rows = (data ?? []).filter((r) => r.location === loc);
    const forms = [...new Set(rows.map((r) => r.stockForm))].sort();
    const byMaterial = new Map<string, { linked: boolean; currency: string; prices: Record<string, number> }>();
    for (const r of rows) {
      const m = byMaterial.get(r.referenceMaterial) ?? { linked: r.rawMaterialName != null, currency: r.currencyCode, prices: {} };
      m.prices[r.stockForm] = r.pricePerKg;
      byMaterial.set(r.referenceMaterial, m);
    }
    return { forms, byMaterial, unmatched: [...byMaterial.values()].filter((m) => !m.linked).length };
  }, [data, loc]);

  if (isLoading) return null;
  if (error || !data || data.length === 0) return null;

  return (
    <Card className="p-3">
      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span className="text-sm font-semibold">Stock prices by form</span>
        <span className="text-xs text-muted-foreground">
          {loc ? `${byMaterial.size} materials · ${loc}` : 'No stock prices for this cost region'}{unmatched > 0 ? ` · ${unmatched} not linked to a raw material (not used in costing)` : ''}
        </span>
      </button>
      {open && loc && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Machining prices a milled billet on plate and a turned part on round bar at the quote location, converted at the day&apos;s FX rate.
          </p>
          <div className="max-h-[420px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead>
                  {forms.map((f) => <TableHead key={f} className="text-right">{labelOf(f)}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...byMaterial.entries()].map(([name, m]) => (
                  <TableRow key={name} className={m.linked ? '' : 'text-muted-foreground'}>
                    <TableCell className="text-xs">{name}{m.linked ? '' : ' (not linked)'}</TableCell>
                    {forms.map((f) => (
                      <TableCell key={f} className="text-right text-xs tabular-nums">
                        {m.prices[f] != null ? `${m.prices[f]} ${m.currency}/kg` : '–'}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </Card>
  );
}
