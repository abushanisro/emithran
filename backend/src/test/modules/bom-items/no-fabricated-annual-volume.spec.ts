import { readFileSync } from 'fs';
import { join } from 'path';

// annual_volume reaches costing twice over:
//
//   annual_volume -> resolveCostingInputs -> batchSize = ceil(volume / 4)
//                 -> route-scoring volume branches
//
// so a stand-in figure is a manufacturing/economic input, not a UI nicety.
// Three sites manufactured one; migration 705 removed the fourth (the schema
// default itself). These guard the code-side three.

const root = join(__dirname, '..', '..', '..');
const executable = (p: string) =>
  readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

describe('no code path manufactures an annual volume', () => {
  it('does not give a created assembly a volume nobody stated', () => {
    const src = executable(join(root, 'modules', 'bom-items', 'bom-items.controller.ts'));
    expect(src).not.toMatch(/annualVolume:\s*1000/);
  });

  it('keeps annual volume out of COSTING_INPUT_DEFAULTS', () => {
    // batchSize and productionLifeYears legitimately default. Annual volume
    // must not: bom_items.annual_volume is its only source, and "no volume on
    // file" is a real answer the resolver reports as provenance 'absent'.
    const src = executable(join(root, 'modules', 'bom-items', 'costing', 'shared', 'physics', 'costing-inputs.ts'));
    const block = src.slice(src.indexOf('COSTING_INPUT_DEFAULTS'), src.indexOf('} as const'));
    expect(block).not.toContain('annualVolume');
  });

  it('applies the quarterly-release rule only to a real volume', () => {
    // ceil(volume / BATCHES_PER_YEAR) must sit behind a null check, so an
    // absent volume yields no derived batch rather than a batch of 1.
    const src = readFileSync(
      join(root, 'modules', 'bom-items', 'costing', 'shared', 'physics', 'costing-inputs.ts'), 'utf8');
    expect(src).toMatch(/annualVolume !== null[\s\S]{0,120}BATCHES_PER_YEAR/);
  });
});
