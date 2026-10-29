// Turret Press punch rate and stroke rate factor against the real database. Requires
// migration 902 (punch_rate_cycles_min on the 21 turretPunchMachine rows and the 17
// strokeRateFactor rows). Real SheetMetalLookupService, real sign-in, read-only, no mocks.
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { parseEnv } from 'util';
import { BOMItemsModule } from '../src/modules/bom-items/bom-items.module';
import { SheetMetalLookupService } from '../src/modules/bom-items/costing/sheet-metal/lookup/sheet-metal-lookup.service';

jest.setTimeout(120_000);

describe('[e2e] Turret Press punch rate and stroke rate factor', () => {
  let lookup: SheetMetalLookupService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: path.resolve(__dirname, '../../.env') }), BOMItemsModule],
    }).compile();
    const config = moduleRef.get(ConfigService);
    const env = parseEnv(fs.readFileSync(path.resolve(__dirname, '../../.env'), 'utf8'));
    const anon = createClient(config.getOrThrow<string>('SUPABASE_URL'), config.getOrThrow<string>('SUPABASE_ANON_KEY'));
    const { error } = await anon.auth.signInWithPassword({ email: env.E2E_EMAIL!, password: env.E2E_PASSWORD! });
    if (error) throw new Error(`sign-in failed: ${error.message}`);
    lookup = moduleRef.get(SheetMetalLookupService, { strict: false });
  });

  // Countries data export: Amada EM-3510 ZRB punchRate 500, press force 300 kN (30.6 t),
  // Lookup Table 1 nearest row 30 t: simple 0.78, intermediate 0.62, complex 0.55.
  it('resolves the real punch rate and the factor for the machine tonnage and complexity', async () => {
    const simple = await lookup.getTurretPunchMachineParams('Amada EM-3510 ZRB', 'simple');
    expect(simple.punchRateCyclesPerMin).toBe(500);
    expect(simple.machineTonnageT).toBeCloseTo(30.6, 1);
    expect(simple.strokeRateFactor).toBe(0.78);
    expect((await lookup.getTurretPunchMachineParams('Amada EM-3510 ZRB', 'inter')).strokeRateFactor).toBe(0.62);
    expect((await lookup.getTurretPunchMachineParams('Amada EM-3510 ZRB', 'complex')).strokeRateFactor).toBe(0.55);
  });

  it('resolves a different rate for a different machine (Vipros 255: 280 hits/min, 22.35 t -> 20 t row)', async () => {
    const p = await lookup.getTurretPunchMachineParams('Amada Vipros 255', 'inter');
    expect(p.punchRateCyclesPerMin).toBe(280);
    expect(p.strokeRateFactor).toBe(0.63);
  });

  it('reports no punch rate for a machine that is not on file, rather than a value', async () => {
    const p = await lookup.getTurretPunchMachineParams('No Such Turret', 'inter');
    expect(p.punchRateCyclesPerMin).toBe(0);
    expect(p.strokeRateFactor).toBeNull();
  });
});
