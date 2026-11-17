import { describe, expect, it } from 'vitest';

import type { BOMItem, CostSummaryDto } from '@/lib/api/hooks/useBOMItems';
import { buildProcessTree, collectLeaves, findNode, type ProcessTreeNode } from '@/lib/features/process-tree';
import type { FeatureGraph, FeatureGraphSummary } from '@/lib/types/manufacturing';

// Records what the process tree shows today for a part with no feature data, so the tree's choice of which process list to show cannot change unnoticed.
const item = { id: 'i1', name: 'Bracket', partNumber: 'P-1', material: 'Steel', materialGrade: 'CRCA', quantity: 1 } as unknown as BOMItem;
const summary = {} as FeatureGraphSummary;
const stored = [
  { opNbr: 20, category: 'Deburring', machineName: 'Deburr 1', machineClass: 'deburr' },
  { opNbr: 10, category: 'Laser Cutting', machineName: 'Trumpf 3030' },
  { opNbr: 30, category: 'Removed step', isActive: false },
];
const recommended = { processRecommendations: [{ process: 'Turret Punching', estimated_time_sec: 42 }] } as unknown as FeatureGraph;
const costed = { processLines: [{ process: 'Injection Molding', cycleTimeMin: 0.5, machineName: 'Arburg' }] } as unknown as CostSummaryDto;

const operations = (tree: ProcessTreeNode) => (tree.children ?? []).flatMap((g) => g.children ?? []).map((o) => `${o.label} @ ${o.machine}`);

describe('buildProcessTree: which process list the tree shows', () => {
  it('shows only the part when nothing is applied, saved, recommended or costed', () => {
    expect(buildProcessTree(item, null, summary, 'Plant A')).toEqual({ id: 'root', kind: 'part', label: 'Bracket', factory: 'Plant A', children: [] });
  });

  it('shows the chosen route first, in the order given', () => {
    expect(operations(buildProcessTree(item, recommended, summary, 'Plant A', ['Laser Cutting', 'Bending'], costed, null, stored)))
      .toEqual(['Laser Cutting @ Trumpf 3030', 'Bending @ —']);
  });

  it('shows the saved process rows, in operation order and without inactive rows, ahead of the recommendation and the costed lines', () => {
    expect(operations(buildProcessTree(item, recommended, summary, 'Plant A', undefined, costed, null, stored)))
      .toEqual(['Laser Cutting @ Trumpf 3030', 'Deburring @ Deburr 1']);
  });

  it('shows the analysis recommendation when nothing is chosen or saved', () => {
    expect(operations(buildProcessTree(item, recommended, summary, 'Plant A', undefined, costed))).toEqual(['Turret Punching @ —']);
  });

  it('falls back to the costed lines, with the machine each was costed on', () => {
    expect(operations(buildProcessTree(item, null, summary, 'Plant A', undefined, costed))).toEqual(['Injection Molding @ Arburg']);
  });

  it('puts every operation under one process group and gives an operation without features a single placeholder row', () => {
    const tree = buildProcessTree(item, null, summary, 'Plant A', ['Laser Cutting', 'Bending']);
    expect(tree.children?.map((g) => `${g.kind} ${g.id} ${g.label}`)).toEqual(['group grp_0 Unclassified']);
    expect(collectLeaves(tree).map((l) => `${l.kind} ${l.id} ${l.label}`)).toEqual(['feature nodata_0 No feature data', 'feature nodata_1 No feature data']);
  });
});

describe('findNode', () => {
  const tree = buildProcessTree(item, null, summary, 'Plant A', ['Laser Cutting', 'Bending']);

  it('finds a node at any depth by its id', () => {
    expect(findNode(tree, 'op_1')?.label).toBe('Bending');
    expect(findNode(tree, 'nodata_0')?.kind).toBe('feature');
  });

  it('returns null for an id that is not in the tree', () => {
    expect(findNode(tree, 'missing')).toBeNull();
  });
});
