// The process dialog's machine pickers — REAL SupabaseService, real sign-in
// (the test account in ../.env.local, so row-level security is the real one),
// read-only. The slim picker must offer exactly the machines and rates the
// full list does, in a small fraction of the payload.
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { parseEnv } from 'util';
import { SupabaseService } from '../src/common/supabase/supabase.service';
import { Logger } from '../src/common/logger/logger.service';
import { ExchangeRateService } from '../src/common/exchange-rate/exchange-rate.service';
import { LHRService } from '../src/modules/lhr/lhr.service';
import { MHRService } from '../src/modules/mhr/mhr.service';

jest.setTimeout(120_000);

const LOCATION = 'USA';

async function signIn(config: ConfigService): Promise<string> {
  // Parsed, not loaded: jest gives each test file its own process.env copy.
  const env = parseEnv(fs.readFileSync(path.resolve(__dirname, '../../.env.local'), 'utf8'));
  const email = env.E2E_EMAIL;
  const password = env.E2E_PASSWORD;
  if (!email || !password) throw new Error('Add E2E_EMAIL / E2E_PASSWORD to .env.local');
  const anon = createClient(config.getOrThrow<string>('SUPABASE_URL'), config.getOrThrow<string>('SUPABASE_ANON_KEY'));
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign-in failed: ${error?.message}`);
  return data.session.access_token;
}

describe('[e2e] MHR picker — real DB, no mocks', () => {
  let service: MHRService;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: path.resolve(__dirname, '../.env') })],
      providers: [SupabaseService, Logger, ExchangeRateService, LHRService, MHRService],
    }).compile();
    service = moduleRef.get(MHRService);
    token = await signIn(moduleRef.get(ConfigService));
  });

  it('offers exactly the machines and rates of the full list, at a fraction of the size', async () => {
    const t0 = Date.now();
    const picker = await service.findPickerRows(LOCATION, token);
    const pickerMs = Date.now() - t0;
    const full = await service.findAll({ location: LOCATION, limit: 10000 }, undefined, token);

    expect(picker.length).toBeGreaterThan(0);
    expect(picker.map((r) => r.id).sort()).toEqual(full.records.map((r) => r.id).sort());

    const fullById = new Map(full.records.map((r) => [r.id, r]));
    for (const row of picker) {
      const f = fullById.get(row.id);
      if (!f) throw new Error(`picker row ${row.id} missing from the full list`);
      expect([row.machineName, row.machineClass, row.benchmarkSourceKey, row.processGroup, row.commodityCode])
        .toEqual([f.machineName, f.machineClass, f.benchmarkSourceKey, f.processGroup, f.commodityCode]);
      // Exactly the frontend's resolveMhrUsdRate on the full record — every
      // row, including those the engine prices (no stored rate).
      const fullRate = f.mhrUsdPerHour ?? f.calculations?.totalMachineHourRate ?? f.manualMHRValue ?? 0;
      expect(row.mhrUsdPerHour).toBeCloseTo(fullRate, 6);
    }

    const pickerBytes = JSON.stringify(picker).length;
    const fullBytes = JSON.stringify(full.records).length;
    expect(pickerBytes).toBeLessThan(fullBytes / 5);
    // Performance budget: the dialog's dev request timeout is 15 s.
    expect(pickerMs).toBeLessThan(10_000);
  });
});
