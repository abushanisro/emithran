// Theory checks against real stored analyses (the test account's sheet-metal
// parts, real DB, no mocks): a finding appears exactly when the stored numbers
// disagree, and the known Rtp2 part (summary 18 bends, feature tree 17) is named.
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { parseEnv } from 'util';
import { reconcileSheetGeometry } from '../src/modules/bom-items/costing/shared/geometry-reconciliation';

jest.setTimeout(120_000);

const RTP2 = 'b035cccf-8fd2-45cf-97b6-9cce68d53d6a';

describe('[e2e] sheet geometry reconciliation', () => {
  let rows: Array<{ id: string; feature_graph: any }>;
  let rtp2: { id: string; feature_graph: any };

  beforeAll(async () => {
    const be = parseEnv(fs.readFileSync(path.resolve(__dirname, '../../.env'), 'utf8'));
    const e2e = parseEnv(fs.readFileSync(path.resolve(__dirname, '../../.env'), 'utf8'));
    const client = createClient(be.SUPABASE_URL!, be.SUPABASE_ANON_KEY!);
    const { error: authError } = await client.auth.signInWithPassword({ email: e2e.E2E_EMAIL!, password: e2e.E2E_PASSWORD! });
    if (authError) throw new Error(`sign-in failed: ${authError.message}`);
    const { data, error } = await client.from('bom_items').select('id, feature_graph').not('feature_graph->feature_graph_v2', 'is', null).limit(25);
    if (error || !data?.length) throw new Error(`no analysed parts visible: ${error?.message}`);
    rows = data as typeof rows;
    const one = await client.from('bom_items').select('id, feature_graph').eq('id', RTP2).single();
    if (one.error) throw new Error(`Rtp2 part not visible to the test account: ${one.error.message}`);
    rtp2 = one.data as typeof rtp2;
  });

  it('reports a bend finding exactly when the summary and the feature tree disagree', () => {
    for (const { feature_graph: fg } of rows) {
      const tree = (fg.feature_graph_v2.features as any[]).filter((f) => f.feature_type === 'StraightBend')
        .reduce((s, f) => s + (f.occurrences?.length ?? 0), 0);
      const reported = reconcileSheetGeometry(fg).some((f) => f.id === 'bend_count');
      expect(reported).toBe(fg.summary?.bendCount !== undefined && fg.summary.bendCount !== tree);
    }
  });

  it('names the R5 bend the Rtp2 quote counts and its feature tree lacks', () => {
    const bend = reconcileSheetGeometry(rtp2.feature_graph).find((f) => f.id === 'bend_count');
    expect(bend?.message).toContain('18 bends');
    expect(bend?.message).toContain('lists 17');
    expect(bend?.message).toContain('R5');
  });
});
