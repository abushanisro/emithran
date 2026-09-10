import { describe, it, expect } from 'vitest';
import { adaptMappingsToProcessCatalogTree, ProcessCatalogValidationError } from '@/lib/processCatalog/process-catalog-tree';
import type { ProcessCalculatorMapping } from '@/lib/api/hooks/useProcessCalculatorMappings';

function mapping(overrides: Partial<ProcessCalculatorMapping> = {}): ProcessCalculatorMapping {
  return {
    id: 'map-1',
    processGroup: 'Sheet Metal',
    processRoute: 'Bending/Floating /Forming',
    operation: 'Bend Brake',
    machineClass: 'press_brake',
    isActive: true,
    displayOrder: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as ProcessCalculatorMapping;
}

describe('adaptMappingsToProcessCatalogTree', () => {
  it('builds a real 3-level Group -> Route -> Operation tree from the flat mappings list', () => {
    const tree = adaptMappingsToProcessCatalogTree([mapping()]);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ id: 'Sheet Metal', label: 'Sheet Metal', level: 'group' });
    expect(tree[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]).toMatchObject({ id: 'Sheet Metal::Bending/Floating /Forming', level: 'route' });
    expect(tree[0]!.children[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.children[0]).toMatchObject({
      id: 'Sheet Metal::Bending/Floating /Forming::Bend Brake',
      label: 'Bend Brake',
      level: 'operation',
      machineClass: 'press_brake',
      mappingId: 'map-1',
    });
  });

  it('groups multiple real operations under the same route, and multiple routes under the same group', () => {
    const tree = adaptMappingsToProcessCatalogTree([
      mapping({ id: 'm1', operation: 'Bend Brake', machineClass: 'press_brake' }),
      mapping({ id: 'm2', operation: 'Deburr', machineClass: 'deburring', processRoute: 'Finishing' }),
      mapping({ id: 'm3', operation: 'Laser Cut', machineClass: 'fiber_laser', processRoute: 'Laser Cutting' }),
    ]);
    expect(tree).toHaveLength(1); // still one group: Sheet Metal
    const routeLabels = tree[0]!.children.map((r) => r.label).sort();
    expect(routeLabels).toEqual(['Bending/Floating /Forming', 'Finishing', 'Laser Cutting'].sort());
  });

  it('excludes inactive mappings — never shown as a pickable operation', () => {
    const tree = adaptMappingsToProcessCatalogTree([
      mapping({ id: 'm1', operation: 'Bend Brake', isActive: true }),
      mapping({ id: 'm2', operation: 'Retired Op', isActive: false }),
    ]);
    const ops = tree[0]!.children[0]!.children.map((o) => o.label);
    expect(ops).toEqual(['Bend Brake']);
  });

  it('a route/group whose only mapping is inactive is omitted entirely, not shown as an empty dead end', () => {
    const tree = adaptMappingsToProcessCatalogTree([
      mapping({ id: 'm1', operation: 'Bend Brake', isActive: true }),
      mapping({ id: 'm2', operation: 'Old Op', isActive: false, processRoute: 'Retired Route', processGroup: 'Retired Group' }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.label).toBe('Sheet Metal');
  });

  it('first real mapping wins on a duplicate (group, route, operation) triple — never silently overwritten', () => {
    const tree = adaptMappingsToProcessCatalogTree([
      mapping({ id: 'first', machineClass: 'press_brake' }),
      mapping({ id: 'second', machineClass: 'roll_bending_2' }),
    ]);
    expect(tree[0]!.children[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.children[0]!.mappingId).toBe('first');
  });

  // The exact defect the retired GET /processes/calculator-mappings/hierarchy
  // endpoint had: it returned every group, every route and every operation as
  // three separate flat lists with no relationship between them, so a route
  // belonging to one group was offered under a completely unrelated one.
  it("never offers another group's route, or another route's operation, under this one", () => {
    const tree = adaptMappingsToProcessCatalogTree([
      mapping({ id: 'm1', processGroup: 'Sheet Metal', processRoute: 'Laser Cutting', operation: 'Laser Cut' }),
      mapping({ id: 'm2', processGroup: 'Machining', processRoute: 'Drilling', operation: 'Tapping' }),
      mapping({ id: 'm3', processGroup: 'Sheet Metal', processRoute: 'Finishing', operation: 'Deslag' }),
    ]);

    const sheetMetal = tree.find((g) => g.label === 'Sheet Metal')!;
    const machining = tree.find((g) => g.label === 'Machining')!;

    expect(sheetMetal.children.map((r) => r.label).sort()).toEqual(['Finishing', 'Laser Cutting']);
    expect(machining.children.map((r) => r.label)).toEqual(['Drilling']);

    // 'Tapping' is a real operation in the catalog, but only under
    // Machining -> Drilling — it must not appear under any Sheet Metal route.
    for (const route of sheetMetal.children) {
      expect(route.children.map((o) => o.label)).not.toContain('Tapping');
    }
    // ...and Sheet Metal's own operations stay in their own route.
    expect(sheetMetal.children.find((r) => r.label === 'Laser Cutting')!.children.map((o) => o.label)).toEqual(['Laser Cut']);
    expect(sheetMetal.children.find((r) => r.label === 'Finishing')!.children.map((o) => o.label)).toEqual(['Deslag']);
  });

  // The authoring surface (Process page's Add/Edit Calculator Mapping dialog)
  // must still see a real-but-inactive row: e.g. every Machining row, which
  // has no calculator wired yet but is a real row an admin edits here.
  describe('includeInactive (authoring surfaces)', () => {
    it('keeps inactive operations, and the groups/routes that only have inactive ones', () => {
      const tree = adaptMappingsToProcessCatalogTree(
        [
          mapping({ id: 'm1', operation: 'Bend Brake', isActive: true }),
          mapping({
            id: 'm2',
            operation: 'Tapping',
            isActive: false,
            processGroup: 'Machining',
            processRoute: 'Drilling',
          }),
        ],
        { includeInactive: true },
      );
      expect(tree.map((g) => g.label).sort()).toEqual(['Machining', 'Sheet Metal']);
      const machining = tree.find((g) => g.label === 'Machining')!;
      expect(machining.children[0]!.children[0]).toMatchObject({ label: 'Tapping', isActive: false });
    });

    it('still scopes each level — an inactive row does not leak across groups either', () => {
      const tree = adaptMappingsToProcessCatalogTree(
        [
          mapping({ id: 'm1', processGroup: 'Sheet Metal', processRoute: 'Finishing', operation: 'Deburr' }),
          mapping({
            id: 'm2',
            processGroup: 'Machining',
            processRoute: 'Drilling',
            operation: 'Tapping',
            isActive: false,
          }),
        ],
        { includeInactive: true },
      );
      const sheetMetal = tree.find((g) => g.label === 'Sheet Metal')!;
      expect(sheetMetal.children.map((r) => r.label)).toEqual(['Finishing']);
      expect(sheetMetal.children[0]!.children.map((o) => o.label)).toEqual(['Deburr']);
    });

    it('defaults to active-only, so a picking surface can never offer a retired row', () => {
      const tree = adaptMappingsToProcessCatalogTree([
        mapping({ id: 'm1', operation: 'Bend Brake', isActive: true }),
        mapping({ id: 'm2', operation: 'Laser Puch', isActive: false }),
      ]);
      const ops = tree[0]!.children[0]!.children;
      expect(ops.map((o) => o.label)).toEqual(['Bend Brake']);
      expect(ops[0]!.isActive).toBe(true);
    });
  });

  it('an empty mappings list produces an empty tree, never a crash', () => {
    expect(adaptMappingsToProcessCatalogTree([])).toEqual([]);
  });

  it('rejects a malformed mapping (missing processGroup) loudly instead of silently producing a broken tree', () => {
    const malformed = [{ ...mapping(), processGroup: undefined }] as unknown as ProcessCalculatorMapping[];
    expect(() => adaptMappingsToProcessCatalogTree(malformed)).toThrow(ProcessCatalogValidationError);
  });
});
