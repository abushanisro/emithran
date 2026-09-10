import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateBOMItemUpdateQueries, type BOMItem } from '@/lib/api/hooks/useBOMItems';

// P0.5 — DFM scores are material/thickness-bracketed (dfm-scoring.service.ts's
// UNDERSIZED_HOLE and CRACK_RISK checks), but useUpdateBOMItem's onSuccess used
// to invalidate only cost-summary/route-comparison after a material-grade edit
// — dfm-scores (staleTime: 0, no auto-refetch) kept showing the OLD material's
// DFM verdict in the same session until the component remounted. This proves
// the real production invalidation function (not a re-implementation of it)
// now includes dfm-scores alongside the pre-existing keys.

function updatedItem(overrides: Partial<BOMItem> = {}): BOMItem {
  return {
    id: 'item-1',
    bomId: 'bom-1',
    name: 'Test Part',
    itemType: 'child_part',
    quantity: 1,
    annualVolume: 100,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as BOMItem;
}

describe('invalidateBOMItemUpdateQueries — P0.5 material-grade DFM staleness fix', () => {
  it('invalidates dfm-scores alongside cost-summary and route-comparison after any BOM item update', () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateBOMItemUpdateQueries(queryClient, updatedItem());

    const invalidatedKeys = spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey);
    expect(invalidatedKeys).toContainEqual(['bom-items', 'item-1', 'dfm-scores']);
    expect(invalidatedKeys).toContainEqual(['bom-items', 'item-1', 'cost-summary']);
    expect(invalidatedKeys).toContainEqual(['bom-items', 'item-1', 'route-comparison']);
  });

  it('seeds the detail cache from the response so an annual-volume edit shows up without a refetch', () => {
    // The Cost Guide derives Batch Size from annual volume SERVER-side and reads
    // it back through the item (resolvedCostingInputs). Invalidation alone left
    // the panel showing the previous volume's batch size until the refetch
    // returned -- and on a real part /cost-summary takes ~13s while
    // /bom-items/:id takes ~0.7s, so "not changing instantly" was the whole
    // user-visible symptom. The PUT already returns the complete resolved item,
    // so seeding is the same data the refetch would bring, not a guess.
    const queryClient = new QueryClient();
    const fresh = updatedItem({ annualVolume: 1_000 });

    invalidateBOMItemUpdateQueries(queryClient, fresh);

    // bomItemKeys.detail(id) === ['bom-items', 'detail', id] -- the exact key useBOMItem reads.
    expect(queryClient.getQueryData(['bom-items', 'detail', 'item-1'])).toEqual(fresh);
  });

  it('still invalidates the detail key it seeded, so a partial payload self-corrects', () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateBOMItemUpdateQueries(queryClient, updatedItem());

    const invalidatedKeys = spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey);
    expect(invalidatedKeys).toContainEqual(['bom-items', 'detail', 'item-1']);
  });

  it('scopes the dfm-scores invalidation to the specific item that was updated, not every item', () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateBOMItemUpdateQueries(queryClient, updatedItem({ id: 'item-42', bomId: 'bom-7' }));

    const invalidatedKeys = spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey);
    expect(invalidatedKeys).toContainEqual(['bom-items', 'item-42', 'dfm-scores']);
    expect(invalidatedKeys.some((k) => k[0] === 'bom-items' && k[1] === 'item-1')).toBe(false);
  });
});
