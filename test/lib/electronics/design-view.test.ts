import { describe, expect, it } from 'vitest';

import type { DesignView } from '@/lib/api/electronics';
import { buildDesignTree, containerDetails, isRead, openHref, deleteImpact, deleteSentence, designHref, detailItems, itemTypeLabel, levelLabel, listHref, isInFlight, partsUnder, subtreeOf, typeLabel, latestRevision, selectRevision, statusLabel } from '@/lib/electronics/design-view';

function first<T>(items: T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error('expected at least one item');
  return item;
}

const design: DesignView = {
  id: 'd1',
  name: 'BoardA',
  kind: 'board',
  itemType: 'child_part',
  parentId: null,
  projectId: 'p1',
  createdAt: '2026-10-16T10:00:00Z',
  summary: null,
  revisions: [
    { id: 'r2', revision: '2', createdAt: '2026-10-16T11:00:00Z', uploadId: 'u2', status: 'parsing', failure: null },
    { id: 'r1', revision: '1', createdAt: '2026-10-16T10:00:00Z', uploadId: 'u1', status: 'needs_review', failure: null },
  ],
};

describe('design view helpers', () => {
  it('names every status and a missing upload', () => {
    expect(statusLabel('needs_review')).toBe('Needs review');
    expect(statusLabel('failed')).toBe('Failed');
    expect(statusLabel(null)).toBe('No upload');
  });

  it('keeps refreshing only while the engine is working', () => {
    expect(isInFlight('uploaded')).toBe(true);
    expect(isInFlight('parsing')).toBe(true);
    expect(isInFlight('needs_review')).toBe(false);
    expect(isInFlight(null)).toBe(false);
  });

  it('shows the requested revision, else the newest', () => {
    expect(latestRevision(design)?.id).toBe('r2');
    expect(selectRevision(design, 'r1')?.id).toBe('r1');
    expect(selectRevision(design, 'gone')?.id).toBe('r2');
    expect(selectRevision({ ...design, revisions: [] }, null)).toBeNull();
  });

  it('labels PCB, PCBA and harness from what the files held', () => {
    const board = (assembled: boolean): DesignView => ({ ...design, summary: { kind: 'board', assembled, layers: 2, lengthMm: 10, widthMm: 5, thicknessMm: null, holeCount: 0, placementCount: 0, unresolvedCount: 0 } });
    expect(typeLabel(board(true))).toBe('PCBA');
    expect(typeLabel(board(false))).toBe('PCB');
    expect(typeLabel(design)).toBe('Board');
    expect(typeLabel({ ...design, kind: 'harness' })).toBe('Wire harness');
  });

  it('shows only what was measured: a missing thickness is a dash, a board with no graph yet says it is being read', () => {
    const measured: DesignView = {
      ...design,
      revisions: [{ ...design.revisions[1], status: 'needs_review' }],
      summary: { kind: 'board', assembled: true, layers: 2, lengthMm: 273.7, widthMm: 170.7, thicknessMm: null, holeCount: 226, placementCount: 626, unresolvedCount: 3 },
    };
    const items = Object.fromEntries(detailItems(measured).map((i) => [i.label, i.value]));
    expect(items).toMatchObject({ Layers: '2', Size: '273.7×170.7 mm', Thickness: '—', Holes: '226', Placements: '626', Unresolved: '3', Revision: '1' });
    expect(detailItems(design).find((i) => i.label === 'Features')?.value).toBe('being read…');
  });

  it('shows the series chains and spacing traced from the copper, and nothing when the graph has none', () => {
    const traced: DesignView = {
      ...design,
      revisions: [{ ...design.revisions[1], status: 'needs_review' }],
      summary: { kind: 'board', assembled: true, layers: 2, lengthMm: 273.7, widthMm: 170.7, thicknessMm: null, holeCount: 226, placementCount: 626, seriesChains: 89, minSpacingMm: 0.357, unresolvedCount: 3 },
    };
    const items = Object.fromEntries(detailItems(traced).map((i) => [i.label, i.value]));
    expect(items).toMatchObject({ 'Series chains': '89', 'Min spacing': '0.357 mm' });
    const untraced: DesignView = { ...traced, summary: { ...traced.summary, seriesChains: null, minSpacingMm: null } as DesignView['summary'] };
    expect(detailItems(untraced).map((i) => i.label)).not.toContain('Series chains');
    expect(detailItems(untraced).map((i) => i.label)).not.toContain('Min spacing');
  });

  it('shows circuits and connectors of a harness', () => {
    const harness: DesignView = { ...design, kind: 'harness', summary: { kind: 'harness', circuitCount: 2, connectorCount: 4, unresolvedCount: 0 } };
    const items = Object.fromEntries(detailItems(harness).map((i) => [i.label, i.value]));
    expect(items).toMatchObject({ Circuits: '2', Connectors: '4' });
  });

  it('opens a design inside its project', () => {
    expect(listHref('p1')).toBe('/projects/p1/electronics');
    expect(designHref('p1', 'd1')).toBe('/projects/p1/electronics/d1');
    expect(designHref('p1', 'd1', 'r2')).toBe('/projects/p1/electronics/d1?revision=r2');
  });
});

