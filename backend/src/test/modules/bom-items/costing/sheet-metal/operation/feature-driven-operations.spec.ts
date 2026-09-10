import {
  composeFeatureDrivenOperations,
  composeOperationSequence,
  type FeatureDrivenOperationInput,
  type EMithranSharedContext,
} from '../../../../../../modules/bom-items/costing/sheet-metal/operation/feature-driven-operations';
import type { ProcessLineCost } from '../../../../../../modules/bom-items/dto/cost-breakdown.dto';

// The canonical composer. Before it existed, computeCostSummary() assembled nine
// feature-driven operations and getRouteComparison() independently assembled
// four, so the same part had two different operation sequences and two different
// totals depending on which path produced the answer. PEM Insertion — genuinely
// present on the reported SECC part, recognised from real CAD through-hole data
// matched against sm_lookup_pem_hardware — was in the quote and in none of the
// fifteen routes it was compared against.
//
// Every operation below is gated on a real feature count. These tests pin that
// gating: nothing appears without a feature behind it, and nothing that has one
// is dropped.

const rate = (machineClass: string) => ({
  rate: 20, source: 'mhr_database' as const, machineClass,
  machineName: 'test machine', commodityCode: null,
});

const CTX: EMithranSharedContext = {
  dlrPerHr: 36.3, qairPerHr: 46.67, inspTimeMin: 0.5, samplingRate: 0.08,
  yieldPct: 100, netMatCost: 0.04, netWeightKg: 0.024, scrapPricePerKg: 0,
};

/**
 * The reported SECC part's real extracted features: 4 holes (Ø2.0 ×1, Ø4.2 ×2,
 * Ø5.0 ×1) at 1.5 mm, 4 bends, no threads, no extruded flange, no counterbore or
 * countersink groups, and no tolerance callout. Ø4.2 matches PEM S-M3-2.
 */
function seccPart(over: Partial<FeatureDrivenOperationInput> = {}): FeatureDrivenOperationInput {
  return {
    batchSize: 100_000,
    cutLengthMm: 290,
    threads: [],
    location: 'USA',
    holeCount: 4,
    tightestToleranceMm: null,
    extrudedFlangeCount: 0,
    counterboreCount: 0,
    countersinkCount: 0,
    pemCount: 2,
    pemCycleTimeSecFromCalculator: 8,
    pemCalculatorId: 'pem-calc',
    deburrCycleTimeSecFromCalculator: 19.62,
    deburrCalculatorId: 'deburr-calc',
    mhrRates: {
      deburring: rate('deburring'),
      tapping: rate('tapping'),
      holeForming: rate('hole_forming'),
      drillPress: rate('drill_press'),
      pemPress: rate('pem_press'),
    },
    ...over,
  } as FeatureDrivenOperationInput;
}

const names = (lines: readonly ProcessLineCost[]) => lines.map((l) => l.process);

describe('composeFeatureDrivenOperations — the reported SECC part', () => {
  it('includes PEM Insertion, because real hole data matched real PEM hardware', () => {
    const r = composeFeatureDrivenOperations(seccPart(), CTX);
    expect(names(r.postForm)).toContain('PEM Insertion');
  });

  it('includes Deburring, because the part has a real cut length', () => {
    expect(names(composeFeatureDrivenOperations(seccPart(), CTX).postForm)).toContain('Deburring');
  });

  it('omits every operation whose real feature gate is not satisfied', () => {
    const r = composeFeatureDrivenOperations(seccPart(), CTX);
    const all = [...names(r.preForm), ...names(r.postForm)];
    // extrudedFlangeCount 0 / no threads / no counterbore or countersink groups /
    // no tolerance callout / no surface treatment set.
    expect(all).not.toContain('Hole Extrusion (Burring)');
    expect(all).not.toContain('Tapping');
    expect(all).not.toContain('Counterboring');
    expect(all).not.toContain('Countersinking');
    expect(all).not.toContain('Reaming');
  });

  it('does not add a general Inspection line of its own', () => {
    // Inspection is resolved by the caller and consumed here. Absent input means
    // no line — the composer never invents one, and never promotes the fact that
    // inspection resolves to resource class `cmm` into a separate CMM operation.
    const r = composeFeatureDrivenOperations(seccPart(), CTX);
    expect(names(r.postForm)).not.toContain('Inspection');
  });
});

