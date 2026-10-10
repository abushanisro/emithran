// Phase 9 (Passivation, Anodize, Wet Coat Line) — REAL services, real sign-in
// (the test account in ../.env.local), read-only. The three processes cost
// from the staged reference data (819) and machines (820) for a real
// stainless material, and migration 898 marks them production in the catalog.
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { parseEnv } from 'util';
import { SupabaseService } from '../src/common/supabase/supabase.service';
import { ExchangeRateService } from '../src/common/exchange-rate/exchange-rate.service';
import { MaterialResolutionService } from '../src/modules/bom-items/services/material-resolution.service';
import { SecondaryProcessService } from '../src/modules/bom-items/services/secondary-process.service';

jest.setTimeout(120_000);

async function signIn(config: ConfigService): Promise<string> {
  const env = parseEnv(fs.readFileSync(path.resolve(__dirname, '../../.env.local'), 'utf8'));
  if (!env.E2E_EMAIL || !env.E2E_PASSWORD) throw new Error('Add E2E_EMAIL / E2E_PASSWORD to .env.local');
  const anon = createClient(config.getOrThrow<string>('SUPABASE_URL'), config.getOrThrow<string>('SUPABASE_ANON_KEY'));
  const { data, error } = await anon.auth.signInWithPassword({ email: env.E2E_EMAIL, password: env.E2E_PASSWORD });
  if (error || !data.session) throw new Error(`sign-in failed: ${error?.message}`);
  return data.session.access_token;
}

describe('[e2e] Phase 9 surface treatment — real DB, no mocks', () => {
  let service: SecondaryProcessService;
  let supabase: SupabaseService;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: path.resolve(__dirname, '../.env') })],
      providers: [SupabaseService, ExchangeRateService, MaterialResolutionService, SecondaryProcessService],
    }).compile();
    service = moduleRef.get(SecondaryProcessService);
    supabase = moduleRef.get(SupabaseService);
    token = await signIn(moduleRef.get(ConfigService));
  });

  it('a stainless sheet part with an "Anodize Type II" callout costs all three from live data', async () => {
    const t0 = Date.now();
    const out = await service.compute({
      item: {
        materialGrade: 'Generic Stainless Steel, AISI 304',
        maxLength: 100, maxWidth: 50, maxHeight: 20,
        surfaceArea: 2 * (100 * 50 + 100 * 20 + 50 * 20),
        weight: 0.78,
        featureGraph: { classification: { family: 'sheet_metal' } },
        drawingIntelligence: { coating: 'Anodize Type II' },
      },
      location: 'USA',
      batchSize: 100,
      accessToken: token,
    });
    const ms = Date.now() - t0;
    const by = new Map(out.surfaceLines.map((l) => [l.process, l]));

    expect(out.materialCutCode).not.toBeNull();
    for (const p of ['Passivation', 'Anodize', 'Wet Coat Line']) {
      const l = by.get(p);
      expect([p, l?.status, l?.reason]).toEqual([p, 'costed', expect.any(String)]);
      expect(l!.costPerPartUsd).toBeGreaterThan(0);
    }
    expect(by.get('Passivation')!.trace.find((t) => t.label === 'Treatment')?.source).toMatch(/not machined/);
    expect(by.get('Anodize')!.machine?.name).toMatch(/^Type II Line/);
    // the gaps that stay gaps
    for (const p of ['Black Oxide', 'Degrease', 'Shot Blast', 'Vibratory Finishing']) expect(by.get(p)?.status).toBe('gap');
    expect(ms).toBeLessThan(15_000);
  });

  it('migration 898: the three are production in the catalog', async () => {
    const db = supabase.getPrivilegedClient('phase 9 e2e: read-only check of the surface treatment catalog');
    const { data, error } = await db.from('process_taxonomy').select('process_name, roadmap_status')
      .eq('process_group', 'Surface Treatment').in('process_name', ['Anodize', 'Passivation', 'Wet Coat Line']);
    if (error) throw new Error(error.message);
    expect((data ?? []).map((r: { roadmap_status: string }) => r.roadmap_status)).toEqual(['production', 'production', 'production']);
  });
});
