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
import { findRouteDataGaps } from '../src/modules/bom-items/costing/shared/core/engine-kernel';

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

  // The dialog's "3. Operation" lists these. The Deburring (Deslag) step used to carry none, because
  // Deslag is a finishing operation; it is that step's whole job, applied to the cut features.
  it('the Deburring step performs the catalog Deslag operation on the part cut features', () => {
    const deburr = route('sm-laser').processLines.find((l) => l.machineClass === 'deburring');
    const ops = (deburr?.catalogOperations ?? []).map((c) => `${c.operations.join(' or ')} // ${c.featureType}`);
    expect(new Set(ops)).toEqual(new Set(['Deslag // Blank', 'Deslag // ComplexHole', 'Deslag // SimpleHole']));
    const holes = (deburr?.catalogOperations ?? []).filter((c) => c.featureType === 'SimpleHole').reduce((n, c) => n + c.count, 0);
    expect(holes).toBe(124);
  });

  // Visual and caliper checks need no CMM: the line takes the general inspection machine of
  // memory/Machining/machine/inspection_usa.csv (the cmm pool holds only real CMMs).
  it('the Inspection step is on a real machine with a rate', () => {
    const line = route('sm-laser').processLines.find((l) => l.process === 'Inspection');
    expect(line?.machineName).toBe('Default');
    expect(line?.machineClass).toBe('machining_inspection');
    expect(line?.mhrId).toBeTruthy();
    expect(line?.hourlyRate).toBeGreaterThan(0);
  });

  // A priced service (Bead Blast: a price per m2, no machine time) is a per-part charge: it must not make a
  // route unapplicable for having no cycle time.
  it('a selected priced surface treatment does not block applying the route', () => {
    const line = route('sm-laser').processLines.find((l) => l.process === 'Bead Blast');
    if (!line) return; // not selected on this part's scenario
    expect(line.rateSource).toBe('consumable_allowance');
    expect(findRouteDataGaps([line])).toEqual([]);
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

  // The router cuts at its machine feed (migration 906), but a plunge has no time in any source, so a
  // part with holes is never fully priced: the route is a gap, never the cheapest by omission.
  it('sm-router is incomplete: its plunges are unpriced, with the reason on the line', () => {
    const r = route('sm-router');
    expect(r.dataComplete).toBe(false);
    expect(r.dataGaps.map((g) => g.reason).join(' ')).toContain('plunges');
  });

  // Memory states a power (2-5 kW) for every 3D laser but no technology; the fiber cut-speed table at
  // the machine own power prices it, so the route has a cycle time and no gap.
  it('sm-laser-3d prices its cutting from the fiber table at the machine power', () => {
    const r = route('sm-laser-3d');
    expect(r.dataComplete).toBe(true);
    expect(r.dataGaps).toEqual([]);
    expect(r.processLines[0]!.cycleTimeMin).toBeGreaterThan(0.5);
  });

  // The turret force is that of the largest single hit (a 20 mm hole), so a turret is
  // selected; its punching is priced from the machine punch rate x stroke rate factor.
  it('sm-turret selects a machine and prices punching and nibbling, with no data gap', () => {
    const r = route('sm-turret');
    const line = r.processLines[0]!;
    expect(line.machineName).toBeTruthy();
    expect(line.cycleTimeMin).toBeGreaterThan(1);
    expect(r.dataComplete).toBe(true);
    expect(r.dataGaps).toEqual([]);
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
