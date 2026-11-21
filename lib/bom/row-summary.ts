// One BOM row's details in one line, as Gmail shows a message's snippet after its subject: what the table used to spread over seven
// columns (material, quantity and unit, make or buy, BOM level, weight, annual volume) and the description, each only when it is set.
// Pure: the table renders these.

export interface RowSummaryItem {
  material?: string | null;
  materialGrade?: string | null;
  quantity?: number | null;
  unit?: string | null;
  makeBuy?: 'make' | 'buy' | null;
  weight?: number | null;
  annualVolume?: number | null;
  description?: string | null;
}

/** The row's facts in reading order; `level` is the BOM level the row shows (its own, or its type's default). */
export function rowFacts(item: RowSummaryItem, level: string): string[] {
  // The grade when there is one (what the table's Material column showed), else the material.
  const material = [item.materialGrade, item.material].map((v) => v?.trim()).find((v) => !!v);
  const facts: (string | null | undefined)[] = [
    material,
    typeof item.quantity === 'number' ? `Qty ${item.quantity}${item.unit ? ` ${item.unit}` : ''}` : null,
    item.makeBuy === 'buy' ? 'Buy' : 'Make',
    level,
    item.weight && item.weight > 0 ? `${item.weight.toFixed(3)} kg` : null,
    typeof item.annualVolume === 'number' ? `${item.annualVolume.toLocaleString()}/yr` : null,
    item.description?.trim(),
  ];
  return facts.filter((f): f is string => !!f);
}
