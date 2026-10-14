// A picker lists calculators by id and name; the full list (with every field and formula) was 634 KB and
// over a second. Real CalculatorsService and sign-in (row-level security), read-only, no mocks.
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { parseEnv } from 'util';
import { CalculatorsModule } from '../src/modules/calculators/calculators.module';
import { CalculatorsServiceV2 } from '../src/modules/calculators/calculators.service';

jest.setTimeout(120_000);

describe('[e2e] Calculator list summary', () => {
  let service: CalculatorsServiceV2;
  let userId: string;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: path.resolve(__dirname, '../.env') }), CalculatorsModule],
    }).compile();
    const config = moduleRef.get(ConfigService);
    const env = parseEnv(fs.readFileSync(path.resolve(__dirname, '../../.env.local'), 'utf8'));
    const anon = createClient(config.getOrThrow<string>('SUPABASE_URL'), config.getOrThrow<string>('SUPABASE_ANON_KEY'));
    const { data, error } = await anon.auth.signInWithPassword({ email: env.E2E_EMAIL!, password: env.E2E_PASSWORD! });
    if (error || !data.session) throw new Error(`sign-in failed: ${error?.message}`);
    userId = data.user!.id;
    token = data.session.access_token;
    service = moduleRef.get(CalculatorsServiceV2);
  });

  it('the summary lists the same calculators without their fields and formulas', async () => {
    const full = await service.findAll({ limit: 100 } as any, userId, token);
    const summary = await service.findAll({ limit: 100, summary: true } as any, userId, token);
    expect(summary.calculators.map((c: any) => c.id)).toEqual(full.calculators.map((c: any) => c.id));
    expect(summary.total).toBe(full.total);
    expect(summary.calculators.every((c: any) => c.fields === undefined && c.formulas === undefined)).toBe(true);
    expect(full.calculators.some((c: any) => Array.isArray(c.fields) && c.fields.length > 0)).toBe(true);
    expect(JSON.stringify(summary).length).toBeLessThan(JSON.stringify(full).length / 5);
  });
});
