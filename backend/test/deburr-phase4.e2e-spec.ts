// Phase 4 (Deslag / Manual Deburr) integration tests — REAL SupabaseService
// against the dev project (`.env`), read-only, no mocks. Expected values come
// from memory/ (machine_library.csv, Machining variables.csv), never typed in.
//
// Requirement → test traceability:
//   R4.1  Each Deslag machine's time per mm is its own library allowance → "deslag allowance"
//   R4.2  Manual Deburr passes per edge come from the machining variables  → "passes"
//   R4.2  Manual Deburr speed is a real tblDeburring row for the material  → "manual speed"
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { SupabaseService } from '../src/common/supabase/supabase.service';
import { SheetMetalLookupService } from '../src/modules/bom-items/costing/sheet-metal/lookup/sheet-metal-lookup.service';
import { MachiningLookupService } from '../src/modules/bom-items/costing/machining/lookup/machining-lookup.service';

jest.setTimeout(30_000);
const memory = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../memory', rel), 'utf8').replace(/^﻿/, '');

describe('[e2e] Phase 4 deburr — real DB, no mocks', () => {
  let sm: SheetMetalLookupService;
  let mc: MachiningLookupService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: path.resolve(__dirname, '../.env') })],
      providers: [SupabaseService, SheetMetalLookupService, MachiningLookupService],
    }).compile();
    sm = moduleRef.get(SheetMetalLookupService);
    mc = moduleRef.get(MachiningLookupService);
  });

  it('deslag allowance: every Deslag machine matches machine_library.csv perimeter_allowance_s_per_mm', async () => {
    const [header, ...lines] = memory('Sheetmetal/machine/machine_library.csv').split(/\r?\n/).filter(Boolean);
    const cols = header.split(',');
    const expected = Object.fromEntries(lines.map((l) => l.split(','))
      .filter((c) => c[cols.indexOf('machine_category')] === 'Deslag Machine')
      .map((c) => [c[cols.indexOf('name')].trim().toLowerCase(), Number(c[cols.indexOf('perimeter_allowance_s_per_mm')])]));
    expect(Object.keys(expected).length).toBeGreaterThan(0);
    expect(await sm.getDeslagSecPerMmByMachine()).toEqual(expected);
  });

  it('passes: defaultNumDeburrPassesEdge matches memory/Machining/variables.csv', async () => {
    const line = memory('Machining/variables.csv').split(/\r?\n/).find((l) => l.includes(',defaultNumDeburrPassesEdge,'))!;
    expect(await mc.getDeburrPassesPerEdge()).toBe(Number(line.split(',defaultNumDeburrPassesEdge,')[1]!.split(',')[0]));
  });

  it.each([['mild_steel'], ['aluminum'], ['stainless']])('manual speed: tblDeburring has a real edge speed for %s', async (cls) => {
    const p = await mc.getDeburrParams(cls as any);
    expect(p.dataFound).toBe(true);
    expect(p.linearSpeedMmPerSec).toBeGreaterThan(0);
  });
});
