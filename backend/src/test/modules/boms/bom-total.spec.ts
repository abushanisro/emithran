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

  it('an assembly is its own cost plus each child at its quantity, times the assembly quantity', () => {
    // asm x2 = 2 * (own 10 + 3 * 10) = 80
    const items = [item('asm', null, 2), item('c', 'asm', 3)];
    const rows = [row('asm', 'material', 10, 'USD'), row('c', 'material', 10, 'USD')];
    expect(total(items, rows).total).toBe(80);
  });

  it('does not count an assembly stored aggregate on top of its children', () => {
    const items = [item('asm'), item('leaf1', 'asm', 2), item('leaf2', 'asm')];
    const rows = [row('leaf1', 'material', 10, 'USD'), row('leaf2', 'material', 5, 'USD'), row('asm', 'aggregate', 25, 'USD')];
    expect(total(items, rows).total).toBe(25);
  });

  it('multiplies quantities through every level', () => {
    // top x2 -> mid x3 -> leaf x4 at 1 each = 2 * 3 * 4
    const items = [item('top', null, 2), item('mid', 'top', 3), item('leaf', 'mid', 4)];
    expect(total(items, [row('leaf', 'material', 1, 'USD')]).total).toBe(24);
  });

  it('leaves the total unresolved for a cycle or a parent outside the BOM, never silently dropping cost', () => {
    expect(total([item('a', 'b'), item('b', 'a')], [row('a', 'material', 5, 'USD')]).total).toBeNull();
    expect(total([item('x', 'ghost')], [row('x', 'material', 5, 'USD')]).total).toBeNull();
    expect(total([item('r'), item('a', 'r'), item('b', 'a')], [row('b', 'material', 5, 'USD')]).total).toBe(5);
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
