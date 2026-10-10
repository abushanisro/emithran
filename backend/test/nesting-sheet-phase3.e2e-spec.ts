// Phase 3 (Nest sheet / kerf / edge margin) integration tests — REAL
// SupabaseService against the dev project (`.env`), read-only, no mocks.
// Expected values come from memory/Sheetmetal (machine_library.csv,
// sheet_metal_variables.csv), never typed in here.
//
// Requirement → test traceability:
//   R3.1  The nesting sheet is the selected laser's nominal sheet  → "laser sheet"
//   R3.1  With no laser sheet, the reference standard sheet        → "standard sheet"
//   R3.2  Kerf comes from the part-spacing table for the thickness  → "kerf"
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { SupabaseService } from '../src/common/supabase/supabase.service';
import { SheetMetalLookupService } from '../src/modules/bom-items/costing/sheet-metal/lookup/sheet-metal-lookup.service';
import { computePartAllowanceMm } from '../src/modules/bom-items/costing/sheet-metal/machine/sheet-metal-nesting.engine';

jest.setTimeout(30_000);
const memory = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../memory/Sheetmetal', rel), 'utf8').replace(/^﻿/, '');

function csvRows(text: string): Record<string, string>[] {
  const [header, ...lines] = text.split(/\r?\n/).filter(Boolean);
  const cols = header.split(',');
  return lines.map((l) => l.split(',')).map((c) => Object.fromEntries(cols.map((k, i) => [k, c[i]])));
}

describe('[e2e] Phase 3 nesting sheet — real DB, no mocks', () => {
  let lookup: SheetMetalLookupService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: path.resolve(__dirname, '../.env') })],
      providers: [SupabaseService, SheetMetalLookupService],
    }).compile();
    lookup = moduleRef.get(SheetMetalLookupService);
  });

  const lasers = csvRows(memory('machine/machine_library.csv'))
    .filter((r) => r.machine_category === 'Fiber Laser Cutting Machine');

  it.each(lasers.map((r) => [r.name, r]))('laser sheet: %s uses its library nominal sheet', async (_name, row) => {
    const r = row as Record<string, string>;
    expect(await lookup.getNominalSheetForMachine(r.name)).toEqual({
      widthMm: Number(r.nominal_sheet_size_width_mm),
      lengthMm: Number(r.nominal_sheet_size_length_mm),
    });
  });

  it('laser sheet: an unknown machine has none (never a guessed sheet)', async () => {
    expect(await lookup.getNominalSheetForMachine('No Such Laser')).toBeNull();
    expect(await lookup.getNominalSheetForMachine(null)).toBeNull();
  });

  it('standard sheet: matches standardSheetWidth/Length in sheet_metal_variables.csv', async () => {
    const vars = memory('sheet_metal_variables.csv').split(/\r?\n/);
    const value = (key: string) => Number(vars.find((l) => l.includes(`,${key},`))!.split(`,${key},`)[1].split(',')[0]);
    expect(await lookup.getStandardSheet()).toEqual({ widthMm: value('standardSheetWidth'), lengthMm: value('standardSheetLength') });
  });

  it('kerf: the part-spacing table gives a real allowance for the test part (SECC 1.5 mm and 1.6 mm)', async () => {
    const table = await lookup.getPartSpacingTable();
    for (const t of [1.5, 1.6]) {
      const kerf = computePartAllowanceMm(table, t);
      expect(kerf).not.toBeNull();
      expect(kerf!).toBeGreaterThanOrEqual(t); // Fiber Laser spacing rows are >= the sheet thickness
    }
  });
});

describe('[e2e] Nest view candidate sheets — real DB', () => {
  it('library laser sheets = the distinct fiber-laser nominal sheets in machine_library.csv', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: path.resolve(__dirname, '../.env') })],
      providers: [SupabaseService, SheetMetalLookupService],
    }).compile();
    const got = await moduleRef.get(SheetMetalLookupService).getLaserNominalSheetSizes();
    const expected = [...new Set(csvRows(memory('machine/machine_library.csv'))
      .filter((r) => r.machine_category === 'Fiber Laser Cutting Machine')
      .map((r) => `${Number(r.nominal_sheet_size_width_mm)}x${Number(r.nominal_sheet_size_length_mm)}`))].sort();
    expect(got.map((s) => `${s.widthMm}x${s.lengthMm}`).sort()).toEqual(expected);
  });
});
