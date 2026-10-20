import { inferDesign } from './infer-design';

describe('inferDesign', () => {
  it('treats any file with a board-file role as a board set read from files (tier B)', () => {
    expect(inferDesign([{ name: 'a.GTL', role: 'copper_top' }, { name: 'bom.xlsx' }])).toEqual({ ok: true, kind: 'board', tier: 'B' });
  });

  it('takes kind and tier from a single feature graph', () => {
    expect(inferDesign([{ name: 'g.json', json: { contractVersion: '1.1', kind: 'harness', inputTier: 'D' } }])).toEqual({ ok: true, kind: 'harness', tier: 'D' });
    expect(inferDesign([{ name: 'g.json', json: { contractVersion: '1.1', kind: 'board' } }])).toEqual({ ok: true, kind: 'board', tier: 'C' });
  });

  it('refuses files that do not say what they are, naming them', () => {
    const verdict = inferDesign([{ name: 'bom.xlsx' }]);
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.message).toContain('bom.xlsx');
    expect(inferDesign([{ name: 'x.json', json: { kind: 'panel', contractVersion: '1.1' } }]).ok).toBe(false);
    expect(inferDesign([{ name: 'a.json', json: { contractVersion: '1.1', kind: 'board' } }, { name: 'b.json' }]).ok).toBe(false);
  });
});
