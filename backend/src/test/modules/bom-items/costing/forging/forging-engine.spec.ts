import { defined, loadReference, material } from './forging-fixtures';
import { computeClosedDieForging } from '../../../../../modules/bom-items/costing/forging/forging-engine';

import type { ProcessLineCost } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';

const ref = loadReference();
const steel = material('Steel, Hot Worked, AISI 1045');
// Entered die quotes (v1.1 D7) and scenario volumes: inputs, not memory values.
const input = {
  reference: ref, referenceMissing: [], material: steel, materialGrade: steel.name,
  partVolumeMm3: 150_000, complexityScore: 6, heating: 'induction' as const, forgeClass: 'press' as const,
  annualVolume: 10_000, productionLifeYears: 5,
  forgeDie: { dieCostUsd: 10_000, replacementDieCostUsd: 10_000, coating: 'None' },
  trimDie: { dieCostUsd: 3_000, replacementDieCostUsd: 2_000, coating: 'None' },
};

// The gap reason of an unsupported_operation line (PhysicsGap is a union; LookupGap has none).
const gapReason = (l: ProcessLineCost): string | null => {
  const g = l.physicsGap;
  return g && 'reason' in g ? g.reason : null;
};

describe('closed-die forging engine, Phase 1', () => {
  it('costs the material and the dies; every other step is a gap line naming what memory lacks', () => {
    const r = computeClosedDieForging(input);
    const mat = defined(r.material, 'material');
    // Material: v1.1 worked example on Ø44.45 (the only valid induction bar).
    // gross 186,726.94 mm³ × 1e-9 × 7850 = 1.46581 kg × 1.479 USD/kg = 2.16793 USD; no scrap credit (switch false).
    expect(mat.weights.barDiameterMm).toBe(44.45);
    expect(mat.grossCostUsd).toBeCloseTo(2.16793, 5);
    expect(mat.scrapCreditUsd).toBe(0);
    expect(mat.netMaterialCostUsd).toBeCloseTo(2.16793, 5);
    // Dies: press 7 sets → 1.40 USD per part; trim 3,000 + 6 × 2,000 = 15,000 → 0.30 USD per part.
    expect(r.forgeDie).toMatchObject({ amortised: true, dieSets: 7 });
    const forgeDie = defined(r.forgeDie, 'forge die');
    const trimDie = defined(r.trimDie, 'trim die');
    expect(forgeDie.amortised && forgeDie.perPartUsd).toBeCloseTo(1.4, 10);
    expect(trimDie.amortised && trimDie.perPartUsd).toBeCloseTo(0.3, 10);
    // Lines: Band Saw, Conveyor Induction Heat, Press, Trim, all uncosted with a named reason.
    expect(r.processLines.map((l) => [l.process, l.machineClass, l.totalCost])).toEqual([
      ['Band Saw', 'forging_band_saw', 0],
      ['Conveyor Induction Heat', 'forging_conveyor_induction_heat', 0],
      ['Press', 'forging_press', 0],
      ['Trim', 'forging_trim', 0],
    ]);
    for (const l of r.processLines) {
      expect(l.physicsGap).toMatchObject({ gapType: 'unsupported_operation', process: l.process });
      expect(l.rateSource).toBe('no_db_rate');
    }
    expect(gapReason(r.processLines[2])).toContain('closed-die forging force formula');
    expect(r.gaps).toHaveLength(4);
    expect(r.warnings).toEqual(['Material excludes bar-end loss over a stock length: memory names standardStockLength and multLengthElongationFactor but not their formula (v1.1 6.5).']);
  });

  it('furnace heating and a hammer route name their own gaps', () => {
    const r = computeClosedDieForging({ ...input, heating: 'furnace', forgeClass: 'hammer' });
    expect(r.processLines.map((l) => l.process)).toEqual(['Band Saw', 'Preheat', 'Hammer', 'Trim']);
    expect(gapReason(r.processLines[2])).toContain('Impact Energy Factor');
    // Furnace scale 3 %: gross 1.494066 kg × 1.479 = 2.20972 USD (stock spec).
    expect(defined(r.material, 'material').grossCostUsd).toBeCloseTo(2.20972, 5);
  });

  it('no complexity score, heating or forge class: no material, no forge die, each named', () => {
    const r = computeClosedDieForging({ ...input, complexityScore: null, heating: null, forgeClass: null });
    expect(r.material).toBeNull();
    expect(r.forgeDie).toBeNull();
    expect(r.processLines.map((l) => l.process)).toEqual(['Band Saw', 'Heat', 'Forge', 'Trim']);
    expect(r.gaps).toEqual(expect.arrayContaining([
      'Material not costed: Gross weight not derivable: missing part complexity score (1-12; its scoring algorithm is not in memory, v1.1 6.2: enter it); heating method (induction or furnace).',
      'Heating method (induction or furnace) not chosen.',
      'Forge die not amortised: forge machine class not chosen (its tool life is per class).',
    ]));
  });

  it('scrap credit switched on is a gap, not a guessed credit', () => {
    const r = computeClosedDieForging({ ...input, reference: { ...ref, switches: { ...ref.switches, enableScrapMaterialCredit: true } } });
    const mat = defined(r.material, 'material');
    expect(mat.scrapCreditUsd).toBeNull();
    expect(mat.netMaterialCostUsd).toBeNull();
    expect(r.gaps).toContain('Scrap credit not derivable: enableScrapMaterialCredit is true, but memory does not define how "Scrap Cost Percent" values flash and kerf scrap (v1.1 6.6).');
  });

  // costStatus / incompleteProcesses: a flag, not a formula. A gap line costs 0,
  // so a result with any gap is a partial total and must say so. Phase 1 cannot
  // build a 'complete' result (every line is a gap by design); that case is
  // tested with the first costed line (Phase 2).
  describe('incomplete flag', () => {
    const gapLines = (r: ReturnType<typeof computeClosedDieForging>) => r.processLines.filter((l) => l.physicsGap).map((l) => l.process);

    it('lists every gap line, in route order, and marks the result incomplete', () => {
      const r = computeClosedDieForging(input);
      expect(r.costStatus).toBe('incomplete');
      expect(r.incompleteProcesses).toEqual(['Band Saw', 'Conveyor Induction Heat', 'Press', 'Trim']);
      // No gap line can be left off the list.
      expect(r.incompleteProcesses).toEqual(gapLines(r));
    });

    it('names the placeholder lines when the route is not chosen', () => {
      const r = computeClosedDieForging({ ...input, complexityScore: null, heating: null, forgeClass: null });
      expect(r.costStatus).toBe('incomplete');
      expect(r.incompleteProcesses).toEqual(['Band Saw', 'Heat', 'Forge', 'Trim']);
      expect(r.incompleteProcesses).toEqual(gapLines(r));
    });

    it('a stop with no lines (no reference) is still incomplete', () => {
      const r = computeClosedDieForging({ ...input, reference: null, referenceMissing: ['variables bandSawKerfWidth'] });
      expect(r.processLines).toEqual([]);
      expect(r.incompleteProcesses).toEqual([]);
      expect(r.costStatus).toBe('incomplete');
    });
  });

  it('missing reference or a non-forging material stops everything with a named gap', () => {
    expect(computeClosedDieForging({ ...input, reference: null, referenceMissing: ['variables bandSawKerfWidth'] }).gaps)
      .toEqual(['Forging reference data not staged: variables bandSawKerfWidth (migration 823).']);
    expect(computeClosedDieForging({ ...input, material: null, materialGrade: 'ADC12' }).gaps)
      .toEqual(['Material "ADC12" is not a Forging material in Raw Materials (material group Forging, migration 855).']);
  });
});
