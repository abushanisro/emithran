// Picking a machine for a surface treatment line (class surface_bead_blast) used to fail with "Unknown process key".
// Real BOMItemsService and sign-in. It writes one override and removes it again; it does nothing if the part already
// has a pick for that class.
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { parseEnv } from 'util';
import { BOMItemsModule } from '../src/modules/bom-items/bom-items.module';
import { BOMItemsService } from '../src/modules/bom-items/bom-items.service';

jest.setTimeout(400_000);

const RTP2 = 'b035cccf-8fd2-45cf-97b6-9cce68d53d6a';

describe('[e2e] Machine pick for a surface treatment class', () => {
  it('is saved for the class, used by the surface treatment costing, and refused for a machine of another class', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: path.resolve(__dirname, '../../.env') }), BOMItemsModule],
    }).compile();
    const config = moduleRef.get(ConfigService);
    const env = parseEnv(fs.readFileSync(path.resolve(__dirname, '../../.env'), 'utf8'));
    const anon = createClient(config.getOrThrow<string>('SUPABASE_URL'), config.getOrThrow<string>('SUPABASE_ANON_KEY'));
    const { data, error } = await anon.auth.signInWithPassword({ email: env.E2E_EMAIL!, password: env.E2E_PASSWORD! });
    if (error || !data.session) throw new Error(`sign-in failed: ${error?.message}`);
    const userId = data.user!.id;
    const token = data.session.access_token;
    const service = moduleRef.get(BOMItemsService);

    const { data: existing } = await anon.from('bom_item_machine_overrides').select('process_key').eq('bom_item_id', RTP2).eq('process_key', 'surface_bead_blast');
    if (existing?.length) return; // the part already carries a pick: leave it alone
    const { data: machines } = await anon.from('mhr_records').select('id, machine_name, machine_class').eq('machine_class', 'surface_bead_blast').eq('location', 'USA');
    const { data: other } = await anon.from('mhr_records').select('id').eq('machine_class', 'cmm').eq('location', 'USA').limit(1);
    expect(machines?.length).toBeGreaterThan(0);

    try {
      await expect(service.setMachineOverride(RTP2, userId, token, 'surface_bead_blast', other![0]!.id, 'USA'))
        .rejects.toThrow(/Unknown process key/);
      const pick = machines![0]!;
      const saved = await service.setMachineOverride(RTP2, userId, token, 'surface_bead_blast', pick.id, 'USA');
      expect(saved).toMatchObject({ processKey: 'surface_bead_blast', mhrRecordId: pick.id });
    } finally {
      await service.setMachineOverride(RTP2, userId, token, 'surface_bead_blast', null, 'USA');
    }
    const { data: after } = await anon.from('bom_item_machine_overrides').select('process_key').eq('bom_item_id', RTP2).eq('process_key', 'surface_bead_blast');
    expect(after ?? []).toHaveLength(0);
  });
});
