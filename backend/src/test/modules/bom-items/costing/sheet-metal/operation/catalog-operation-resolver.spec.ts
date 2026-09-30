import { readFileSync } from 'fs';
import { join } from 'path';
import {
  resolveCatalogOperations,
  catalogPairs,
  type SheetMetalFeature,
} from '../../../../../../modules/bom-items/costing/sheet-metal/operation/catalog-operation-resolver';

// Real data only: the catalog from memory/, the kinds from migration 842 (what
// the database holds), the punch factor from memory/ sheet-metal variables and
// the punch size from the real machine library.
const REPO = join(__dirname, '../../../../../../../..');
const CATALOG = readFileSync(join(REPO, 'memory/Sheetmetal/process/process_operations.csv'), 'utf-8')
  .replace(/^﻿/, '').split(/\r?\n/).slice(1).filter(Boolean);
// Plus the station rows migration 725 seeded for processes the CSV has no block
// for (the Tapping and Burring stations).
const STATION_ROWS = [...readFileSync(
  join(REPO, 'backend/migrations/725_sync_process_taxonomy_machine_class_and_backfill_undetailed_ops.sql'), 'utf-8',
).matchAll(/'((?:Tapping|Hole Extrusion \(Burring\)):[^']+)'/g)].map((m) => m[1]!);
const catalogFor = (process: string) =>
  [...CATALOG, ...STATION_ROWS].filter((r) => r.split(':')[0] === process);

