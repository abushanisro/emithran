import * as fs from 'fs';
import * as path from 'path';

import { MACHINING_FAMILIES, TURNED_FAMILIES, isMachiningFamily, isTurnedFamily } from '../../domain/part-family';

// The backend mirror must equal the CAD engine vocabulary it reads families from.
const py = fs.readFileSync(path.resolve(__dirname, '../../../../cad-engine/shared/part_family.py'), 'utf-8');
const constants = new Map([...py.matchAll(/^([A-Z_]+) = "([a-z_]+)"$/gm)].map((m) => [m[1], m[2]]));
const pySet = (name: string): string[] => {
  const line = py.split(/\r?\n/).find((l) => l.startsWith(`${name}:`)) ?? '';
  const body = line.slice(line.indexOf('{') + 1, line.lastIndexOf('}'));
  return body.split(',').map((s) => constants.get(s.trim()) ?? '').filter(Boolean).sort();
};

describe('part families mirror cad-engine/shared/part_family.py', () => {
  it('MACHINING_FAMILIES and TURNED_FAMILIES equal the engine sets', () => {
    expect([...MACHINING_FAMILIES].sort()).toEqual(pySet('MACHINING_FAMILIES'));
    expect([...TURNED_FAMILIES].sort()).toEqual(pySet('TURNED_FAMILIES'));
  });

  it.each([
    ['milled', true, false], ['turned', true, true], ['mill_turn', true, true],
    ['sheet_metal', false, false], ['plastic_molded', false, false], [null, false, false],
  ])('%s -> machined %s, turned %s', (family, machined, turned) => {
    expect(isMachiningFamily(family)).toBe(machined);
    expect(isTurnedFamily(family)).toBe(turned);
  });
});
