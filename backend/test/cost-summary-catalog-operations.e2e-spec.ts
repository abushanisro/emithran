// The Manufacturing Process tree lists each step's catalog operations ("Waterjet Cutting // SimpleHole x60").
// They used to be attached before the applied-route overlay replaced the live lines, so a part with an applied
// route had none and the tree fell back to its legacy Flat Pattern / bend-radius rows. Real BOMItemsService,
// real sign-in, read-only, no mocks.
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
// Machine classes whose catalog process has operations (process_taxonomy_operations).
const CLASSES_WITH_CATALOG_OPERATIONS = new Set([
  'fiber_laser', 'laser_cut', 'waterjet', 'plasma_cut', 'oxyfuel_cut', 'turret_punch', 'laser_punch', 'plasma_punch',
  'press_brake', 'deburring',
]);

describe('[e2e] Cost summary lines carry their catalog operations, applied route or not', () => {
  it('every cutting, punching, bending and deburring line has catalog operations on the part cut features', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: path.resolve(__dirname, '../.env') }), BOMItemsModule],
    }).compile();
    const config = moduleRef.get(ConfigService);
    const env = parseEnv(fs.readFileSync(path.resolve(__dirname, '../../.env.local'), 'utf8'));
    const anon = createClient(config.getOrThrow<string>('SUPABASE_URL'), config.getOrThrow<string>('SUPABASE_ANON_KEY'));
    const { data, error } = await anon.auth.signInWithPassword({ email: env.E2E_EMAIL!, password: env.E2E_PASSWORD! });
    if (error || !data.session) throw new Error(`sign-in failed: ${error?.message}`);
    const summary = await moduleRef.get(BOMItemsService).getCostSummary(RTP2, data.user!.id, data.session.access_token, 250, 'USA');

    const lines = summary.processLines.filter((l) => CLASSES_WITH_CATALOG_OPERATIONS.has(l.machineClass));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect({ process: line.process, operations: (line.catalogOperations ?? []).length > 0 }).toEqual({ process: line.process, operations: true });
    }
  });
});
