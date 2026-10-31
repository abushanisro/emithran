// Costing golden snapshots (plan P0-21). Costing outputs must stay byte-identical unless a change to them is intended, reviewed and
// recorded. Each file in cases/ names an engine and its input; the engine's output, serialised as JSON, must equal the committed file
// in __snapshots__/ byte for byte. Nothing is rounded or normalised: a one-cent difference anywhere fails.
//
// An intended change to costing output: GOLDEN_UPDATE=1 npx jest src/test/golden, then review and commit the snapshot diff with it.
import * as fs from 'fs';
import * as path from 'path';

import { computeCostSummary, type CostEngineInput } from '../../modules/bom-items/costing/shared/core/cost-engine';

const ENGINES: Record<string, (input: never) => unknown> = {
  computeCostSummary: (input: CostEngineInput) => computeCostSummary(input),
};

interface GoldenCase {
  engine: string;
  description: string;
  input: Record<string, unknown>;
}

const CASES_DIR = path.join(__dirname, 'cases');
const SNAPSHOTS_DIR = path.join(__dirname, '__snapshots__');
const UPDATE = process.env.GOLDEN_UPDATE === '1';

const caseNames = fs.readdirSync(CASES_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length)).sort();
const readCase = (name: string): GoldenCase => JSON.parse(fs.readFileSync(path.join(CASES_DIR, `${name}.json`), 'utf8')) as GoldenCase;
const serialise = (output: unknown): string => `${JSON.stringify(output, null, 2)}\n`;

function run(golden: GoldenCase): string {
  const engine = ENGINES[golden.engine];
  if (!engine) throw new Error(`Unknown engine "${golden.engine}"; add it to ENGINES in golden.spec.ts`);
  // A fresh copy each time, so an engine that mutated its input could not change what the next run sees.
  return serialise(engine(structuredClone(golden.input) as never));
}

describe('costing golden snapshots', () => {
  it('has cases', () => {
    expect(caseNames.length).toBeGreaterThan(0);
  });

  it.each(caseNames)('%s matches its snapshot byte for byte', (name) => {
    const actual = run(readCase(name));
    const file = path.join(SNAPSHOTS_DIR, `${name}.json`);
    if (UPDATE) {
      fs.writeFileSync(file, actual);
      return;
    }
    if (!fs.existsSync(file)) throw new Error(`No snapshot for case "${name}": run with GOLDEN_UPDATE=1 and commit it`);
    expect(actual).toBe(fs.readFileSync(file, 'utf8'));
  });

  it('is deterministic: the same input twice gives the same bytes', () => {
    for (const name of caseNames) expect(run(readCase(name))).toBe(run(readCase(name)));
  });

  it('has no snapshot without a case (a deleted case must take its snapshot with it)', () => {
    const snapshots = fs.readdirSync(SNAPSHOTS_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length)).sort();
    expect(snapshots).toEqual(UPDATE ? snapshots : caseNames);
  });

  it('notices a one-cent change in an input', () => {
    const golden = readCase('sheet-metal-plain-bracket');
    const nudged = { ...golden, input: { ...golden.input, materialCostPerKg: (golden.input.materialCostPerKg as number) + 0.01 } };
    expect(run(nudged)).not.toBe(run(golden));
  });
});
