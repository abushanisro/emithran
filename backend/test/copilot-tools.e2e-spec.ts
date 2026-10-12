// Copilot tool layer — REAL BOMItemsService and SupabaseService, real sign-in
// (the test account in ../.env.local, so row-level security is the real one),
// read-only, no model call and no mocks. What is asserted is what the copilot
// is allowed to rely on: a tool result is the platform's own figure (same as
// getCostSummary), it fits its size budget, a part this user cannot see
// yields an error and no data, and what-if inputs are limited to the three
// real request parameters.
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { parseEnv } from 'util';
import { SupabaseService } from '../src/common/supabase/supabase.service';
import { BOMItemsModule } from '../src/modules/bom-items/bom-items.module';
import { BOMItemsService } from '../src/modules/bom-items/bom-items.service';
import { CostAggregationService } from '../src/modules/costing/cost-aggregation.service';
import { CostingModule } from '../src/modules/costing/costing.module';
import { CopilotMemoryService } from '../src/modules/copilot/copilot-memory.service';
import { CopilotToolRunner, TOOL_RESULT_MAX_CHARS, type ToolContext } from '../src/modules/copilot/copilot.tools';

jest.setTimeout(240_000);

const LOCATION = 'USA';
const BATCH = 250;
const ABSENT_ID = '11111111-1111-4111-8111-111111111111';

async function signIn(config: ConfigService): Promise<{ token: string; userId: string }> {
  const env = parseEnv(fs.readFileSync(path.resolve(__dirname, '../../.env.local'), 'utf8'));
  if (!env.E2E_EMAIL || !env.E2E_PASSWORD) throw new Error('Add E2E_EMAIL / E2E_PASSWORD to .env.local');
  const anon = createClient(config.getOrThrow<string>('SUPABASE_URL'), config.getOrThrow<string>('SUPABASE_ANON_KEY'));
  const { data, error } = await anon.auth.signInWithPassword({ email: env.E2E_EMAIL, password: env.E2E_PASSWORD });
  if (error || !data.session) throw new Error(`sign-in failed: ${error?.message}`);
  return { token: data.session.access_token, userId: data.user!.id };
}

