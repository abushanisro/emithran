import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { catalogOperationPath, catalogOperationTree, type CatalogOperationNode } from '@/lib/features/catalog-operation-tree';

// Real data: the High Pressure Die Casting rows of memory/Die Casting/Processes/operations.csv.
const csv = readFileSync(join(__dirname, '../../../memory/Die Casting/Processes/operations.csv'), 'utf8').replace(/^﻿/, '');
const hpdc = csv.split(/\r?\n/).slice(1).map((l) => l.trim().replace(/^"|"$/g, ''))
  .filter((l) => l.startsWith('High Pressure Die Casting:'))
  .map((raw) => ({ operationCategory: null, featureType: null, raw }));

const label = (n: CatalogOperationNode) => `${n.operation} // ${n.featureType}`;
const count = (nodes: CatalogOperationNode[]): number => nodes.reduce((s, n) => s + 1 + count(n.children), 0);

describe('catalogOperationTree', () => {
  it('drops the machine prefix and keeps every Operation//Feature segment', () => {
    expect(catalogOperationPath({ operationCategory: null, featureType: null, raw: 'High Pressure Die Casting:Insert Coring//ComboVoid:As Cast//SimpleHole' }))
      .toEqual([{ operation: 'Insert Coring', featureType: 'ComboVoid' }, { operation: 'As Cast', featureType: 'SimpleHole' }]);
    expect(catalogOperationPath({ operationCategory: null, featureType: null, raw: 'Progressive Die:Die Station:Bending//StraightBend' }))
      .toEqual([{ operation: 'Bending', featureType: 'StraightBend' }]);
  });

  it('a bare operation row is one node from its own fields', () => {
    expect(catalogOperationPath({ operationCategory: 'Deburring', featureType: null, raw: 'Deburr:Deburring' }))
      .toEqual([{ operation: 'Deburring', featureType: null }]);
  });

  it('HPDC: no label repeats among siblings, and every catalog row is one path in the tree', () => {
    expect(hpdc.length).toBeGreaterThan(0);
    const tree = catalogOperationTree(hpdc);
    const check = (nodes: CatalogOperationNode[]) => {
      const labels = nodes.map(label);
      expect(new Set(labels).size).toBe(labels.length);
      nodes.forEach((n) => check(n.children));
    };
    check(tree);
    // Each row adds exactly one node (its last segment); its parents are earlier rows.
    expect(count(tree)).toBe(new Set(hpdc.map((r) => r.raw)).size);
    const insertCoringComboVoid = tree.find((n) => n.operation === 'Insert Coring' && n.featureType === 'ComboVoid')!;
    expect(insertCoringComboVoid.children.map(label)).toEqual(['As Cast // MultiStepHole', 'As Cast // Ring', 'As Cast // SimpleHole']);
    expect(insertCoringComboVoid.children[0]!.children.map(label)).toEqual(['As Cast // SimpleHole']);
  });
});
