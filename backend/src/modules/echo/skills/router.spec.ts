import { selectSkill, SKILL_TOOLS } from './router';

describe('Echo skill router', () => {
  describe('selectSkill', () => {
    it.each([
      ['/projects/abc-123/bom',                    'bom'],
      ['/projects/abc-123/bom/item-456',           'bom'],
      ['/projects/abc-123/process-planning',       'processDfm'],
      ['/projects/abc-123/production-planning',    'production'],
      ['/projects/abc-123/quality-control',        'qa'],
      ['/projects/abc-123/supplier-nomination',    'supplier'],
      ['/projects/abc-123/supplier-evaluation',    'supplier'],
      ['/projects/abc-123/rfq',                    'rfq'],
      ['/projects/abc-123/rfq/quotes',             'rfq'],
      ['/projects/abc-123',                        'project'],
      ['/projects/abc-123/',                       'project'],
      ['/bom',                                     'bom'],
      ['/process',                                 'processDfm'],
      ['/process-planning',                        'processDfm'],
      ['/production-planning',                     'production'],
      ['/supplier-evaluation',                     'supplier'],
      ['/vendors',                                 'supplier'],
      ['/raw-materials',                           'costing'],
      ['/hr-rates',                                'costing'],
      ['/mhr-database',                            'costing'],
      ['/calculators',                             'costing'],
      ['/vave',                                    'vave'],
      ['/benchmarks',                              'benchmark'],
      ['/benchmark',                               'benchmark'],
      ['/settings',                                'universal'],
      ['/',                                        'universal'],
    ])('route "%s" → skill "%s"', (route, expected) => {
      const out = selectSkill(route);
      expect(out.skill).toBe(expected);
    });

    it('falls through to universal for unknown routes', () => {
      expect(selectSkill('/foo/bar/baz').skill).toBe('universal');
    });

    it('ignores query strings when matching', () => {
      expect(selectSkill('/projects/abc-123/rfq?view=quotes').skill).toBe('rfq');
    });

    it('handles null / empty route safely', () => {
      expect(selectSkill(null).skill).toBe('universal');
      expect(selectSkill(undefined).skill).toBe('universal');
      expect(selectSkill('').skill).toBe('universal');
    });

    it('matches case-insensitively (Next.js sometimes capitalises)', () => {
      expect(selectSkill('/Projects/abc/BOM').skill).toBe('bom');
    });
  });

  describe('SKILL_TOOLS', () => {
    it('has an entry for every skill', () => {
      const skills = ['universal','project','bom','processDfm','supplier','rfq','production','qa','costing','vave','benchmark'];
      for (const s of skills) {
        expect(SKILL_TOOLS[s as keyof typeof SKILL_TOOLS]).toBeDefined();
      }
    });

    it('universal skill has no tools', () => {
      expect(SKILL_TOOLS.universal).toEqual([]);
    });

    it('processDfm skill has DFM + cost + supplier-capability tools', () => {
      expect(SKILL_TOOLS.processDfm).toEqual(expect.arrayContaining([
        'get_dfm_review',
        'run_dfm_deep_analysis',
        'get_process_candidates',
      ]));
    });

    it('rfq skill cannot call cost or DFM tools', () => {
      const tools = new Set(SKILL_TOOLS.rfq);
      expect(tools.has('get_dfm_review')).toBe(false);
      expect(tools.has('get_part_cost_breakdown')).toBe(false);
    });
  });
});
