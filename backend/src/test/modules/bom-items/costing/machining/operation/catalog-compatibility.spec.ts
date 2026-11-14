import { machiningCatalogCompatibility } from '../../../../../../modules/bom-items/costing/machining/operation/catalog-compatibility';
import { readMachiningMemoryCsv } from '../real-reference-tables';

// The reference operation catalog itself (memory/Machining/operations_full__operations.csv, 1174 rows).
const CATALOG = readMachiningMemoryCsv('operations_full__operations.csv').map((r) => r['processName']!);

// Cannula Holder bottom: the operation the CAD engine states for each of its feature groups.
const feature = (feature_type: string, operation: string, n: number) =>
  ({ id: `${feature_type}-${n}`, feature_type, variant: 'default', canonical_operation: `${operation} // ${feature_type}`, occurrences: Array(n).fill({}) });
const PART = [
  feature('Edge', 'Rounding', 32), feature('SimpleHole', 'Tapping', 8), feature('SimpleHole', 'Drilling', 5),
  feature('PocketV2', 'Rough Milling', 16), feature('Keyway', 'Rough Milling', 1), feature('Slot', 'Groove Milling', 6),
  feature('PlanarFace', 'Fine Finish Milling', 19), feature('CurvedWall', 'Contouring', 4), feature('CurvedSurface', 'Contouring', 8),
];

describe('machiningCatalogCompatibility: what a machine can make, read from the reference catalog', () => {
  it.each(['3 Axis Mill', '4 Axis Mill', '5 Axis Mill'])('%s makes every feature of the part', (process) => {
    expect(machiningCatalogCompatibility(PART, CATALOG, process)).toMatchObject({ status: 'compatible', incompatibilities: [] });
  });

  it('a 2 axis lathe cannot: it has no milling operation for pockets, faces, the keyway or the curved surfaces', () => {
    const v = machiningCatalogCompatibility(PART, CATALOG, '2 Axis Lathe')!;
    expect(v.status).toBe('incompatible');
    expect(v.incompatibilities.map((i) => i.featureType)).toEqual(expect.arrayContaining(['PocketV2', 'PlanarFace', 'Keyway', 'CurvedWall']));
    expect(v.incompatibilities.find((i) => i.featureType === 'PocketV2')).toMatchObject({
      count: 16, kind: 'not_in_process_vocabulary', reason: '2 Axis Lathe has no "Rough Milling // PocketV2" operation in the machining catalog',
    });
  });

  it('MillTurn contours with its live tooling (the catalog calls it Mill Contouring) but has no edge rounding, so it is ruled out by the 32 rounded edges alone', () => {
    const v = machiningCatalogCompatibility(PART, CATALOG, 'MillTurn')!;
    expect(v.incompatibilities.map((i) => i.featureType)).toEqual(['Edge']);
    expect(machiningCatalogCompatibility(PART.filter((f) => f.feature_type !== 'Edge'), CATALOG, 'MillTurn')!.status).toBe('compatible');
  });

  it('an operation that is a step of a compound feature counts (Rounding // SimpleHole : Rounding // Edge)', () => {
    expect(machiningCatalogCompatibility([feature('Edge', 'Rounding', 1)], ['X:Rounding//SimpleHole:Rounding//Edge'], 'X')!.status).toBe('compatible');
  });

  it('gives no verdict without a catalog or without a feature that states its operation', () => {
    expect(machiningCatalogCompatibility(PART, null, '3 Axis Mill')).toBeNull();
    expect(machiningCatalogCompatibility([{ feature_type: 'Edge' }], CATALOG, '3 Axis Mill')).toBeNull();
  });
});