describe('composeFeatureDrivenOperations — gating is driven by real features', () => {
  it('adds Hole Extrusion only when an extruded flange was detected', () => {
    const withFlange = composeFeatureDrivenOperations(
      seccPart({ extrudedFlangeCount: 2, burringCycleTimeSecFromCalculator: 6, burringCalculatorId: 'b' }), CTX,
    );
    expect(names(withFlange.preForm)).toContain('Hole Extrusion (Burring)');
  });

  it('adds Tapping only when the part has thread features', () => {
    const threaded = composeFeatureDrivenOperations(
      seccPart({
        threads: [{ size: 'M3', count: 2 }],
        tappingCycleTimeSecFromCalculator: 4, tappingCalculatorId: 't',
      }), CTX,
    );
    expect(names(threaded.preForm)).toContain('Tapping');
  });

  it('adds Counterboring and Countersinking only for their own detected groups', () => {
    const bored = composeFeatureDrivenOperations(
      seccPart({ counterboreCount: 3, counterboreCycleTimeSecFromCalculator: 9, counterboreCalculatorId: 'c' }), CTX,
    );
    expect(names(bored.postForm)).toContain('Counterboring');
    expect(names(bored.postForm)).not.toContain('Countersinking');
  });

  it('adds Reaming only when a real tight-tolerance callout exists', () => {
    const loose = composeFeatureDrivenOperations(seccPart({ tightestToleranceMm: 0.5 }), CTX);
    expect(names(loose.postForm)).not.toContain('Reaming');

    const tight = composeFeatureDrivenOperations(
      seccPart({ tightestToleranceMm: 0.01, reamCycleTimeSecFromCalculator: 12, reamCalculatorId: 'r' }), CTX,
    );
    expect(names(tight.postForm)).toContain('Reaming');
  });

  it('places hole extrusion and tapping BEFORE forming, finishing after', () => {
    // Physical ordering: the collar is formed and threaded while the part is
    // still flat.
    const r = composeFeatureDrivenOperations(
      seccPart({
        extrudedFlangeCount: 1, burringCycleTimeSecFromCalculator: 6, burringCalculatorId: 'b',
        threads: [{ size: 'M3', count: 2 }],
        tappingCycleTimeSecFromCalculator: 4, tappingCalculatorId: 't',
      }), CTX,
    );
    expect(names(r.preForm)).toEqual(['Hole Extrusion (Burring)', 'Tapping']);
    expect(names(r.postForm)).toEqual(['Deburring', 'PEM Insertion']);
  });
});

describe('composeOperationSequence — the final operation sequence', () => {
  const line = (process: string): ProcessLineCost => ({
    process, machineClass: 'x', machineName: null, commodityCode: null,
    setupCost: 0, runCost: 0, totalCost: 0, cycleTimeMin: 1,
    hourlyRate: 10, rateSource: 'mhr_database',
  } as ProcessLineCost);

  const featureDriven = {
    preForm: [line('Hole Extrusion (Burring)'), line('Tapping')],
    postForm: [line('Deburring'), line('PEM Insertion'), line('Inspection')],
    warnings: [],
    cycleMinutes: { tappingMin: 1, deburrMin: 1 },
  };

  it('wraps a cutting route: cut, flat-state ops, bend, finishing', () => {
    expect(names(composeOperationSequence({
      coreCutting: [line('Laser Cutting')],
      coreForming: [line('Press Brake')],
      featureDriven,
    }))).toEqual([
      'Laser Cutting', 'Hole Extrusion (Burring)', 'Tapping',
      'Press Brake', 'Deburring', 'PEM Insertion', 'Inspection',
    ]);
  });

  it('charges no separate Press Brake on a forming route that bends in-process', () => {
    const seq = composeOperationSequence({
      coreCutting: [line('Standard Press')],
      coreForming: [],
      featureDriven,
    });
    expect(names(seq)).not.toContain('Press Brake');
    expect(names(seq)).toEqual([
      'Standard Press', 'Hole Extrusion (Burring)', 'Tapping',
      'Deburring', 'PEM Insertion', 'Inspection',
    ]);
  });

  it('emits each operation exactly once — no double charging', () => {
    const seq = names(composeOperationSequence({
      coreCutting: [line('Laser Cutting')],
      coreForming: [line('Press Brake')],
      featureDriven,
    }));
    expect(new Set(seq).size).toBe(seq.length);
  });
});

