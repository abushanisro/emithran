import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { computeEngineBuild, engineClosure } from '../../../../../test-tools/engine-build-id';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const generator = require('../../../../../../scripts/engine-build-id') as { render: () => string; GENERATED: string; ROOT_FILE: string };

function project(files: Record<string, string>): { root: string; file: (n: string) => string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-build-'));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return { root, file: (n) => path.join(root, n) };
}

describe('engine build identifier: a hash of the code that runs', () => {
  const base = { 'engine.ts': "import { a } from './lib/a';\nimport type { T } from './types';\nimport data from './data.json';\nexport const x = a;", 'lib/a.ts': "import { b } from '../lib/b';\nexport const a = b;", 'lib/b.ts': 'export const b = 1;', 'types.ts': 'export type T = string;', 'data.json': '{}' };

  it('follows the runtime imports, json included, and not `import type` (erased at compile time)', () => {
    const p = project(base);
    expect(engineClosure(p.file('engine.ts')).map((f) => path.relative(p.root, f))).toEqual(['data.json', 'engine.ts', 'lib/a.ts', 'lib/b.ts']);
  });

  it('is the same for the same code, and changes when any file it reaches changes', () => {
    const a = project(base); const b = project(base); const c = project({ ...base, 'lib/b.ts': 'export const b = 2;' });
    expect(computeEngineBuild(a.file('engine.ts'), a.root)).toEqual(computeEngineBuild(b.file('engine.ts'), b.root));
    expect(computeEngineBuild(c.file('engine.ts'), c.root).codeHash).not.toBe(computeEngineBuild(a.file('engine.ts'), a.root).codeHash);
  });

  it('does not change for a file the engine does not reach, or for the line endings of the checkout', () => {
    const a = project(base);
    const unrelated = project({ ...base, 'other.ts': 'export const z = 1;' });
    const crlf = project(Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v.replace(/\n/g, '\r\n')])));
    const h = computeEngineBuild(a.file('engine.ts'), a.root).codeHash;
    expect(computeEngineBuild(unrelated.file('engine.ts'), unrelated.root).codeHash).toBe(h);
    expect(computeEngineBuild(crlf.file('engine.ts'), crlf.root).codeHash).toBe(h);
  });

  it('leaves out a generated file (the output of this computation) and survives an import cycle', () => {
    const p = project({ 'engine.ts': "import { v } from './engine-build.generated';\nimport { a } from './a';\nexport const x = [v, a];", 'engine-build.generated.ts': 'export const v = 1;', 'a.ts': "import { x } from './engine';\nexport const a = x;" });
    expect(engineClosure(p.file('engine.ts')).map((f) => path.basename(f))).toEqual(['a.ts', 'engine.ts']);
  });

  it('the identifier committed with the engine is the one its code gives now: change the engine without regenerating it and this fails (run `npm run engine-build`)', () => {
    expect(fs.readFileSync(generator.GENERATED, 'utf8')).toBe(generator.render());
  });

  it('covers the whole engine: the molding engine, the cycle and clamp models, the mold tooling and the snapshot code are all in the hashed set', () => {
    const files = engineClosure(generator.ROOT_FILE).map((f) => path.basename(f));
    for (const f of ['cost-injection-molding-engine.ts', 'cycle-time.ts', 'clamp-force.ts', 'shot-size.ts', 'mold-tooling-engine.ts', 'calculation-snapshot.ts', 'formula-registry.ts', 'plastic-reference.ts', 'engine-kernel.ts']) {
      expect(files).toContain(f);
    }
    expect(files).not.toContain('engine-build.generated.ts');
  });
});
