// resolveConsumablePrice (private, exercised via `as any` like bom-items.currency.spec.ts):
// a missing price is null (so the waterjet engine can warn), a failed query is an error,
// and the price is converted into the caller's costing currency — never a guessed location.
import { BOMItemsService } from '../../../modules/bom-items/bom-items.service';
import type { RateSnapshot } from '../../../common/exchange-rate/exchange-rate.service';

type Row = { data: { price_per_unit: number | null } | null; error: { message: string } | null };

function serviceReturning(rowsByLocation: Record<string, Row>) {
  const asked: string[] = [];
  const db = {
    getClient: () => ({
      from: () => {
        const filters: Record<string, string> = {};
        const q = {
          select: () => q,
          eq: (col: string, v: string) => { filters[col] = v; return q; },
          maybeSingle: async () => {
            asked.push(filters.location!);
            return rowsByLocation[filters.location!] ?? { data: null, error: null };
          },
        };
        return q;
      },
    }),
  };
  const deps = Array.from({ length: 16 }, () => ({}));
  const service = new (BOMItemsService as any)(db, ...deps) as BOMItemsService;
  return { service: service as any, asked };
}

const rates: RateSnapshot = {
  convertOptional: (from, to) => (from === to ? 1 : from === 'USD' && to === 'INR' ? 80 : null),
  convertStrict: (from, to) => {
    if (from === to) return 1;
    if (from === 'USD' && to === 'INR') return 80;
    throw new Error(`No exchange rate on file for '${from}' → '${to}'`);
  },
  toUsd: (amount) => amount,
  has: (c) => c === 'USD' || c === 'INR',
  rates: () => ({ USD: 1, INR: 1 / 80 }),
  organizationId: null,
};

describe('BOMItemsService.resolveConsumablePrice', () => {
  it("converts the location's own USD price into the costing currency", async () => {
    const { service } = serviceReturning({ India: { data: { price_per_unit: 0.5 }, error: null } });
    await expect(service.resolveConsumablePrice('t', 'garnet_abrasive', 'India', 'INR', rates)).resolves.toBe(40);
  });

  it("falls back to the table's __default__ row, then returns null — not 0 — when there is none", async () => {
    const withDefault = serviceReturning({ __default__: { data: { price_per_unit: 1 }, error: null } });
    await expect(withDefault.service.resolveConsumablePrice('t', 'garnet_abrasive', 'Brazil', 'USD', rates)).resolves.toBe(1);
    expect(withDefault.asked).toEqual(['Brazil', '__default__']);

    const none = serviceReturning({});
    await expect(none.service.resolveConsumablePrice('t', 'garnet_abrasive', 'India', 'INR', rates)).resolves.toBeNull();
  });

  it('throws on a failed query instead of pricing the consumable at 0', async () => {
    const { service } = serviceReturning({ India: { data: null, error: { message: 'boom' } } });
    await expect(service.resolveConsumablePrice('t', 'garnet_abrasive', 'India', 'INR', rates)).rejects.toThrow('boom');
  });

  it('throws when the FX rate is missing instead of returning 0', async () => {
    const { service } = serviceReturning({ UK: { data: { price_per_unit: 1 }, error: null } });
    await expect(service.resolveConsumablePrice('t', 'garnet_abrasive', 'UK', 'GBP', rates)).rejects.toThrow('No exchange rate');
  });
});
