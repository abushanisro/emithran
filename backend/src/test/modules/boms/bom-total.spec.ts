import { computeBomTotal, type BomCostRow, type BomTotalItem } from '../../../modules/boms/bom-total';

const RATES: Record<string, number> = { INR: 0.012, EUR: 1.1 };
const rate = (from: string) => RATES[from] ?? null;

const item = (id: string, parent: string | null = null, quantity: unknown = 1, unit_cost: unknown = 0): BomTotalItem =>
  ({ id, parent_item_id: parent, quantity, unit_cost });
const row = (itemId: string, kind: BomCostRow['kind'], amount: number, currency: string | null, trusted = true): BomCostRow =>
  ({ itemId, kind, amount, currency, trusted });

const total = (items: BomTotalItem[], rows: BomCostRow[]) =>
  computeBomTotal({ items, rows, reportingCurrency: 'USD', rateToReporting: rate });

describe('computeBomTotal', () => {
  it('converts each row from its own currency before summing (no mixed-denomination sums)', () => {
    // 100 USD of material + 5000 INR of process = 100 + 60 USD
    const r = total([item('a')], [row('a', 'material', 100, 'USD'), row('a', 'process', 5000, 'INR')]);
    expect(r.total).toBeCloseTo(160);
  });

  it('multiplies by quantity and adds root items', () => {
    const r = total(
      [item('a', null, 2), item('b', null, 3)],
      [row('a', 'material', 10, 'USD'), row('b', 'material', 5, 'USD')],
    );
    expect(r.total).toBe(2 * 10 + 3 * 5);
  });

  it('uses the stored aggregate when an item has no record rows, then its own unit cost', () => {
    expect(total([item('a')], [row('a', 'aggregate', 42, 'USD')]).total).toBe(42);
    expect(total([item('a', null, 2, 7)], []).total).toBe(14);
  });

  it('an assembly counts its leaves (children), not its own aggregate twice', () => {
    const items = [item('asm'), item('leaf1', 'asm', 2), item('leaf2', 'asm')];
    const rows = [row('leaf1', 'material', 10, 'USD'), row('leaf2', 'material', 5, 'USD'), row('asm', 'aggregate', 25, 'USD')];
    // leaf sum 2*10 + 5 = 25; root sum = the assembly aggregate 25
    expect(total(items, rows).total).toBe(25);
  });

  it('has NO total when an amount carries money in an undeclared or unverified currency', () => {
    const r = total([item('a')], [row('a', 'material', 100, 'USD'), row('a', 'process', 900, null)]);
    expect(r.total).toBeNull();
    expect(r.unresolvedItems).toEqual(['a']);
    expect(total([item('a')], [row('a', 'material', 100, 'USD', false)]).total).toBeNull();
  });

  it('has NO total when the FX snapshot has no rate, instead of guessing', () => {
    expect(total([item('a')], [row('a', 'process', 100, 'JPY')]).total).toBeNull();
  });

  it('a zero amount cannot block a total', () => {
    expect(total([item('a')], [row('a', 'material', 10, 'USD'), row('a', 'process', 0, null, false)]).total).toBe(10);
  });
});