describe('[e2e] copilot tools — real DB, no model call', () => {
  let bomItems: BOMItemsService;
  let ctx: ToolContext;
  let memory: CopilotMemoryService;
  let runner: CopilotToolRunner;
  let aggregation: CostAggregationService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: path.resolve(__dirname, '../.env') }), BOMItemsModule, CostingModule],
    }).compile();
    bomItems = moduleRef.get(BOMItemsService);
    const { token, userId } = await signIn(moduleRef.get(ConfigService));

    // Any part this account can already cost: it has a material and an analysed feature graph.
    const { data, error } = await moduleRef
      .get(SupabaseService)
      .getUserClient(token)
      .from('bom_items')
      .select('id')
      .not('material_grade', 'is', null)
      .not('feature_graph', 'is', null)
      .not('sheet_thickness_mm', 'is', null)
      .limit(1);
    if (error || !data?.length) throw new Error(`no costable part visible to the test account: ${error?.message}`);

    const item = await bomItems.findOne(data[0].id, userId, token);
    ctx = { item, bomItemId: item.id, userId, accessToken: token, location: LOCATION, batchSize: BATCH };
    memory = new CopilotMemoryService(moduleRef.get(SupabaseService));
    aggregation = moduleRef.get(CostAggregationService);
    runner = new CopilotToolRunner(ctx, bomItems, memory, aggregation);
  });

  it('get_saved_quote relays the saved quote the Cost Guide shows, within its size budget', async () => {
    const real = await aggregation.computeBomItemCost(ctx.bomItemId, ctx.accessToken);
    const out = await runner.run('get_saved_quote', {});
    expect(out.isError).toBe(false);
    expect(out.content.length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS);
    const body = JSON.parse(out.content);
    expect(body.rawMaterialCost).toBe(real.rawMaterialCost);
    expect(body.manufacturingCost).toBeCloseTo(body.rawMaterialCost + body.processCost + body.toolingCost + body.packagingCost + body.procuredPartCost, 9);
    expect(body.processLines).toHaveLength(real.processLines.length);
    expect(body.processCost).toBeCloseTo(body.processLines.reduce((s: number, l: { totalCostPerPart: number }) => s + l.totalCostPerPart, 0), 9);
  });

  it('get_cost_summary relays the platform figures, within its size budget', async () => {
    const real = await bomItems.getCostSummary(ctx.bomItemId, ctx.userId, ctx.accessToken, BATCH, LOCATION, undefined);
    const out = await runner.run('get_cost_summary', {});
    expect(out.isError).toBe(false);
    expect(out.content.length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS);

    const r = JSON.parse(out.content);
    expect(r.totalCost).toBe(real.totalCost);
    expect(r.materialCost).toBe(real.materialCost);
    expect(r.currency).toBe(real.currency);
    expect(r.costStatus).toBe(real.costStatus);
    expect(r.lines).toHaveLength(real.processLines.length);
    r.lines.forEach((l: { index: number; totalCost: number; machineName: string | null; physicsGap?: unknown }, i: number) => {
      expect(l.index).toBe(i);
      expect(l.totalCost).toBe(real.processLines[i].totalCost);
      expect(l.machineName).toBe(real.processLines[i].machineName);
      // A gap disclosed by the engine is never dropped on the way to the model.
      if (real.processLines[i].physicsGap) expect(l.physicsGap).toBeDefined();
    });
    // Warnings are relayed (capped, never rewritten).
    expect(r.warnings.length).toBe(Math.min(15, real.warnings.length));
    if (real.warnings.length) expect(r.warnings[0].slice(0, 100)).toBe(real.warnings[0].slice(0, 100));
  });

  it('get_process_line_detail returns one line, and says so when the index does not exist', async () => {
    const ok = JSON.parse((await runner.run('get_process_line_detail', { lineIndex: 0 })).content);
    expect(ok.index).toBe(0);
    expect(ok.process).toBeDefined();

    const bad = JSON.parse((await runner.run('get_process_line_detail', { lineIndex: 999 })).content);
    expect(bad.error).toMatch(/no process line 999/);
    const notInt = JSON.parse((await runner.run('get_process_line_detail', { lineIndex: '1; drop' })).content);
    expect(notInt.error).toMatch(/non-negative integer/);
  });

  it('get_part_features reads the stored CAD analysis without recomputing anything', async () => {
    const r = JSON.parse((await runner.run('get_part_features', {})).content);
    expect(r.features.length).toBeGreaterThan(0);
    expect(r.features[0]).toHaveProperty('type');
    // Per-occurrence geometry (centroids, face ids) is the bulk of the stored graph and is not sent.
    expect(JSON.stringify(r)).not.toContain('centroid');
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS);
  });

  it('a part this user cannot see yields an error and no data', async () => {
    const hidden = new CopilotToolRunner({ ...ctx, bomItemId: ABSENT_ID }, bomItems, memory, aggregation);
    const out = await hidden.run('get_cost_summary', {});
    expect(out.isError).toBe(true);
    expect(JSON.parse(out.content)).toEqual({ error: 'This part was not found or you do not have access to it.' });
  });

  it('run_what_if re-costs under the requested inputs and refuses anything else', async () => {
    const out = await runner.run('run_what_if', { scenarios: [{ label: 'small', batchSize: 50 }, { label: 'large', batchSize: 5000 }] });
    expect(out.isError).toBe(false);
    const { scenarios } = JSON.parse(out.content);
    expect(scenarios.map((s: { label: string }) => s.label)).toEqual(['small', 'large']);
    expect(scenarios[0].resolvedInputs.batchSize).toBe(50);
    expect(scenarios[1].resolvedInputs.batchSize).toBe(5000);
    // Each scenario is the platform's own answer for those inputs, not the copilot's arithmetic.
    const [small, large] = await Promise.all([50, 5000].map((b) => bomItems.getCostSummary(ctx.bomItemId, ctx.userId, ctx.accessToken, b, LOCATION, undefined)));
    expect(scenarios[0].totalCost).toBe(small.totalCost);
    expect(scenarios[1].totalCost).toBe(large.totalCost);
    expect(scenarios[0].costStatus).toBe(small.costStatus);

    for (const bad of [
      { scenarios: [{ materialGrade: 'SS304' }] },
      { scenarios: [{ batchSize: 0 }] },
      { scenarios: [{ batchSize: 1.5 }] },
      { scenarios: [{ location: '' }] },
      { scenarios: [] },
      { scenarios: Array.from({ length: 5 }, () => ({ batchSize: 10 })) },
    ]) {
      expect(JSON.parse((await runner.run('run_what_if', bad)).content).error).toBeDefined();
    }
  });

  // Needs migration 901 applied. Restores whatever preferences the account already had.
  it('saves, recalls, de-duplicates, removes and limits preferences', async () => {
    const { userId, accessToken: token } = ctx;
    const before = await memory.load(userId, token);
    try {
      const added = await memory.change(userId, token, ['e2e pref one', 'E2E PREF ONE', 'e2e pref two'], []);
      expect(added.saved).toEqual(['e2e pref one', 'e2e pref two']);
      expect(await memory.load(userId, token)).toEqual(expect.arrayContaining(['e2e pref one', 'e2e pref two']));

      const removed = await memory.change(userId, token, [], ['E2E PREF ONE', 'never saved']);
      expect(removed.removed).toEqual(['e2e pref one']);
      expect(removed.notFound).toEqual(['never saved']);

      await expect(memory.change(userId, token, ['x'.repeat(201)], [])).rejects.toThrow(/characters/);
      await expect(memory.change(userId, token, Array.from({ length: 21 }, (_, i) => `e2e filler ${i}`), [])).rejects.toThrow(/at most 20/);

      const viaTool = JSON.parse((await runner.run('update_preferences', { add: ['e2e via tool'] })).content);
      expect(viaTool.saved).toEqual(['e2e via tool']);
      expect(JSON.parse((await runner.run('update_preferences', { add: [] })).content).error).toBeDefined();
    } finally {
      const now = await memory.load(userId, token);
      await memory.change(userId, token, before, now);
    }
    expect(await memory.load(userId, token)).toEqual(before);
  });

  it('an unknown tool name is refused', async () => {
    expect(JSON.parse((await runner.run('execute_sql', { q: 'select 1' })).content).error).toMatch(/unknown tool/);
  });
});
