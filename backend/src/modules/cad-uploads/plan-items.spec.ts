import { BOMItemType } from '../bom-items/dto/bom-items.dto';

import { parseAssemblyReport, type AssemblyNode, type AssemblyReport } from './assembly-report';
import { planItems } from './plan-items';

const node = (definition: string, name: string, kind: AssemblyNode['kind'], quantity = 1, children: AssemblyNode[] = [], file = 'asm.step'): AssemblyNode =>
  ({ definition, name, kind, quantity, file, children });

const report = (assembly: AssemblyNode[]): AssemblyReport => ({
  schema_version: 1, units: 'mm', status: 'complete', inputs: [], problems: [], assembly,
  parts: [],
});

describe('planItems', () => {
  it('turns the tree into one BOM line per node, parents first, with the right type and quantity', () => {
    const tree = node('0:1', 'Top', 'assembly', 1, [
      node('0:2', 'Sub', 'assembly', 2, [node('0:3', 'Box', 'part', 2)]),
      node('0:4', 'Cyl', 'part', 1),
    ]);
    const items = planItems(report([tree]), 'ab12');
    expect(items.map((i) => [i.key, i.parentKey, i.name, i.itemType, i.quantity])).toEqual([
      ['0', null, 'Top', BOMItemType.ASSEMBLY, 1],
      ['0.0', '0', 'Sub', BOMItemType.SUB_ASSEMBLY, 2],
      ['0.0.0', '0.0', 'Box', BOMItemType.CHILD_PART, 2],
      ['0.1', '0', 'Cyl', BOMItemType.CHILD_PART, 1],
    ]);
  });

  it('gives every line a distinct part number, whatever the names', () => {
    const items = planItems(report([node('a', 'Bolt', 'part', 1, [], 'a.step'), node('b', 'Bolt', 'part', 1, [], 'b.step'), node('c', '###', 'part', 1, [], 'c.step')]), 'ab12');
    expect(new Set(items.map((i) => i.partNumber)).size).toBe(3);
    expect(items[2]!.partNumber).toMatch(/^PART-ab12-3$/);
  });

  it('attaches a file only to a part whose own file is that single part', () => {
    const inFile = node('0:3', 'Box', 'part', 1, [], 'assembly.step');
    const loose = node('1:1', 'Washer', 'part', 1, [], 'washer.step');
    const items = planItems(report([node('0:1', 'Top', 'assembly', 1, [inFile], 'assembly.step'), loose]), 't');
    expect(Object.fromEntries(items.map((i) => [i.name, i.ownFile]))).toEqual({ Top: null, Box: null, Washer: 'washer.step' });
  });

  it('plans a lone part file as one top-level part', () => {
    const items = planItems(report([node('0:1', 'Gear', 'part', 1, [], 'gear.step')]), 't');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ parentKey: null, itemType: BOMItemType.CHILD_PART, ownFile: 'gear.step' });
  });
});

describe('planItems measurements', () => {
  it('carries what the engine measured onto the part, and nothing invented when it could not', () => {
    const r = report([node('0:1', 'Top', 'assembly', 1, [node('0:2', 'Box', 'part'), node('0:3', 'Odd', 'part')])]);
    r.parts = [
      { id: '0:2', name: 'Box', file: 'asm.step', quantity_total: 1, volume_mm3: 6000, surface_area_mm2: 2200, bounding_box: { length: 30, width: 20, height: 10, diagonal: 37 } },
      { id: '0:3', name: 'Odd', file: 'asm.step', quantity_total: 1, volume_mm3: null, surface_area_mm2: null, bounding_box: null },
    ];
    const byName = Object.fromEntries(planItems(r, 't').map((i) => [i.name, i.measured]));
    expect(byName).toEqual({ Top: null, Box: { volume: 6000, surfaceArea: 2200, maxLength: 30, maxWidth: 20, maxHeight: 10 }, Odd: null });
  });
});

describe('parseAssemblyReport', () => {
  it('accepts a report that follows the contract and rejects one that does not', () => {
    const ok = report([node('0:1', 'Gear', 'part', 1, [], 'gear.step')]);
    expect(parseAssemblyReport(ok)).toEqual(ok);
    expect(() => parseAssemblyReport({ ...ok, schema_version: 2 })).toThrow(/outside its assembly contract/);
    expect(() => parseAssemblyReport({ ...ok, assembly: [{ ...ok.assembly[0], quantity: 0 }] })).toThrow(/outside its assembly contract/);
  });

  it('matches the canonical schema in cad-engine (run npm run cad:sync-contract when this fails)', () => {
    const { render, out } = require('../../../scripts/sync-cad-contract.js');
    expect(require('fs').readFileSync(out, 'utf8')).toBe(render());
  });
});
