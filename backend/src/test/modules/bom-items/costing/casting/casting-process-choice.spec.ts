import { castingFamilyOption, chooseCastingFamily } from '../../../../../modules/bom-items/costing/casting/casting-process-choice';
import type { ProcessLineCost } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';

// A part whose Process is "Casting": every casting process is priced and the cheapest fully costed one is quoted.
const line = (process: string, totalCost: number, gap?: string): ProcessLineCost => ({
  process, setupCost: 0, runCost: totalCost, totalCost, cycleTimeMin: 1, setupTimeMin: 0, hourlyRate: 10, rateSource: 'mhr_database', machineClass: 'x',
  machineName: 'm', commodityCode: null, labourRate: null,
  ...(gap ? { physicsGap: { gapType: 'unsupported_operation' as const, process, machineClass: 'x', reason: gap } } : {}),
} as ProcessLineCost);

describe('a casting family as an option', () => {
  it('is its piece cost plus its tooling per part, in the summary currency', () => {
    const sand = castingFamilyOption('sand_cast', { processLines: [line('Melting', 2)], totalCost: 5, coreboxTooling: { boxes: 1, costUsd: 1000, perPartUsd: 0.5, detail: '' }, usdToDisplayRate: 80 });
    expect(sand).toEqual({ family: 'sand_cast', process: 'Sand Casting', costed: true, total: 5 + 0.5 * 80, detail: null });
  });

  it('is not costed while a step is a gap, and says which', () => {
    const o = castingFamilyOption('investment_cast', { processLines: [line('Wax Pattern Molding', 1), line('Metal Pouring', 0, 'no furnace reaches 1600 °C')], totalCost: 1 });
    expect(o).toMatchObject({ costed: false, total: null, detail: 'Metal Pouring: no furnace reaches 1600 °C' });
  });

  it('is not costed when no die-casting process is feasible, with the engine\'s own reason', () => {
    const o = castingFamilyOption('die_cast', {
      processLines: [line('Trim', 1)], totalCost: 1,
      dieCastingProcess: { chosen: 'High Pressure Die Casting', chosenBy: 'none_feasible', basis: 'piece_only', options: [{ process: 'High Pressure Die Casting', feasible: false, detail: 'not a die-casting alloy', pieceCost: null, toolingPerPart: null, total: null }] },
    });
    expect(o).toMatchObject({ process: 'Die Casting', costed: false, detail: 'High Pressure Die Casting: not a die-casting alloy' });
  });
});

describe('the casting family that is quoted', () => {
  const option = (process: string, total: number | null, detail: string | null = null) => ({ family: process, process, costed: total != null, total, detail });

  it('is the cheapest fully costed one, and the note gives the others', () => {
    const { chosen, note } = chooseCastingFamily([option('Die Casting', null, 'not a die-casting alloy'), option('Sand Casting', 14.2), option('Casting Investment', 9.87)]);
    expect(chosen.process).toBe('Casting Investment');
    expect(note).toBe('Casting: Casting Investment is quoted, the cheapest casting process that is fully costed (piece cost + tooling per part, 9.87). Die Casting could not be priced (not a die-casting alloy); Sand Casting 14.20.');
  });

  it('is the first on a tie', () => {
    expect(chooseCastingFamily([option('Die Casting', 3), option('Sand Casting', 3)]).chosen.process).toBe('Die Casting');
  });

  it('is the first when none is costed, and the note says why each is not', () => {
    const { chosen, note } = chooseCastingFamily([option('Die Casting', null, 'a'), option('Sand Casting', null, 'b')]);
    expect(chosen.process).toBe('Die Casting');
    expect(note).toBe('Casting: no casting process could be fully costed for this part. Die Casting could not be priced (a); Sand Casting could not be priced (b).');
  });
});
