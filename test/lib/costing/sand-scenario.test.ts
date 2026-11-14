import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { HOT_BOX_GUIDANCE, SAND_CORE_PROCESSES, SAND_MOULDING_PROCESSES, SAND_SCENARIO_KEYS, choiceOf, parseCavities, parsePositive, sandOverrideCount } from '@/lib/costing/sand-scenario';

describe('sand scenario fields', () => {
  it('a positive number is read, an empty field clears the choice, anything else is refused without changing it', () => {
    expect(parsePositive(' 0.12 ')).toBe(0.12);
    expect(parsePositive('')).toBeNull();
    expect(parsePositive('   ')).toBeNull();
    for (const bad of ['abc', '0', '-1', 'NaN', 'Infinity']) expect(parsePositive(bad)).toBe('invalid');
  });

  it('cavities are whole numbers', () => {
    expect(parseCavities('4')).toBe(4);
    expect(parseCavities('')).toBeNull();
    for (const bad of ['1.5', '0', '-2', 'x']) expect(parseCavities(bad)).toBe('invalid');
  });

  it('the empty select option clears the choice', () => {
    expect(choiceOf('')).toBeNull();
    expect(choiceOf('Shell')).toBe('Shell');
  });

  it('uses the backend\'s keys and process names (a name it does not know is ignored there)', () => {
    expect(SAND_SCENARIO_KEYS).toEqual({ mouldingProcess: 'sandMouldingProcess', coreProcess: 'sandCoreProcess', energyPrice: 'energyPriceUsdPerKwh', cavities: 'cavityCount', hotBoxCoreboxTemp: 'hotBoxCoreboxTempC', hotBoxCureTemp: 'hotBoxCureTempC', hotBoxCuredDepth: 'hotBoxCuredDepthMm', refractoryCoat: 'sandRefractoryCoat', refractoryDryMethod: 'sandRefractoryDryMethod', refractoryDryMinutes: 'sandRefractoryDryMinutes', refractoryCoatPrice: 'refractoryCoatingUsdPerKg' });
    expect(SAND_MOULDING_PROCESSES).toHaveLength(5);
    expect(SAND_CORE_PROCESSES).toEqual(['Hot Box', 'CO2 Cured', 'No Bake', 'Oil Core', 'Shell']);
  });

  it('the process names are exactly the backend\'s lists, in order', () => {
    const casting = join(__dirname, '../../../backend/src/modules/bom-items/costing/casting/sand');
    const namesIn = (file: string, list: string) => {
      const text = readFileSync(join(casting, file), 'utf8');
      const block = text.slice(text.indexOf(`export const ${list}`), text.indexOf('] as const', text.indexOf(`export const ${list}`)));
      return [...block.matchAll(/process: '([^']+)'/g)].map((m) => m[1]);
    };
    expect([...SAND_MOULDING_PROCESSES]).toEqual(namesIn('sand-route.ts', 'MOULDING_PROCESSES'));
    expect([...SAND_CORE_PROCESSES]).toEqual(namesIn('sand-cores.ts', 'CORE_PROCESSES'));
  });

  it('the hot box settings are keys the backend reads (sand-cost.ts), and temperatures and a depth are positive numbers', () => {
    const backend = readFileSync(join(__dirname, '../../../backend/src/modules/bom-items/costing/casting/sand/sand-cost.ts'), 'utf8');
    for (const key of [SAND_SCENARIO_KEYS.hotBoxCoreboxTemp, SAND_SCENARIO_KEYS.hotBoxCureTemp, SAND_SCENARIO_KEYS.hotBoxCuredDepth]) {
      expect(backend).toContain(`'${key}'`);
    }
    expect(parsePositive('245')).toBe(245);
    expect(parsePositive('6.35')).toBe(6.35);
    expect(parsePositive('-5')).toBe('invalid');
  });

  it('the guidance names the published values the engine uses when a hot box field is empty, the same as the backend (US 5,365,995)', () => {
    const cores = readFileSync(join(__dirname, '../../../backend/src/modules/bom-items/costing/casting/sand/sand-cores.ts'), 'utf8');
    for (const [text, value] of [[HOT_BOX_GUIDANCE.coreboxTemp, '232'], [HOT_BOX_GUIDANCE.cureTemp, '48.9'], [HOT_BOX_GUIDANCE.curedDepth, '12.7']] as const) {
      expect(text).toContain(value);
      expect(text).toContain('US 5,365,995');
      expect(cores).toContain(`value: ${value}`);
    }
  });
});

describe('sandOverrideCount', () => {
  it('counts the sand settings the user set, and nothing else', () => {
    expect(sandOverrideCount(null)).toBe(0);
    expect(sandOverrideCount({})).toBe(0);
    expect(sandOverrideCount({ [SAND_SCENARIO_KEYS.cavities]: 2, [SAND_SCENARIO_KEYS.refractoryCoat]: 'none', batchSize: 250 })).toBe(2);
    expect(sandOverrideCount({ [SAND_SCENARIO_KEYS.mouldingProcess]: '', [SAND_SCENARIO_KEYS.energyPrice]: null })).toBe(0);
  });
});
