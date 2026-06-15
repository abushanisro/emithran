import { ECHO_TOOLS, filterToolsBySkill } from './schemas';

describe('Echo tool schemas', () => {
  it('all tools have name, description, and input_schema', () => {
    for (const t of ECHO_TOOLS) {
      expect(typeof t.name).toBe('string');
      expect(t.name.length).toBeGreaterThan(0);
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(30);
      expect(t.input_schema?.type).toBe('object');
      expect(typeof t.input_schema.properties).toBe('object');
    }
  });

  it('tool names are unique', () => {
    const names = ECHO_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every tool description tells Claude when to use it', () => {
    // Cheap guardrail: descriptions should contain the word "use" or "when"
    // so the model has a usage hint.
    for (const t of ECHO_TOOLS) {
      const txt = t.description.toLowerCase();
      expect(txt.includes('use') || txt.includes('when')).toBe(true);
    }
  });

  describe('filterToolsBySkill', () => {
    it('returns only allow-listed tools', () => {
      const filtered = filterToolsBySkill(['get_part_cost_breakdown', 'get_dfm_review']);
      expect(filtered.length).toBe(2);
      expect(filtered.map((t) => t.name).sort()).toEqual([
        'get_dfm_review',
        'get_part_cost_breakdown',
      ]);
    });

    it('returns [] when the allow-list is empty', () => {
      expect(filterToolsBySkill([])).toEqual([]);
    });

    it('ignores unknown names in the allow-list', () => {
      const filtered = filterToolsBySkill(['get_part_cost_breakdown', 'imaginary_tool']);
      expect(filtered.map((t) => t.name)).toEqual(['get_part_cost_breakdown']);
    });
  });
});
