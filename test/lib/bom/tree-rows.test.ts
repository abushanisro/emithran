import { describe, expect, it } from 'vitest';

import { filterTree, highlightParts, matchesQuery, visibleTreeRows } from '@/lib/bom/tree-rows';

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

describe('the line colours: each row knows the ancestors its lines come down from', () => {
  it('a guide column is drawn by the ancestor whose trunk it is, the connector by the parent', () => {
    const housing = visibleTreeRows(TREE, ALL).find((r) => r.node.id === 'housing')!;
    // liner's trunk runs past cannula's children (green), cannula's connects housing (blue).
    expect(housing.path.map((p) => p.id)).toEqual(['liner', 'cannula']);
    expect(visibleTreeRows(TREE, ALL)[0]!.path).toEqual([]);
  });
});

// The real liner BOM's names and part numbers.
interface Item { id: string; name: string; partNumber: string; children: Item[] }
const it_ = (id: string, name: string, partNumber: string, ...children: Item[]): Item => ({ id, name, partNumber, children });
const BOM = [it_('liner', 'liner', 'LINER-305c86-1',
  it_('cannula', 'Cannula Holder bottom', 'CANNULA-HOLDER-BOTTO-305c86-3',
    it_('carriage', 'R_M-0230-033_CARRIAGE MOUNT', 'R-M-0230-033-CARRIAG-305c86-6'),
    it_('housing', 'R_M-0230-032_LEAD NUT HOUSING', 'R-M-0230-032-LEAD-NU-305c86-7')),
  it_('chassis', 'R_M-0230-021_MAIN CHASSIS', 'R-M-0230-021-MAIN-CH-305c86-13'))];
const search = (q: string) => filterTree(BOM, (n) => matchesQuery(q, n.name, n.partNumber));

describe('searching the BOM by name or part number', () => {
  it('keeps each match with its ancestors (its place in the BOM) and opens the branches to it', () => {
    const r = search('lead nut');
    expect([...r.matches]).toEqual(['housing']);
    expect(r.nodes.map((n) => n.id)).toEqual(['liner']);
    expect(r.nodes[0]!.children.map((n) => n.id)).toEqual(['cannula']);
    expect(r.nodes[0]!.children[0]!.children.map((n) => n.id)).toEqual(['housing']);
    expect([...r.expand].sort()).toEqual(['cannula', 'liner']);
  });

  it('matches part numbers too, every word in any order and case; a matching parent keeps all its children', () => {
    expect([...search('305c86-13').matches]).toEqual(['chassis']);
    expect([...search('MOUNT carriage').matches]).toEqual(['carriage']);
    const holder = search('cannula holder');
    expect(holder.nodes[0]!.children[0]!.children.map((n) => n.id)).toEqual(['carriage', 'housing']);
  });

  it('no match: nothing left; an empty search matches everything', () => {
    expect(search('bracket')).toMatchObject({ nodes: [], matches: new Set(), expand: new Set() });
    expect(matchesQuery('  ', 'anything')).toBe(true);
  });

  it('marks the matched words in the text', () => {
    expect(highlightParts('R_M-0230-032_LEAD NUT HOUSING', 'lead housing')).toEqual([['R_M-0230-032_', false], ['LEAD', true], [' NUT ', false], ['HOUSING', true]]);
    expect(highlightParts('liner', '')).toEqual([['liner', false]]);
  });
});
