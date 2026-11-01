import { DEFAULT_YIELD_PCT, resolveYieldPct } from '../../../../../modules/bom-items/costing/shared/core/default-rates.constants';
import { computeTappingCost } from '../../../../../modules/bom-items/costing/sheet-metal/operation/tapping-engine';
import { computeSustainability } from '../../../../../modules/bom-items/costing/shared/core/cost-engine';
import type { ProcessLineCost } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';

describe('resolveYieldPct — the one shared yield default', () => {
  it('uses a real yield, including a real 1.0, without a warning', () => {
    const warnings: string[] = [];
    expect(resolveYieldPct(0.95, 'Tapping', warnings)).toBe(0.95);
    expect(resolveYieldPct(1, 'Tapping', warnings)).toBe(1);
    expect(warnings).toEqual([]);
  });

  it('applies DEFAULT_YIELD_PCT and says so when no yield is given', () => {
    const warnings: string[] = [];
    expect(resolveYieldPct(undefined, 'Tapping', warnings)).toBe(DEFAULT_YIELD_PCT);
    expect(warnings).toEqual([expect.stringContaining('Tapping: no process yield on file')]);
  });

  it('is what the sheet-metal engines use: an engine called without a yield discloses it', () => {
    const rate = { rate: 100, machineClass: 'tapping', machineName: 'T', rateSource: 'db' } as never;
    const withYield = computeTappingCost({ tapCount: 4, batchSize: 10, rate, cycleTimeSecFromCalculator: 12, yieldPct: 0.99 } as never);
    const without = computeTappingCost({ tapCount: 4, batchSize: 10, rate, cycleTimeSecFromCalculator: 12 } as never);
    expect(withYield.warnings.some((w: string) => w.includes('no process yield'))).toBe(false);
    expect(without.warnings.some((w: string) => w.includes('Tapping: no process yield'))).toBe(true);
  });
});

describe('computeSustainability — energy draw provenance', () => {
  it('marks a machine class missing from ENERGY_KWH_PER_HR as an assumed default', () => {
    const line = (machineClass: string) => ({ process: machineClass, machineClass, cycleTimeMin: 60 }) as ProcessLineCost;
    const s = computeSustainability('IS2062', 1, 1, 1.2, 10, [line('fiber_laser'), line('no_such_class')]);
    expect(s.processCo2Breakdown.map((p) => p.energySource)).toEqual(['lookup', 'default']);
  });
});
