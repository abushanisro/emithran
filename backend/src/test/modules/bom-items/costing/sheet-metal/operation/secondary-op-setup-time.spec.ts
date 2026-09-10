import { computeTappingCost } from '../../../../../../modules/bom-items/costing/sheet-metal/operation/tapping-engine';
import { computePemInsertionCost } from '../../../../../../modules/bom-items/costing/sheet-metal/operation/pem-insertion-engine';
import { computeHoleExtrusionCost } from '../../../../../../modules/bom-items/costing/sheet-metal/operation/hole-extrusion-engine';
import { computeCounterboringCost } from '../../../../../../modules/bom-items/costing/sheet-metal/operation/counterboring-engine';
import { computeCountersinkingCost } from '../../../../../../modules/bom-items/costing/sheet-metal/operation/countersinking-engine';
import { computeReamingCost } from '../../../../../../modules/bom-items/costing/sheet-metal/operation/reaming-engine';
import { computeDeburringCost } from '../../../../../../modules/bom-items/costing/sheet-metal/operation/deburring-engine';
import type { MHRRateInput } from '../../../../../../modules/bom-items/costing/shared/core/cost-engine';

// Every secondary-op engine used to take ONE pre-collapsed `fallbackSetupMin`
// (`opSetupMinByOp?.x ?? X_SETUP_MIN`) and never report the setup it charged.
// Two consequences, both fixed 2026-09-05 and pinned here:
//   - the selected machine's own real mhr_records.setup_time_hr was never
//     consulted, so two machines of a class always cost identical setup;
//   - the line carried no setupTimeMin, so apply-route persisted a literal
//     15 min for every one of these operations regardless of what was charged.

function rate(overrides: Partial<MHRRateInput> = {}): MHRRateInput {
  return {
    rate: 40,
    source: 'mhr_database',
    machineClass: 'drill_press',
    machineName: 'Test Machine',
    commodityCode: null,
    labourRate: 20,
    ...overrides,
  };
}

// One entry per registered secondary-op engine, each invoked with the real
// feature count that gates it on. `setupTimeHr` 0.5 => 30 real minutes.
const ENGINES = [
  {
    name: 'Tapping',
    run: (r: MHRRateInput, extra: Record<string, unknown>) =>
      computeTappingCost({ tapCount: 4, batchSize: 10, rate: r, cycleTimeSecFromCalculator: 12, fallbackSetupMin: 10, ...extra } as never),
  },
  {
    name: 'PEM Insertion',
    run: (r: MHRRateInput, extra: Record<string, unknown>) =>
      computePemInsertionCost({ pemCount: 3, batchSize: 10, rate: r, cycleTimeSecFromCalculator: 12, fallbackSetupMin: 5, ...extra } as never),
  },
  {
    name: 'Hole Extrusion (Burring)',
    run: (r: MHRRateInput, extra: Record<string, unknown>) =>
      computeHoleExtrusionCost({ extrudedFlangeCount: 2, batchSize: 10, rate: r, cycleTimeSecFromCalculator: 12, fallbackSetupMin: 5, ...extra } as never),
  },
  {
    name: 'Counterboring',
    run: (r: MHRRateInput, extra: Record<string, unknown>) =>
      computeCounterboringCost({ counterboreCount: 2, batchSize: 10, rate: r, cycleTimeSecFromCalculator: 12, fallbackSetupMin: 5, ...extra } as never),
  },
  {
    name: 'Countersinking',
    run: (r: MHRRateInput, extra: Record<string, unknown>) =>
      computeCountersinkingCost({ countersinkCount: 2, batchSize: 10, rate: r, cycleTimeSecFromCalculator: 12, fallbackSetupMin: 5, ...extra } as never),
  },
  {
    name: 'Reaming',
    run: (r: MHRRateInput, extra: Record<string, unknown>) =>
      computeReamingCost({ reamCount: 2, batchSize: 10, rate: r, cycleTimeSecFromCalculator: 12, fallbackSetupMin: 8, ...extra } as never),
  },
] as const;

describe.each(ENGINES.map((e) => [e.name, e] as const))(
  'secondary-op setup time — %s',
  (_name, engine) => {
    it('uses the selected machine own real setup_time_hr, and says so', () => {
      const line = engine.run(rate({ setupTimeHr: 0.5 }), { operationSetupMin: 12 }).processLines[0]!;
      expect(line.setupTimeMin).toBeCloseTo(30, 5);
      expect(line.setupTimeSource).toBe('machine');
    });

    it('falls to the real per-operation lookup when the machine has none', () => {
      const line = engine.run(rate({ setupTimeHr: null }), { operationSetupMin: 12 }).processLines[0]!;
      expect(line.setupTimeMin).toBeCloseTo(12, 5);
      expect(line.setupTimeSource).toBe('operation_lookup');
    });

    it('falls to the cited class constant last, and discloses that it did', () => {
      const result = engine.run(rate({ setupTimeHr: null }), { operationSetupMin: null });
      expect(result.processLines[0]!.setupTimeSource).toBe('class_default');
      expect(result.warnings.some((w) => w.includes('setup time from fallback'))).toBe(true);
    });

    it('reports the UN-amortised batch setup while charging the amortised cost', () => {
      // The line's setupTimeMin is what apply-route persists, so it has to be
      // the real batch setup — not the per-part slice used to price it.
      const batchSize = 10;
      const r = rate({ setupTimeHr: 0.5, labourRate: 20 });
      const line = engine.run(r, { operationSetupMin: null, batchSize }).processLines[0]!;
      expect(line.setupTimeMin).toBeCloseTo(30, 5);
      const expectedCost = (40 / 60 + 20 / 60 * 1) * (30 / batchSize);
      expect(line.setupCost).toBeCloseTo(Math.round(expectedCost * 100) / 100, 5);
    });

    it('lets two machines of the same class carry genuinely different setup cost', () => {
      const quick = engine.run(rate({ setupTimeHr: 0.25 }), {}).processLines[0]!;
      const slow = engine.run(rate({ setupTimeHr: 1.0 }), {}).processLines[0]!;
      expect(quick.setupTimeMin).toBeCloseTo(15, 5);
      expect(slow.setupTimeMin).toBeCloseTo(60, 5);
      expect(slow.setupCost).toBeGreaterThan(quick.setupCost);
    });

    it('ignores a zero machine setup time, which means "never populated"', () => {
      const line = engine.run(rate({ setupTimeHr: 0 }), { operationSetupMin: 12 }).processLines[0]!;
      expect(line.setupTimeMin).toBeCloseTo(12, 5);
      expect(line.setupTimeSource).toBe('operation_lookup');
    });
  },
);

describe('secondary-op setup time — Deburring', () => {
  it('reports the zero setup it genuinely charges, instead of leaving the field absent', () => {
    // Deburring has no batchSize input and no per-class setup constant: it
    // passes setupTimeMin 0 into eMithranTerms and emits setupCost 0. Before
    // this reported 0, apply-route persisted a literal 15 min for the line —
    // a saved record claiming a setup the engine never charged.
    const line = computeDeburringCost({
      cutLengthMm: 500,
      rate: rate({ machineClass: 'deburring', machineName: 'Default Deslag', setupTimeHr: 0 }),
      cycleTimeSecFromCalculator: 20,
    }).processLines[0]!;
    expect(line.setupTimeMin).toBe(0);
    expect(line.setupCost).toBe(0);
  });
});
