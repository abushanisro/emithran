// Phase 2 (fiber laser selection) integration tests — REAL SupabaseService
// against the dev project (`.env`), read-only, no mocks. Expected values are
// derived at test time from the live sm_lookup_laser_cut rows and from
// memory/Sheetmetal/machine/machine_library.csv, never typed in.
//
// Requirement → test traceability:
//   R2.2  Required power = lowest power with a row for material/thickness,
//         thickness rounded up to the next tabulated row   → "minimum power"
//   R2.2  Materials the table does not carry get no requirement, never a
//         Carbon Steel default                             → "not in table"
//   R2.1  Every fiber/CO2 laser carries the library bed size (migration 895)
//                                                          → "bed backfill"
//   R2.3  Every fiber/CO2 laser has a source power on file  → "power on file"
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { SupabaseService } from '../src/common/supabase/supabase.service';
import { SheetMetalLookupService } from '../src/modules/bom-items/costing/sheet-metal/lookup/sheet-metal-lookup.service';

const REASON = 'e2e test: read-only reference data check';
jest.setTimeout(30_000);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

describe('[e2e] Phase 2 laser selection — real DB, no mocks', () => {
  let supabase: SupabaseService;
  let lookup: SheetMetalLookupService;
  let table: { material: string; t: number; w: number }[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: path.resolve(__dirname, '../.env') })],
      providers: [SupabaseService, SheetMetalLookupService],
    }).compile();
    supabase = moduleRef.get(SupabaseService);
    lookup = moduleRef.get(SheetMetalLookupService);
    const { data, error } = await supabase.getPrivilegedClient(REASON).from('sm_lookup_laser_cut')
      .select('material, thickness_mm, laser_power_w, cutting_speed_m_per_min')
      .eq('laser_technology', 'fiber').not('cutting_speed_m_per_min', 'is', null);
    expect(error).toBeNull();
    table = data!.map((r) => ({ material: r.material, t: Number(r.thickness_mm), w: Number(r.laser_power_w) }));
  });

  // Independent re-derivation of the rule from the raw rows.
  const expectedFor = (material: string, thicknessMm: number) => {
    const rows = table.filter((r) => r.material === material);
    const up = rows.filter((r) => r.t >= thicknessMm).map((r) => r.t);
    if (!up.length) return { material, tableThicknessMm: null, requiredW: null };
    const t = Math.min(...up);
    return { material, tableThicknessMm: t, requiredW: Math.min(...rows.filter((r) => r.t === t).map((r) => r.w)) };
  };

  it.each([
    ['SECC', 1.6, 'Carbon Steel'],          // 830-001720-00
    ['IS2062', 8, 'Carbon Steel'],
    ['SS304', 10, 'Stainless Steel'],
    ['AL6061', 3, 'Aluminium'],
    ['Brass CuZn39Pb3', 8, 'Brass'],
  ])('minimum power: %s %s mm', async (grade, t, material) => {
    expect(await lookup.getMinLaserPowerRequirement(grade, t, 'fiber')).toEqual(expectedFor(material, t));
  });

  it('minimum power: a part thicker than every row has no laser that cuts it', async () => {
    const maxCs = Math.max(...table.filter((r) => r.material === 'Carbon Steel').map((r) => r.t));
    expect(await lookup.getMinLaserPowerRequirement('SECC', maxCs + 10, 'fiber'))
      .toEqual({ material: 'Carbon Steel', tableThicknessMm: null, requiredW: null });
  });

  it.each([['Copper C110'], ['Titanium Grade 5'], [null]])('not in table: %s gets no requirement (never defaulted to Carbon Steel)', async (grade) => {
    expect(await lookup.getMinLaserPowerRequirement(grade, 2, 'fiber')).toBeNull();
  });

  it('power on file: every fiber/CO2 laser row has a source power', async () => {
    const { data, error } = await supabase.getPrivilegedClient(REASON).from('mhr_records')
      .select('machine_name, power_kw').in('machine_class', ['fiber_laser', 'co2_laser']);
    expect(error).toBeNull();
    expect(data!.filter((r) => !(Number(r.power_kw) > 0)).map((r) => r.machine_name)).toEqual([]);
  });

  // Fails until migration 895 has been run against this database.
  it('bed backfill: every fiber/CO2 laser row carries its library bed size', async () => {
    const csv = fs.readFileSync(path.resolve(__dirname, '../../memory/Sheetmetal/machine/machine_library.csv'), 'utf8').replace(/^﻿/, '');
    const [header, ...lines] = csv.split(/\r?\n/).filter(Boolean);
    const cols = header.split(',');
    const lib = new Map<string, { len: number; wid: number }>();
    for (const c of lines.map((l) => l.split(','))) {
      const cat = c[cols.indexOf('machine_category')];
      if (cat !== 'Fiber Laser Cutting Machine' && cat !== 'Laser Cutting Machine') continue;
      lib.set(norm(c[cols.indexOf('name')]), { len: Number(c[cols.indexOf('bed_length_mm')]), wid: Number(c[cols.indexOf('bed_width_mm')]) });
    }
    const { data, error } = await supabase.getPrivilegedClient(REASON).from('mhr_records')
      .select('machine_name, max_x_mm, max_y_mm').in('machine_class', ['fiber_laser', 'co2_laser']);
    expect(error).toBeNull();
    const wrong = data!.filter((r) => {
      const m = lib.get(norm(r.machine_name));
      return !m || Number(r.max_x_mm) !== m.len || Number(r.max_y_mm) !== m.wid;
    });
    expect(wrong.map((r) => r.machine_name)).toEqual([]);
  });
});