const SQL = readFileSync(join(REPO, 'backend/migrations/842_sheet_metal_operation_kinds.sql'), 'utf-8');
const section = (table: string) => SQL.split(`INSERT INTO public.${table}`)[1]!.split('ON CONFLICT')[0]!;
const operationKinds = new Map(
  [...section('sm_operation_kinds').matchAll(/\('([^']+)', '([a-z_]+)'\)/g)].map((m) => [m[1]!, m[2]!]),
);
const variantKinds = new Map<string, Set<string>>();
for (const m of section('sm_feature_variant_kinds').matchAll(/\('([^']+)', '([^']+)', '([a-z_]+)'\)/g)) {
  const key = `${m[1]}:${m[2]}`;
  variantKinds.set(key, (variantKinds.get(key) ?? new Set()).add(m[3]!));
}

// Columns: source, variableCount, variableName, stringValue, ...
const variable = (name: string) => Number(
  readFileSync(join(REPO, 'memory/Sheetmetal/sheet_metal_variables.csv'), 'utf-8')
    .split(/\r?\n/).map((l) => l.split(',')).find((c) => c[2] === name)![3],
);
const MIN_PUNCH_FACTOR = variable('minPunchingThicknessFactor');
const NIBBLE_CAP = variable('turretMaxPercentNibbledPeriemter');

const library = readFileSync(join(REPO, 'memory/Sheetmetal/machine/machine_library.csv'), 'utf-8').split(/\r?\n/);
const header = library[0]!.split(',');
const turretRow = library.slice(1).map((l) => l.split(','))
  .find((r) => r.length === header.length && r[header.indexOf('machine_category')] === 'Turret Press (Punch Press)'
    && r[header.indexOf('max_punch_size_mm')])!;
const MAX_PUNCH = Number(turretRow[header.indexOf('max_punch_size_mm')]);

const occ = (n: number, firstFace: number) =>
  Array.from({ length: n }, (_, i) => ({ face_ids: [firstFace + i] }));

// A 2 mm part the way the CAD engine reports it: 14 small through holes, one
// large round cut-out, a perforation region whose 20 holes are ALSO in the
// through-hole group, 4 extruded holes, a slot, the blank outline, an emboss,
// a lance and 6 bends.
const T = 2;
const part: SheetMetalFeature[] = [
  { id: 'hole_d4', feature_type: 'SimpleHole', variant: 'through', diameter_mm: 4, occurrences: [...occ(14, 100), ...occ(20, 500)] },
  { id: 'hole_d1.2', feature_type: 'SimpleHole', variant: 'through', diameter_mm: 1.2, occurrences: occ(2, 200) },
  { id: 'hole_d150', feature_type: 'SimpleHole', variant: 'through', diameter_mm: 150, occurrences: occ(1, 300) },
  { id: 'perforation_0_d4', feature_type: 'SimpleHole', variant: 'perforated', diameter_mm: 4, occurrences: occ(20, 500) },
  { id: 'extruded_flange', feature_type: 'SimpleHole', variant: 'extruded', occurrences: occ(4, 700) },
  { id: 'slot_all', feature_type: 'ComplexHole', variant: 'slot', occurrences: occ(2, 800) },
  { id: 'cut_profile', feature_type: 'Blank', variant: 'default', occurrences: [{ face_ids: [1, 2, 3] }] },
  { id: 'formed_feature', feature_type: 'Form', variant: 'emboss', occurrences: occ(3, 900) },
  { id: 'lance', feature_type: 'Lance', variant: 'default', occurrences: occ(2, 950) },
  { id: 'bend_r1', feature_type: 'StraightBend', variant: 'default', occurrences: occ(6, 1000) },
];

const resolve = (process: string, features = part, maxPunch: number | null = MAX_PUNCH, nibbleCap: number | null = NIBBLE_CAP) =>
  resolveCatalogOperations({
    catalogRaw: catalogFor(process),
    features,
    operationKinds,
    variantKinds,
    punchLimits: { minPunchDiameterMm: MIN_PUNCH_FACTOR * T, maxPunchSizeMm: maxPunch, maxNibbledPerimeterFraction: nibbleCap },
  });
const find = (r: ReturnType<typeof resolve>, id: string) => r.find((o) => o.featureIds[0] === id);

describe('catalogPairs', () => {
  it('reads the Operation//Feature pairs of a compound string, outermost first', () => {
    expect(catalogPairs('Turret Press:Punching:Punching//SimpleHole:Punching//Edge')).toEqual([
      { operation: 'Punching', featureType: 'SimpleHole' },
      { operation: 'Punching', featureType: 'Edge' },
    ]);
  });
});

describe('resolveCatalogOperations — Turret Press', () => {
  const r = resolve('Turret Press');

  it('punches a round hole within the machine punch range, excluding the perforation holes it also lists', () => {
    expect(find(r, 'hole_d4')).toMatchObject({ operations: ['Punching'], status: 'resolved', count: 14 });
    expect(find(r, 'hole_d4')!.children).toEqual([{ operation: 'Punching', featureType: 'Edge' }]);
  });

  it('nibbles a hole larger than the largest punch tool', () => {
    expect(find(r, 'hole_d150')).toMatchObject({ operations: ['Nibbling'], status: 'resolved' });
  });

  it('reports a hole below minPunchingThicknessFactor × thickness as not punchable', () => {
    expect(find(r, 'hole_d1.2')).toMatchObject({ operations: [], status: 'infeasible' });
    expect(find(r, 'hole_d1.2')!.reason).toMatch(/smallest punchable/);
  });

  it('perforates the perforation region and flanges the extruded holes', () => {
    expect(find(r, 'perforation_0_d4')).toMatchObject({ operations: ['Perforating'], count: 20 });
    expect(find(r, 'extruded_flange')).toMatchObject({ operations: ['Flanging'], count: 4 });
  });

  it('forms the emboss and lances the lance', () => {
    expect(find(r, 'formed_feature')).toMatchObject({ operations: ['Forming'], status: 'resolved' });
    expect(find(r, 'lance')).toMatchObject({ operations: ['Lancing'], status: 'resolved' });
  });

  it('punches the blank outline, nibbling capped by turretMaxPercentNibbledPeriemter', () => {
    expect(find(r, 'cut_profile')).toMatchObject({ operations: ['Punching'], status: 'resolved' });
    expect(find(r, 'cut_profile')!.reason).toMatch(/at most 5% of the perimeter may be nibbled/);
    expect(find(r, 'cut_profile')!.children).toEqual([{ operation: 'Punching', featureType: 'Edge' }]);
  });

  it('leaves the blank outline undecided when the nibbling cap is unknown', () => {
    expect(find(resolve('Turret Press', part, MAX_PUNCH, null), 'cut_profile'))
      .toMatchObject({ operations: ['Nibbling', 'Punching'], status: 'undecided' });
  });

  it('does not apply the punch-press outline rule where the process can also cut (Laser Punch)', () => {
    expect(find(resolve('Laser Punch'), 'cut_profile')!.operations).toContain('Laser Cutting');
  });

  it('does not claim the bends: a turret press has no bending operation', () => {
    expect(find(r, 'bend_r1')).toBeUndefined();
  });

  it('leaves round holes undecided when the machine punch size is unknown', () => {
    expect(find(resolve('Turret Press', part, null), 'hole_d4')).toMatchObject({ status: 'undecided' });
  });
});

describe('resolveCatalogOperations — countersunk holes (CAD cone at the hole mouth)', () => {
  const countersunk: SheetMetalFeature = { id: 'countersink', feature_type: 'SimpleHole', variant: 'countersunk', occurrences: occ(2, 1200) };

  it('Turret Press countersinks them; the hole itself is still punched', () => {
    const r = resolve('Turret Press', [...part, countersunk]);
    expect(find(r, 'countersink')).toMatchObject({ operations: ['Countersinking'], status: 'resolved', count: 2 });
    expect(find(r, 'hole_d4')).toMatchObject({ operations: ['Punching'], count: 14 });
  });

  it('a laser cannot countersink', () => {
    expect(find(resolve('Fiber Laser Cut', [...part, countersunk]), 'countersink')).toBeUndefined();
  });
});

describe('resolveCatalogOperations — tapped holes (a drawing fact)', () => {
  const tapped: SheetMetalFeature = { id: 'thread_M4', feature_type: 'SimpleHole', variant: 'tapped', occurrences: occ(4, 0).map(() => ({ face_ids: [] })) };

  it('Turret Press taps the called-out threads itself', () => {
    expect(find(resolve('Turret Press', [...part, tapped]), 'thread_M4')).toMatchObject({ operations: ['Tapping'], status: 'resolved', count: 4 });
  });

  it('a laser cannot tap: the threads fall to the Tapping step, which takes them', () => {
    expect(find(resolve('Fiber Laser Cut', [...part, tapped]), 'thread_M4')).toBeUndefined();
    expect(find(resolve('Tapping', [tapped]), 'thread_M4')).toMatchObject({ status: 'resolved', count: 4 });
  });
});

describe('resolveCatalogOperations — the same part on other processes', () => {
  it('Fiber Laser Cut cuts the holes and the blank straight (no bevel on a default edge)', () => {
    const r = resolve('Fiber Laser Cut');
    expect(find(r, 'hole_d4')).toMatchObject({ operations: ['Fiber Laser Cutting'], status: 'resolved' });
    expect(find(r, 'hole_d1.2')).toMatchObject({ operations: ['Fiber Laser Cutting'] });
    expect(find(r, 'cut_profile')).toMatchObject({ operations: ['Fiber Laser Cutting'] });
    expect(find(r, 'formed_feature')).toBeUndefined();
    expect(find(r, 'bend_r1')).toBeUndefined();
  });

  it('Bend Brake bends the bends and nothing else', () => {
    const r = resolve('Bend Brake');
    expect(r.map((o) => o.featureIds[0])).toEqual(['bend_r1']);
    expect(find(r, 'bend_r1')).toMatchObject({ operations: ['Bending'], count: 6 });
  });

  it('a different part gives a different list', () => {
    const plain: SheetMetalFeature[] = [
      { id: 'hole_d8', feature_type: 'SimpleHole', variant: 'through', diameter_mm: 8, occurrences: occ(8, 1) },
      { id: 'cut_profile', feature_type: 'Blank', variant: 'default', occurrences: [{ face_ids: [0] }] },
    ];
    const r = resolve('Turret Press', plain);
    expect(r.map((o) => `${o.operations.join('|')}//${o.featureType}`)).toEqual(['Punching//Blank', 'Punching//SimpleHole']);
  });
});
