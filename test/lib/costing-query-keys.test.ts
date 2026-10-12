import { describe, expect, it } from 'vitest';

import {
  costSummaryQueryKey,
  costSummaryUrl,
  routeComparisonQueryKey,
  routeComparisonUrl,
} from '@/lib/api/hooks/useBOMItems';

// One cache slot per distinct costing request, and one slot for the same request.
// The Apply storm doubled every 40-95 s computation because the raw-material section
// subscribed under (250, 'USA') while the page held the same data under (undefined, 'USA').
describe('cost-summary and route-comparison cache keys', () => {
  const builders = [
    { name: 'cost-summary', key: costSummaryQueryKey, url: costSummaryUrl },
    { name: 'route-comparison', key: routeComparisonQueryKey, url: routeComparisonUrl },
  ];

  it.each(builders)('$name: the same request has one key and one URL', ({ key, url }) => {
    expect(key('item-1', 250, 'USA')).toEqual(key('item-1', 250, 'USA'));
    expect(url('item-1', 250, 'USA')).toBe(url('item-1', 250, 'USA'));
  });

  it.each(builders)('$name: the key separates by item, batch size and location', ({ key }) => {
    const base = JSON.stringify(key('item-1', 250, 'USA'));
    expect(JSON.stringify(key('item-2', 250, 'USA'))).not.toBe(base);
    expect(JSON.stringify(key('item-1', 100, 'USA'))).not.toBe(base);
    expect(JSON.stringify(key('item-1', 250, 'India'))).not.toBe(base);
  });

  it.each(builders)('$name: an unstated batch is its own request, not batch 1 or the resolved value', ({ key, url }) => {
    expect(JSON.stringify(key('item-1', undefined, 'USA'))).not.toBe(JSON.stringify(key('item-1', 250, 'USA')));
    expect(JSON.stringify(key('item-1', undefined, 'USA'))).not.toBe(JSON.stringify(key('item-1', 1, 'USA')));
    expect(url('item-1', undefined, 'USA')).not.toContain('batchSize');
    expect(url('item-1', 250, 'USA')).toContain('batchSize=250');
  });

  it.each(builders)('$name: both share the item prefix every mutation invalidates', ({ key }) => {
    expect(key('item-1', 250, 'USA').slice(0, 2)).toEqual(['bom-items', 'item-1']);
  });

  it('the URL carries the same location the key does', () => {
    expect(routeComparisonUrl('item-1', 250, 'India')).toContain('location=India');
    expect(costSummaryUrl('item-1', 250, 'India')).toContain('location=India');
  });
});
