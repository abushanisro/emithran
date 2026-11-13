import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REFRACTORY_COAT_CHOICES, REFRACTORY_DRY_METHODS, REFRACTORY_GUIDANCE, SAND_SCENARIO_KEYS } from '@/lib/costing/sand-scenario';

describe('the refractory coating choices of the Cost Guide', () => {
  it('use the keys and the values the backend reads (sand-cost.ts, sand-refractory.ts)', () => {
    expect(SAND_SCENARIO_KEYS.refractoryCoat).toBe('sandRefractoryCoat');
    expect(SAND_SCENARIO_KEYS.refractoryDryMethod).toBe('sandRefractoryDryMethod');
    expect(SAND_SCENARIO_KEYS.refractoryDryMinutes).toBe('sandRefractoryDryMinutes');
    expect(SAND_SCENARIO_KEYS.refractoryCoatPrice).toBe('refractoryCoatingUsdPerKg');
    expect(REFRACTORY_COAT_CHOICES.map((c) => c.value)).toEqual(['none', 'mould', 'cores', 'both']);
    expect(REFRACTORY_DRY_METHODS.map((m) => m.value)).toEqual(['oven', 'air']);
  });

  it('are the keys and values of the backend itself, read from its source', () => {
    const dir = join(__dirname, '../../../backend/src/modules/bom-items/costing/casting/sand');
    const cost = readFileSync(join(dir, 'sand-cost.ts'), 'utf8');
    const refractory = readFileSync(join(dir, 'sand-refractory.ts'), 'utf8');
    for (const key of [SAND_SCENARIO_KEYS.refractoryCoat, SAND_SCENARIO_KEYS.refractoryDryMethod, SAND_SCENARIO_KEYS.refractoryDryMinutes, SAND_SCENARIO_KEYS.refractoryCoatPrice]) {
      expect(cost).toContain(`'${key}'`);
    }
    const list = (name: string) => [...(refractory.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`))?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(list('COAT_CHOICES')).toEqual(REFRACTORY_COAT_CHOICES.map((c) => c.value));
    expect(list('DRY_METHODS')).toEqual(REFRACTORY_DRY_METHODS.map((m) => m.value));
  });

  it('give the published range beside the drying time and say that nothing is assumed for the price', () => {
    expect(REFRACTORY_GUIDANCE.dryMinutes).toMatch(/10-30 minutes/);
    expect(REFRACTORY_GUIDANCE.price).toMatch(/nothing is assumed/);
  });
});
