// Phase 6 (hard-tooling volume gate) — REAL SupabaseService, read-only.
// The limits must be exactly the memory/ values the gate is documented to use.
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { SupabaseService } from '../src/common/supabase/supabase.service';
import { SheetMetalLookupService } from '../src/modules/bom-items/costing/sheet-metal/lookup/sheet-metal-lookup.service';

jest.setTimeout(30_000);

function memoryVariable(key: string): number {
  const csv = fs.readFileSync(path.resolve(__dirname, '../../memory/Sheetmetal/sheet_metal_variables.csv'), 'utf8');
  const line = csv.split(/\r?\n/).find((l) => l.includes(`,${key},`));
  if (!line) throw new Error(`${key} not in sheet_metal_variables.csv`);
  return Number(line.split(`,${key},`)[1]!.split(',')[0]);
}

describe('[e2e] Phase 6 volume gate — real DB, no mocks', () => {
  it('the live limits equal progDieAnnualVolumeLimit / stageToolingAnnualVolumeLimit in memory/', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: path.resolve(__dirname, '../.env') })],
      providers: [SupabaseService, SheetMetalLookupService],
    }).compile();
    const limits = await moduleRef.get(SheetMetalLookupService).getToolingAnnualVolumeThresholds();
    expect(limits).toEqual({
      progressiveDie: memoryVariable('progDieAnnualVolumeLimit'),
      stageTooling: memoryVariable('stageToolingAnnualVolumeLimit'),
    });
  });
});