// ── Tapping gate ─────────────────────────────────────────────────────────────
//
// The frontend once carried a second, looser definition of this operation:
// `tappingCandidateCount`, which counted holes of Ø<=6mm in sheet under 3mm and
// showed a Tapping step whenever that count was non-zero. A clearance hole is
// not a tapped hole, so a part with no threads at all displayed
// "Tapping / As Tapped / Potential tapping features" in the process tree while
// the quote it sat next to correctly contained no tapping and no tapping cost.
// The heuristic and both its consumers were removed on 2026-09-07; these pin the
// one gate that remains.
describe('Tapping is gated on real thread features, never hole size', () => {
  it('does not tap a small hole that has no thread callout', () => {
    // Ø2.0 in 1.5mm sheet: exactly what the old heuristic counted as a tap.
    const r = composeFeatureDrivenOperations(seccPart({ threads: [] }), CTX);
    expect([...names(r.preForm), ...names(r.postForm)]).not.toContain('Tapping');
  });

  it('taps when the drawing carries a real thread feature', () => {
    const r = composeFeatureDrivenOperations(
      seccPart({ threads: [{ size: 'M3', pitch: 0.5, count: 2 }] as never }),
      CTX,
    );
    expect(names(r.preForm)).toContain('Tapping');
  });

  it('does not tap small holes in thin sheet when no thread exists', () => {
    // The old heuristic's exact trigger conditions, held simultaneously:
    // thickness in (0,3) and every hole at or under Ø6.
    const r = composeFeatureDrivenOperations(
      seccPart({ threads: [], holeCount: 12, sheetThicknessMm: 1.5 } as never),
      CTX,
    );
    expect([...names(r.preForm), ...names(r.postForm)]).not.toContain('Tapping');
  });

  it('charges nothing for tapping when there are no threads', () => {
    // Absence of the line is not enough — a zero-thread part must also carry no
    // tapping cost anywhere in the composed sequence.
    const r = composeFeatureDrivenOperations(seccPart({ threads: [] }), CTX);
    const tapping = [...r.preForm, ...r.postForm].filter((l) => l.process === 'Tapping');
    expect(tapping).toHaveLength(0);
  });
});

// ── Blank-cutting scope: holes are cut with the profile, not as their own op ──
//
// The blank-generation processes (laser, punch, plasma, waterjet, shear, ...)
// pierce and cut every compatible through-hole in the same pass that cuts the
// outer profile — the engines are handed one cutLengthMm and one pierceCount and
// emit a single line. Nothing downstream may turn an ordinary through-hole into
// a second, separate hole-making operation; only a hole whose geometry is NOT
// producible that way (an extruded collar, a counterbore, a countersink, a
// reamed tolerance) earns an operation of its own.
describe('through-holes are produced by the blank-cutting operation', () => {
  it('creates no separate hole-making operation for plain through-holes', () => {
    // The reported part's four real holes, none of them a formed or finished
    // feature: no operation should exist for them at all.
    const r = composeFeatureDrivenOperations(seccPart({ holeCount: 4 }), CTX);
    const all = [...names(r.preForm), ...names(r.postForm)];
    for (const op of ['Drilling', 'Hole Making', 'Piercing', 'Punching', 'Hole Extrusion (Burring)']) {
      expect(all).not.toContain(op);
    }
  });

  it('scales no operation with hole count on its own', () => {
    const few = composeFeatureDrivenOperations(seccPart({ holeCount: 4 }), CTX);
    const many = composeFeatureDrivenOperations(seccPart({ holeCount: 400 }), CTX);
    expect(names(many.preForm)).toEqual(names(few.preForm));
    expect(names(many.postForm)).toEqual(names(few.postForm));
  });

  // The Ø8.00 BURLING BACK / CONVEX callout on the reported drawing. A formed
  // collar is NOT an ordinary through-hole: it needs its own real forming
  // operation, and it gets one from the real extruded-flange count, before the
  // part is bent.
  it('gives a detected extruded flange its own forming operation, ahead of forming', () => {
    const r = composeFeatureDrivenOperations(
      seccPart({ extrudedFlangeCount: 1, burringCycleTimeSecFromCalculator: 6, burringCalculatorId: 'b' }),
      CTX,
    );
    expect(names(r.preForm)).toContain('Hole Extrusion (Burring)');
    expect(names(r.postForm)).not.toContain('Hole Extrusion (Burring)');
    // Same hole population, one extra formed feature — the burl is what added
    // the operation, not the hole count.
    const without = composeFeatureDrivenOperations(seccPart({ extrudedFlangeCount: 0 }), CTX);
    expect(names(without.preForm)).not.toContain('Hole Extrusion (Burring)');
  });
});
