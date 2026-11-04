import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SAND_CORE_PROCESSES, SAND_MOULDING_PROCESSES, SAND_SCENARIO_KEYS, choiceOf, parseCavities, parsePositive } from '@/lib/costing/sand-scenario';

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
    expect(SAND_SCENARIO_KEYS).toEqual({ mouldingProcess: 'sandMouldingProcess', coreProcess: 'sandCoreProcess', energyPrice: 'energyPriceUsdPerKwh', cavities: 'cavityCount' });
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
});
