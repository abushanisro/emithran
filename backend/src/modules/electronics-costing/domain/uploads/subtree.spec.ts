import { subtreeIds } from './subtree';

const row = (id: string, parent: string | null) => ({ id, parent_design_id: parent });

describe('subtreeIds', () => {
  const rows = [row('asm', null), row('sub', 'asm'), row('a', 'sub'), row('b', 'sub'), row('c', 'asm'), row('other', null), row('x', 'other')];

  it('returns a design and everything below it, in tree order', () => {
    expect(subtreeIds(rows, 'asm')).toEqual(['asm', 'sub', 'a', 'b', 'c']);
    expect(subtreeIds(rows, 'sub')).toEqual(['sub', 'a', 'b']);
  });

  it('returns only the design for a part, and never other trees', () => {
    expect(subtreeIds(rows, 'a')).toEqual(['a']);
    expect(subtreeIds(rows, 'other')).toEqual(['other', 'x']);
  });

  it('does not loop on a cycle', () => {
    expect(subtreeIds([row('p', 'q'), row('q', 'p')], 'p')).toEqual(['p', 'q']);
  });
});
