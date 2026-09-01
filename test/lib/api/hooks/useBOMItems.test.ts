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

  it('scopes the dfm-scores invalidation to the specific item that was updated, not every item', () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateBOMItemUpdateQueries(queryClient, updatedItem({ id: 'item-42', bomId: 'bom-7' }));

    const invalidatedKeys = spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey);
    expect(invalidatedKeys).toContainEqual(['bom-items', 'item-42', 'dfm-scores']);
    expect(invalidatedKeys.some((k) => k[0] === 'bom-items' && k[1] === 'item-1')).toBe(false);
  });
});
