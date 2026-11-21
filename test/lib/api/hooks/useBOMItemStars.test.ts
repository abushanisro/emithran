import { describe, expect, it } from 'vitest';

import { bomItemStarKeys, withStar } from '@/lib/api/hooks/useBOMItemStars';

describe("a person's starred BOM items", () => {
  it('starring adds the item once, however often it is starred; unstarring removes it', () => {
    expect(withStar(undefined, 'a', true)).toEqual(['a']);
    expect(withStar(['a', 'b'], 'a', true)).toEqual(['b', 'a']);
    expect(withStar(['a', 'b'], 'a', false)).toEqual(['b']);
    expect(withStar(['b'], 'a', false)).toEqual(['b']);
  });

  it('each BOM has its own cached list', () => {
    expect(bomItemStarKeys.list('bom-1')).toEqual(['bom-item-stars', 'bom-1']);
    expect(bomItemStarKeys.list('bom-1')).not.toEqual(bomItemStarKeys.list('bom-2'));
  });
});