describe('assembly structure', () => {
  const node = (id: string, itemType: DesignView['itemType'], parentId: string | null, over: Partial<DesignView> = {}): DesignView => ({
    ...design,
    id,
    name: id,
    itemType,
    parentId,
    kind: itemType === 'child_part' ? 'board' : 'assembly',
    revisions: [],
    ...over,
  });
  const designs = [
    node('asm', 'assembly', null),
    node('sub', 'sub_assembly', 'asm'),
    node('a', 'child_part', 'sub', { revisions: [{ id: 'r', revision: '1', createdAt: '', uploadId: 'u', status: 'failed', failure: { code: 'extraction_failed', message: 'x' } }] }),
    node('b', 'child_part', 'sub', { kind: 'harness', revisions: [{ id: 'r2', revision: '1', createdAt: '', uploadId: 'u2', status: 'parsing', failure: null }] }),
    node('c', 'child_part', 'asm'),
    node('loose', 'child_part', null),
    node('orphan', 'child_part', 'missing-parent'),
  ];

  it('builds Assembly > Sub-Assembly > Child Part, keeps order, and shows a design whose container is missing at the top', () => {
    const tree = buildDesignTree(designs);
    expect(tree.map((n) => n.design.id)).toEqual(['asm', 'loose', 'orphan']);
    const asm = tree[0];
    expect(asm?.children.map((n) => [n.design.id, n.depth])).toEqual([['sub', 1], ['c', 1]]);
    expect(asm?.children[0]?.children.map((n) => [n.design.id, n.depth])).toEqual([['a', 2], ['b', 2]]);
  });

  it('names levels like the BOM', () => {
    expect(itemTypeLabel('assembly')).toBe('Assembly');
    expect(itemTypeLabel('sub_assembly')).toBe('Sub-Assembly');
    expect(itemTypeLabel('child_part')).toBe('Child Part');
    expect(levelLabel(2)).toBe('L2');
    expect(typeLabel(node('x', 'sub_assembly', null))).toBe('Sub-Assembly');
  });

  it('lists the parts under a container and counts what needs attention', () => {
    const asm = first(buildDesignTree(designs));
    expect(partsUnder(asm).map((p) => p.id)).toEqual(['a', 'b', 'c']);
    const details = Object.fromEntries(containerDetails(asm).map((d) => [d.label, d.value]));
    expect(details).toMatchObject({ 'Child parts': '3', Boards: '2', Harnesses: '1', 'Sub-assemblies': '1', Failed: '1', 'Being read': '1' });
  });
});

describe('subtreeOf', () => {
  const make = (id: string, itemType: DesignView['itemType'], parentId: string | null): DesignView => ({ ...design, id, name: id, itemType, parentId, kind: itemType === 'child_part' ? 'board' : 'assembly', revisions: [] });
  const all = [make('asm', 'assembly', null), make('sub', 'sub_assembly', 'asm'), make('a', 'child_part', 'sub'), make('other', 'assembly', null), make('x', 'child_part', 'other')];

  it('returns a container and everything below it in tree order, and nothing from other trees', () => {
    expect(subtreeOf(all, 'asm').map((d) => d.id)).toEqual(['asm', 'sub', 'a']);
    expect(subtreeOf(all, 'sub').map((d) => d.id)).toEqual(['sub', 'a']);
    expect(subtreeOf(all, 'missing')).toEqual([]);
  });
});

describe('delete impact', () => {
  const make = (id: string, itemType: DesignView['itemType'], parentId: string | null, revisions = 0): DesignView => ({
    ...design,
    id,
    name: id,
    itemType,
    parentId,
    kind: itemType === 'child_part' ? 'board' : 'assembly',
    revisions: Array.from({ length: revisions }, (_, i) => ({ id: `${id}-${i}`, revision: String(i + 1), createdAt: '', uploadId: `u${i}`, status: 'needs_review' as const, failure: null })),
  });
  const tree = buildDesignTree([make('asm', 'assembly', null), make('sub', 'sub_assembly', 'asm'), make('a', 'child_part', 'sub', 2), make('b', 'child_part', 'asm', 1)]);

  it('counts what an assembly delete removes, and what a part delete removes', () => {
    expect(deleteImpact(first(tree))).toEqual({ containers: 2, parts: 2, revisions: 3 });
    expect(deleteImpact(first(first(tree).children.slice(1)))).toEqual({ containers: 0, parts: 1, revisions: 1 });
  });

  it('states it in words, with plurals', () => {
    expect(deleteSentence({ containers: 2, parts: 2, revisions: 3 })).toBe('2 assemblies and sub-assemblies, 2 child parts, 3 revisions with their uploaded files, extracted features and cost results');
    expect(deleteSentence({ containers: 0, parts: 1, revisions: 1 })).toBe('1 child part, 1 revision with their uploaded files, extracted features and cost results');
  });
});

describe('where opening a design goes', () => {
  const read = { id: 'r1', revision: '1', createdAt: '', uploadId: 'u1', status: 'needs_review' as const, failure: null };
  const failed = { id: 'r2', revision: '2', createdAt: '', uploadId: 'u2', status: 'failed' as const, failure: { code: 'x', message: 'y' } };

  it('opens a read board in the full-screen workspace, and anything else on its page', () => {
    expect(openHref('p1', { ...design, revisions: [read] })).toBe('/projects/p1/electronics/d1/manufacturing-intelligence');
    expect(openHref('p1', { ...design, revisions: [failed, read] })).toBe('/projects/p1/electronics/d1');
    expect(openHref('p1', { ...design, revisions: [failed, read] }, 'r1')).toBe('/projects/p1/electronics/d1/manufacturing-intelligence?revision=r1');
    expect(openHref('p1', { ...design, kind: 'harness', revisions: [read] })).toBe('/projects/p1/electronics/d1');
  });

  it('knows a read revision from one that is not', () => {
    expect(isRead(read)).toBe(true);
    expect(isRead(failed)).toBe(false);
    expect(isRead(null)).toBe(false);
  });
});
