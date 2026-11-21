import { describe, expect, it } from 'vitest';

import { visibleTreeRows } from '@/lib/bom/tree-rows';

// The BOM tree of the liner: an assembly, two sub-assemblies, their child parts.
interface N { id: string; children: N[] }
const n = (id: string, ...children: N[]): N => ({ id, children });
const TREE = [n('liner', n('cannula', n('carriage'), n('housing')), n('chassis', n('rail')))];
const ALL = new Set(['liner', 'cannula', 'chassis']);
const rows = (expanded: ReadonlySet<string>) => visibleTreeRows(TREE, expanded).map((r) => ({ id: r.node.id, depth: r.depth, guides: r.guides, isLast: r.isLast }));

describe('the rows of the BOM tree and the lines each draws', () => {
  it('depth first, each row knowing which ancestor lines go on past it and whether it closes its branch (└) or not (├)', () => {
    expect(rows(ALL)).toEqual([
      { id: 'liner', depth: 0, guides: [], isLast: true },
      { id: 'cannula', depth: 1, guides: [], isLast: false },
      // cannula has a sibling below (chassis), so its line runs past its own children.
      { id: 'carriage', depth: 2, guides: [true], isLast: false },
      { id: 'housing', depth: 2, guides: [true], isLast: true },
      { id: 'chassis', depth: 1, guides: [], isLast: true },
      // chassis is the last sub-assembly: nothing runs past its child.
      { id: 'rail', depth: 2, guides: [false], isLast: true },
    ]);
  });

  it('a collapsed item hides its subtree; nothing expanded shows the root only', () => {
    expect(rows(new Set(['liner', 'chassis'])).map((r) => r.id)).toEqual(['liner', 'cannula', 'chassis', 'rail']);
    expect(rows(new Set()).map((r) => r.id)).toEqual(['liner']);
  });
});
