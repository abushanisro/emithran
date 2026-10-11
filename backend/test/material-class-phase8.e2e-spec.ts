// Phase 8 (material class, migration 897) — REAL SupabaseService, read-only.
// Run after migration 897. Every raw material carries the class its
// material_type has in material_type_classes; only the types with no basis
// stay unclassified; and the API filter returns exactly one class.
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { parseEnv } from 'util';
import { Logger } from '../src/common/logger/logger.service';
import { RawMaterialsService } from '../src/modules/raw-materials/raw-materials.service';
import { SupabaseService } from '../src/common/supabase/supabase.service';
import { readAllRows } from '../src/common/supabase/read-all-rows';
import { MATERIAL_CLASSES } from '../src/modules/raw-materials/constants/raw-material.constants';

jest.setTimeout(120_000);

// The types migration 897 deliberately leaves unclassified (no basis on file).
const UNCLASSIFIED_TYPES = ['Composites', 'Generic', 'Default', 'LaserForm', null];

describe('[e2e] Phase 8 material class — real DB, no mocks', () => {
  let db: ReturnType<SupabaseService['getPrivilegedClient']>;
  let rows: Array<{ material_type: string | null; material_class: string | null; material_group: string | null; name: string | null }>;
  let classes: Map<string, string>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: path.resolve(__dirname, '../.env') })],
      providers: [SupabaseService],
    }).compile();
    db = moduleRef.get(SupabaseService).getPrivilegedClient('phase 8 e2e: read-only check of raw_materials.material_class');
    const all = await readAllRows<(typeof rows)[number]>((from, to) =>
      db.from('raw_materials').select('material_type, material_class, material_group, name').order('id').range(from, to));
    if (all.error) throw new Error(`reading raw_materials.material_class failed (migration 897 run?): ${all.error.message}`);
    rows = all.data;
    const { data, error } = await db.from('material_type_classes').select('material_type, material_class');
    if (error) throw new Error(error.message);
    classes = new Map((data ?? []).map((r: { material_type: string; material_class: string }) => [r.material_type, r.material_class]));
  });

  it('every row carries exactly the class of its material_type', () => {
    const wrong = rows.filter((r) => (r.material_type ? classes.get(r.material_type) ?? null : null) !== r.material_class);
    expect(wrong).toEqual([]);
  });

  it('only the types with no basis stay unclassified', () => {
    const unclassifiedTypes = [...new Set(rows.filter((r) => r.material_class === null).map((r) => r.material_type))];
    expect(unclassifiedTypes.every((t) => UNCLASSIFIED_TYPES.includes(t))).toBe(true);
  });

  it('the old mixed group is split: steels are Ferrous, aluminum / copper are Non-Ferrous', () => {
    const mixed = rows.filter((r) => r.material_group === 'Ferrous & Non-Ferrous');
    expect(mixed.filter((r) => r.material_type === 'Steel').every((r) => r.material_class === 'Ferrous')).toBe(true);
    expect(mixed.filter((r) => r.material_type === 'Aluminum' || r.material_type === 'Copper').every((r) => r.material_class === 'Non-Ferrous')).toBe(true);
    // a Die Casting aluminum is non-ferrous too — the class is not the source catalog
    const dieCastAl = rows.filter((r) => r.material_group === 'Die Casting' && r.material_type === 'Aluminum');
    expect(dieCastAl.length).toBeGreaterThan(0);
    expect(dieCastAl.every((r) => r.material_class === 'Non-Ferrous')).toBe(true);
  });

  it('the class values are exactly the three the API accepts', () => {
    const used = [...new Set(rows.map((r) => r.material_class).filter((c): c is string => c !== null))].sort();
    expect(used).toEqual([...MATERIAL_CLASSES].sort());
  });
});

// POST /raw-materials/classes: the stored class by exact name, as the signed-in
// user sees it (real row-level security); an unknown name is null, never guessed.
describe('[e2e] Phase 8 material class lookup by name — real DB, real sign-in', () => {
  it('returns the stored class for picked names and null for an unknown one', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: path.resolve(__dirname, '../.env') })],
      providers: [SupabaseService, Logger, RawMaterialsService],
    }).compile();
    const config = moduleRef.get(ConfigService);
    const env = parseEnv(fs.readFileSync(path.resolve(__dirname, '../../.env.local'), 'utf8'));
    const anon = createClient(config.getOrThrow<string>('SUPABASE_URL'), config.getOrThrow<string>('SUPABASE_ANON_KEY'));
    const { data: auth, error } = await anon.auth.signInWithPassword({ email: env.E2E_EMAIL ?? '', password: env.E2E_PASSWORD ?? '' });
    if (error || !auth.session) throw new Error(`sign-in failed: ${error?.message}`);

    const classes = await moduleRef.get(RawMaterialsService).materialClassesFor(
      ['Generic Stainless Steel, AISI 304', 'Stainless Steel, AISI 304', 'No Such Material 123'],
      auth.session.access_token,
    );
    expect(classes).toEqual({
      'Generic Stainless Steel, AISI 304': 'Ferrous',
      'Stainless Steel, AISI 304': 'Ferrous',
      'No Such Material 123': null,
    });
  });
});
