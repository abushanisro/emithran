// Auto routing against the real database: for Rtp2 Mag2 Backframe (USA, Aluminum 6061, 1.6 mm,
// 124 holes, batch 250) the recommendation must be the fiber laser, and every route that
// undercut it before did so for a stated, data-backed reason. Real BOMItemsService, real
// sign-in (row-level security), read-only, no mocks.
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { parseEnv } from 'util';
import { BOMItemsModule } from '../src/modules/bom-items/bom-items.module';
import { BOMItemsService } from '../src/modules/bom-items/bom-items.service';
import type { RouteComparisonResponseDto } from '../src/modules/bom-items/dto/route-comparison.dto';

jest.setTimeout(400_000);

const RTP2 = 'b035cccf-8fd2-45cf-97b6-9cce68d53d6a';

describe('[e2e] Auto route recommendation, Rtp2 Mag2 Backframe', () => {
  let comparison: RouteComparisonResponseDto;
  const route = (id: string) => {
    const r = comparison.routes.find((x) => x.routeId === id);
    if (!r) throw new Error(`route ${id} missing from the comparison`);
    return r;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: path.resolve(__dirname, '../.env') }), BOMItemsModule],
    }).compile();
    const config = moduleRef.get(ConfigService);
    const env = parseEnv(fs.readFileSync(path.resolve(__dirname, '../../.env.local'), 'utf8'));
    const anon = createClient(config.getOrThrow<string>('SUPABASE_URL'), config.getOrThrow<string>('SUPABASE_ANON_KEY'));
    const { data, error } = await anon.auth.signInWithPassword({ email: env.E2E_EMAIL!, password: env.E2E_PASSWORD! });
    if (error || !data.session) throw new Error(`sign-in failed: ${error?.message}`);
    comparison = await moduleRef.get(BOMItemsService).getRouteComparison(RTP2, data.user!.id, data.session.access_token, 250, 'USA');
  });

  it('recommends the fiber laser route', () => {
    expect(comparison.recommendedRouteId).toBe('sm-laser');
    expect(route('sm-laser')).toMatchObject({ isFeasible: true, dataComplete: true });
  });

  it.each(['sm-shear', 'sm-cut-to-length'])('%s cannot make a part with holes, and says why', (id) => {
    const r = route(id);
    expect(r.isFeasible).toBe(false);
    expect([...r.warnings, ...r.capability.warnings].join(' ')).toContain('catalogued for Blank only');
  });

  it.each(['sm-turret', 'sm-router'])('%s is incomplete because work is unpriced, with the reason on the line', (id) => {
    const r = route(id);
    expect(r.dataComplete).toBe(false);
    expect(r.dataGaps.map((g) => g.reason).join(' ')).toContain('Not priced');
  });

  it('every route cheaper than the laser is excluded from Auto for one of those reasons', () => {
    const laser = route('sm-laser').totalCost ?? Infinity;
    for (const r of comparison.routes) {
      if (r.routeId === 'sm-laser' || (r.totalCost ?? Infinity) >= laser) continue;
      const excluded = !r.isFeasible || !r.dataComplete || r.producesBlank === false || !r.autoRoutable || !r.capability.overallCapable;
      expect({ route: r.routeId, excluded }).toEqual({ route: r.routeId, excluded: true });
    }
  });
});
