import { computeBomTotal, type BomCostRow, type BomTotalItem } from '../../../modules/boms/bom-total';

const rate = (from: string) => ({ INR: 0.012, EUR: 1.1 } as Record<string, number>)[from] ?? null;
const item = (id: string, parent: string | null = null, quantity: unknown = 1): BomTotalItem =>
  ({ id, parent_item_id: parent, quantity });
const row = (itemId: string, amount: unknown, currency: string | null = 'USD', trusted = true, isStale: boolean | null = false): BomCostRow =>
  ({ itemId, amount, currency, trusted, isStale });
const total = (items: BomTotalItem[], rows: BomCostRow[]) =>
  computeBomTotal({ items, rows, reportingCurrency: 'USD', rateToReporting: rate });

describe('computeBomTotal', () => {
  it('converts complete snapshots through one supplied FX lookup', () => {
    expect(total([item('usd'), item('inr')], [row('usd', 100), row('inr', 5000, 'INR')]).total).toBe(160);
  });

  it('preserves complete own cost including tooling, packaging and procured parts (18, not 10)', () => {
    expect(total([item('part')], [row('part', 18)]).total).toBe(18);
  });

  it('preserves assembly own work without counting children twice (70, not 30 or 60)', () => {
    expect(total([item('assembly', null, 2), item('child', 'assembly', 3)], [row('assembly', 5), row('child', 10)]).total).toBe(70);
  });

  it('multiplies quantities through every level and adds multiple roots', () => {
    const items = [item('top', null, 2), item('mid', 'top', 3), item('leaf', 'mid', 4), item('other', null, 2)];
    expect(total(items, [row('top', 0), row('mid', 0), row('leaf', 1), row('other', 5)]).total).toBe(34);
  });

  it('accepts numeric database strings and does not turn zero quantity into one', () => {
    expect(total([item('a', null, '2')], [row('a', '7.5')]).total).toBe(15);
    expect(total([item('a', null, 0)], [row('a', 99)]).total).toBe(0);
  });

  it('rejects cycles, including disconnected cycles, and orphaned parents', () => {
    expect(total([item('a', 'b'), item('b', 'a')], [row('a', 5), row('b', 0)]).total).toBeNull();
    expect(total([item('root'), item('a', 'b'), item('b', 'a')], [row('root', 1), row('a', 5), row('b', 0)]).total).toBeNull();
    expect(total([item('x', 'ghost')], [row('x', 5)]).total).toBeNull();
  });

  it('rejects duplicate items and ambiguous duplicate snapshots', () => {
    expect(total([item('a'), item('a')], [row('a', 5)]).total).toBeNull();
    expect(total([item('a')], [row('a', 5), row('a', 6)]).total).toBeNull();
  });

  it('requires a snapshot for every item, including an assembly with zero own work', () => {
    expect(total([item('a')], []).total).toBeNull();
    expect(total([item('assembly'), item('child', 'assembly')], [row('child', 5)]).total).toBeNull();
  });

  it.each([0, 99])('rejects a stale snapshot even when its amount is %s', amount => {
    expect(total([item('a')], [row('a', amount, 'USD', true, true)]).total).toBeNull();
  });

  it('distinguishes a verified zero from an uncomputed/unverified zero', () => {
    expect(total([item('a')], [row('a', 0)]).total).toBe(0);
    expect(total([item('a')], [row('a', 0, 'USD', false)]).total).toBeNull();
    expect(total([item('a')], [row('a', 0, 'USD', true, null)]).total).toBeNull();
    expect(total([item('a')], [row('a', 0, null)]).total).toBeNull();
  });

  it('does not require FX to convert verified foreign-currency zero money', () => {
    expect(total([item('a')], [row('a', 0, 'JPY')]).total).toBe(0);
    expect(total([item('a')], [row('a', 100, 'JPY')]).total).toBeNull();
  });

  it.each([null, '', -1, '3bad', NaN, Infinity])('rejects invalid quantity %s rather than defaulting it', quantity => {
    expect(total([item('a', null, quantity)], [row('a', 1)]).total).toBeNull();
  });

  it.each([null, '', 'bad', NaN, Infinity, -1])('rejects invalid own cost %s', amount => {
    expect(total([item('a')], [row('a', amount)]).total).toBeNull();
  });

  it('returns unresolved on arithmetic overflow', () => {
    expect(total([item('a', null, 2)], [row('a', 1e308)]).total).toBeNull();
  });

  it('supports deep imported hierarchies without recursion limits', () => {
    const items = Array.from({ length: 5000 }, (_, index) => item(String(index), index ? String(index - 1) : null));
    expect(total(items, items.map(i => row(i.id, 1))).total).toBe(5000);
  });

  it('an empty BOM is genuinely zero', () => {
    expect(total([], []).total).toBe(0);
  });
});
