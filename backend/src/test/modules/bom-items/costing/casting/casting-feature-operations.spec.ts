import { join } from 'path';
import { CASTING_NOT_FORMED_OPERATION, selectCastingOperations, topLevelCatalogRows } from '../../../../../modules/bom-items/costing/casting/casting-feature-operations';
import { featureInstances } from '../../../../../modules/bom-items/costing/shared/tolerance/feature-tolerances';
import type { MachiningNeedResult } from '../../../../../modules/bom-items/costing/shared/tolerance/machining-need';

// Real data: the High Pressure Die Casting rows of memory/Die Casting/Processes/operations.csv.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const allRows: string[] = readCsv(join(__dirname, '../../../../../../../memory/Die Casting/Processes/operations.csv')).rows
  .map((r: Record<string, string>) => String(r['Process Name']));
const catalogOf = (process: string) => topLevelCatalogRows(allRows.filter((s: string) => s.startsWith(`${process}:`)));
const catalog = catalogOf('High Pressure Die Casting');

const z = [0, 0, 1];
const instances = featureInstances({ features: [
  { id: 'h', feature_type: 'SimpleHole', variant: 'through', occurrences: [
    { face_ids: [1], source_face_stable_ids: ['a'], diameter_mm: 6, depth_mm: 10, axis: [0, 0, 1], centroid: [0, 0, 0] },
    { face_ids: [2], source_face_stable_ids: ['b'], diameter_mm: 6, depth_mm: 10, axis: [1, 0, 0], centroid: [9, 0, 0] },
    { face_ids: [3], source_face_stable_ids: ['c'], diameter_mm: 2, depth_mm: 10, axis: [0, 0, 1], centroid: [0, 9, 0] },
  ] },
  { id: 'p', feature_type: 'PlanarFace', variant: 'default', occurrences: [{ face_ids: [0], source_face_stable_ids: ['p'] }] },
  { id: 's', feature_type: 'SlideBundle', variant: 'default', occurrences: [{ face_ids: [], source_face_stable_ids: [] }] },
] });
const need = {
  primaryProcess: 'High Pressure Die Casting', machiningRequired: true,
  features: [{ label: 'SimpleHole:3', forming: { operation: 'Drilling', capabilityProcess: 'Drilling', detail: [] } }],
} as unknown as MachiningNeedResult;
const groups = selectCastingOperations({ instances, catalog, need, pullAxis: z, notFormedOperation: CASTING_NOT_FORMED_OPERATION['High Pressure Die Casting']! });
const opOf = (label: string) => groups.find((g) => g.instances.some((i) => i.label === label))!;

describe('selectCastingOperations (real HPDC catalog)', () => {
  it('reads only top-level catalog rows', () => {
    expect(catalog).toEqual(expect.arrayContaining([{ operation: 'As Cast', featureType: 'SimpleHole' }, { operation: 'Slides', featureType: 'SlideBundle' }]));
    expect(catalog.every((r) => !r.operation.includes(':'))).toBe(true);
  });
  it('a hole along the pull is As Cast; across the pull is undetermined, with why', () => {
    expect(opOf('SimpleHole:1').operation).toBe('As Cast');
    expect(opOf('SimpleHole:2').operation).toBeNull();
    expect(opOf('SimpleHole:2').reason).toMatch(/side core/);
  });
  it('a hole the casting does not form is No Coring', () => {
    expect(opOf('SimpleHole:3').operation).toBe('No Coring');
  });
  it('single-operation features and slide bundles take their catalog operation', () => {
    expect(opOf('PlanarFace:1').operation).toBe('As Cast');
    expect(opOf('SlideBundle:1').operation).toBe('Slides');
  });
});

describe('selectCastingOperations (real GDC catalog)', () => {
  const gdc = catalogOf('Gravity Die Casting');
  const g = selectCastingOperations({ instances, catalog: gdc, need, pullAxis: z, notFormedOperation: CASTING_NOT_FORMED_OPERATION['Gravity Die Casting']! });
  const op = (label: string) => g.find((x) => x.instances.some((i) => i.label === label))!;

  it('every not-formed operation name is a real catalog operation of its process', () => {
    for (const [process, name] of Object.entries(CASTING_NOT_FORMED_OPERATION)) {
      expect(catalogOf(process).some((r) => r.operation === name)).toBe(true);
    }
  });
  it('a hole the casting does not form is No Side Pull in gravity die casting', () => {
    expect(op('SimpleHole:3').operation).toBe('No Side Pull');
    expect(op('SimpleHole:1').operation).toBe('As Cast');
  });
});
