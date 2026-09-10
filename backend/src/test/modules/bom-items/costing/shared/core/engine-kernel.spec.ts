import {
  shouldAddSeparatePressBrakeLine,
  rollBendingGeometryCapability,
  rolledFormNeedsRollBender,
  routeProducesBlank,
  resolveSetupMinutes,
  decideBenchmarkOverride,
  findRouteDataGaps,
  isRouteDataComplete,
  selectRecommendedRoute,
  type RankableRoute,
  type RouteDataGapLine,
} from '../../../../../../modules/bom-items/costing/shared/core/engine-kernel';

// Root-caused 2026-09-04: getRouteComparison() used to append a separate
// real Press Brake process line to EVERY route with real bends, including
// the 6 forming-family routes (Standard Press/Tandem Press/Progressive Die
// Press/Roll Bending 2/3/4) whose own real registered catalog taxonomy
// (process_calculator_mappings — verified directly against
// memory/sheetmetal/process/process_operations.json: "Std Press:Std
// Press//StraightBend", "Tandem Press:Bending//StraightBend", "Progressive
// Die:Die Station:Bending//StraightBend", "2/3/4 Roll Bending:...//
// StraightBend") confirms they perform bending as part of their own
// process — double-charging the same bend once via the press/roll's own
// real process line, again via a separate Press Brake operation.
describe('shouldAddSeparatePressBrakeLine', () => {
  it('adds a separate Press Brake line for cutting routes — none of those machines can bend', () => {
    expect(shouldAddSeparatePressBrakeLine('cutting')).toBe(true);
  });

  it('does NOT add a separate Press Brake line for forming routes — their own real catalog taxonomy already covers bending', () => {
    expect(shouldAddSeparatePressBrakeLine('forming')).toBe(false);
  });
});

// ── resolveSetupMinutes ───────────────────────────────────────────────────────
// Locks the real-data specificity ordering. Before this existed, the sheet-metal
// engines only ever read tiers 2 and 3, so two machines of the same class with
// genuinely different real setup times produced byte-identical setup cost.
describe('resolveSetupMinutes', () => {
  it('prefers a real calculator result over the machine, because only it knows the part', () => {
    // The Sheet Metal Bending calculator computes tool loading time from THIS
    // part's bends; the machine figure is generic to the machine.
    const r = resolveSetupMinutes({
      process: 'Press Brake',
      calculatorSetupMin: 22,
      machineSetupTimeHr: 0.75,   // 45 min — real, but not part-specific
      operationSetupMin: 20,
      classDefaultMin: 20,
    });
    expect(r.setupMin).toBe(22);
    expect(r.source).toBe('calculator');
    expect(r.warning).toBeUndefined();
  });

  it('falls through to the machine when the calculator produced no setup time', () => {
    for (const v of [null, undefined, 0, Number.NaN]) {
      const r = resolveSetupMinutes({
        process: 'Press Brake', calculatorSetupMin: v as number | null,
        machineSetupTimeHr: 0.75, classDefaultMin: 20,
      });
      expect(r.setupMin).toBeCloseTo(45, 6);
      expect(r.source).toBe('machine');
    }
  });

  it('prefers the selected machine own setup_time_hr over every less specific source', () => {
    const r = resolveSetupMinutes({
      process: 'Laser Cutting',
      machineSetupTimeHr: 0.08,   // the real value staged for a fiber laser
      operationSetupMin: 12,
      classDefaultMin: 15,
      machineName: 'NTC TLM-404 3300',
    });
    expect(r.setupMin).toBeCloseTo(4.8, 6);
    expect(r.source).toBe('machine');
    expect(r.warning).toBeUndefined();
  });

  it('lets two machines of one class carry genuinely different setup times', () => {
    const a = resolveSetupMinutes({ process: 'Press', machineSetupTimeHr: 0.47, classDefaultMin: 30 });
    const b = resolveSetupMinutes({ process: 'Press', machineSetupTimeHr: 0.72, classDefaultMin: 30 });
    expect(a.setupMin).toBeCloseTo(28.2, 6);
    expect(b.setupMin).toBeCloseTo(43.2, 6);
    expect(a.setupMin).not.toBeCloseTo(b.setupMin, 6);
  });

  it('falls to the real per-operation lookup when the machine has none, and does not warn', () => {
    // A per-operation row is real sourced data, not a gap — warning here would
    // fire on nearly every line and drown the genuine class-default gaps.
    const r = resolveSetupMinutes({
      process: 'Router Cutting', machineSetupTimeHr: null, operationSetupMin: 45, classDefaultMin: 30,
    });
    expect(r.setupMin).toBe(45);
    expect(r.source).toBe('operation_lookup');
    expect(r.warning).toBeUndefined();
  });

  it('falls to the class default and discloses it when neither real source resolved', () => {
    const r = resolveSetupMinutes({
      process: 'Plasma Cut', machineSetupTimeHr: null, operationSetupMin: null,
      classDefaultMin: 4.8, machineName: 'CSI Series 4 - 200A',
    });
    expect(r.setupMin).toBe(4.8);
    expect(r.source).toBe('class_default');
    expect(r.warning).toContain('setup time from fallback');
    expect(r.warning).toContain('CSI Series 4 - 200A');
  });

  it('treats a zero or negative machine setup time as "never populated", not "instant"', () => {
    // Every staged machine has a positive setup time, so 0 means the column was
    // never filled — accepting it would silently zero out real setup cost.
    for (const v of [0, -1]) {
      const r = resolveSetupMinutes({
        process: 'Turret Punching', machineSetupTimeHr: v, operationSetupMin: 20, classDefaultMin: 30,
      });
      expect(r.setupMin).toBe(20);
      expect(r.source).toBe('operation_lookup');
    }
  });

  it('ignores a non-finite machine value rather than propagating NaN into setup cost', () => {
    const r = resolveSetupMinutes({
      process: 'Waterjet Cutting', machineSetupTimeHr: Number.NaN, operationSetupMin: null, classDefaultMin: 4.8,
    });
    expect(r.setupMin).toBe(4.8);
    expect(r.source).toBe('class_default');
  });
});

// ── decideBenchmarkOverride ───────────────────────────────────────────────────
// This decision silently replaces the machine rate a quote is billed at, and
// had no test before 2026-09-05. Numbers below are real values from this
// deployment, not invented ones.
describe('decideBenchmarkOverride', () => {
  const thresholds = { lowFraction: 0.5, highFraction: 3.0 };

  it('keeps a rate that equals the record own Direct + Indirect overhead', () => {
    // The reported defect: "11010 (Heller-hydraulic)" real MHR 19.83/hr
    // (direct 4.25 + indirect 15.58) was replaced by the generic 74/hr class
    // benchmark, inflating every bend line costed on it by 3.7x.
    const d = decideBenchmarkOverride({
      rate: 19.83, isDbRate: true, benchmark: 74,
      directOverheadRate: 4.25, indirectOverheadRate: 15.58, thresholds,
    });
    expect(d.override).toBe(false);
  });

  it('keeps the canonical rate for every class whose benchmark is a generic average', () => {
    for (const [rate, doh, ioh, benchmark] of [
      [19.83, 4.25, 15.58, 74],   // press_brake
      [30.38, 14.80, 15.58, 84],  // turret_punch
      [38.09, 22.51, 15.58, 78],  // waterjet
    ] as const) {
      expect(decideBenchmarkOverride({
        rate, isDbRate: true, benchmark,
        directOverheadRate: doh, indirectOverheadRate: ioh, thresholds,
      }).override).toBe(false);
    }
  });

  it('still overrides a currency mis-scale, which cannot equal the overhead sum', () => {
    // An INR figure read as USD is ~83x out — the error this guard exists for.
    const d = decideBenchmarkOverride({
      rate: 1656, isDbRate: true, benchmark: 74,
      directOverheadRate: 4.25, indirectOverheadRate: 15.58, thresholds,
    });
    expect(d.override).toBe(true);
    expect(d).toHaveProperty('reason');
  });

  it('still overrides a suspiciously low rate on a row with no overhead breakdown', () => {
    // The 13 pre-2026-07-13 seed rows have no Direct/Indirect captured, so they
    // keep facing both ratio arms exactly as before.
    const d = decideBenchmarkOverride({
      rate: 9, isDbRate: true, benchmark: 74,
      directOverheadRate: null, indirectOverheadRate: null, thresholds,
    });
    expect(d.override).toBe(true);
  });

  it('does not treat a zero overhead breakdown as a real canonical sum', () => {
    // 0 + 0 means "never captured", not "this machine is free to run".
    const d = decideBenchmarkOverride({
      rate: 0.5, isDbRate: true, benchmark: 74,
      directOverheadRate: 0, indirectOverheadRate: 0, thresholds,
    });
    expect(d.override).toBe(true);
  });

  it('uses the configured bands, not hardcoded 50%/300%', () => {
    // Previously the guard ignored costing_settings entirely, so deploying
    // migration 473 changed the warnings but never the rate actually billed.
    const rate = 20, benchmark = 74;
    expect(decideBenchmarkOverride({
      rate, isDbRate: true, benchmark, thresholds: { lowFraction: 0.5, highFraction: 3 },
    }).override).toBe(true);
    expect(decideBenchmarkOverride({
      rate, isDbRate: true, benchmark, thresholds: { lowFraction: 0.1, highFraction: 10 },
    }).override).toBe(false);
  });

  it('never overrides a rate that did not come from a real machine record', () => {
    expect(decideBenchmarkOverride({
      rate: 1, isDbRate: false, benchmark: 74, thresholds,
    }).override).toBe(false);
  });

  it('never overrides when no benchmark is on file for the class', () => {
    expect(decideBenchmarkOverride({
      rate: 1, isDbRate: true, benchmark: 0, thresholds,
    }).override).toBe(false);
  });

  it('tolerates sub-cent rounding between the stored overheads and the resolved rate', () => {
    expect(decideBenchmarkOverride({
      rate: 19.831, isDbRate: true, benchmark: 74,
      directOverheadRate: 4.25, indirectOverheadRate: 15.58, thresholds,
    }).override).toBe(false);
  });
});

// ── findRouteDataGaps ─────────────────────────────────────────────────────────
// A route can be physically capable and still uncostable, because the reference
// data one of its operations needs is not on file. The engines correctly refuse
// to invent a number and emit a $0 line plus a warning — but a $0 operation made
// those routes the CHEAPEST in the comparison, so absent data read as an
// economic advantage (confirmed live: Tandem Press $0.68 and 2-Axis Router $0.80
// both ranked ahead of every fully-costed route).
describe('findRouteDataGaps', () => {
  const line = (over: Partial<RouteDataGapLine> = {}): RouteDataGapLine => ({
    process: 'Laser Cutting', machineClass: 'fiber_laser', cycleTimeMin: 0.02,
    // A real resolved setup, so these cases stay about CYCLE time. The absent
    // case is covered on its own below.
    setupTimeMin: 30, ...over,
  });

  it('reports nothing for a fully costed route', () => {
    expect(findRouteDataGaps([
      line(),
      line({ process: 'Press Brake', machineClass: 'press_brake', cycleTimeMin: 0.166 }),
      line({ process: 'Deburring', machineClass: 'deburring', cycleTimeMin: 0.327 }),
    ])).toEqual([]);
    expect(isRouteDataComplete([line()])).toBe(true);
  });

  it('flags the real Tandem Press case — no press_cycle_time_s on file', () => {
    const gaps = findRouteDataGaps([
      line({ process: 'Tandem Press', machineClass: 'tandem_press', cycleTimeMin: 0 }),
      line({ process: 'Deburring', machineClass: 'deburring', cycleTimeMin: 0.327 }),
    ]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.process).toBe('Tandem Press');
    expect(gaps[0]!.machineClass).toBe('tandem_press');
    // Says what is actually wrong. A cycle of 0 means nothing resolved a cycle
    // time -- not that the operation is too fast to store.
    expect(gaps[0]!.reason).toContain('no cycle time was resolved');
  });

  it('treats only an unresolved cycle time as a gap, not a genuinely fast one', () => {
    // This used to assert a one-second floor, on the stated grounds that
    // process_cost_records.cycle_time enforced one. It does not: migration 034
    // declared that CHECK but it never applied, and the live column holds a real
    // 0.6 s row today (verified directly against the live table, 507 non-null
    // rows). The false floor was a real costing bug, not just a test artifact --
    // it marked Progressive Die (0.36 s/part) and 3 Roll Bending (0.6 s/part)
    // dataComplete=false, excluding both from selectRecommendedRoute and pinning
    // the recommendation to Standard Press no matter what the scenario said.
    //
    // The real floor is the column scale: a cycle that still rounds to 0.00 s at
    // 2 dp is one that nothing resolved.
    expect(findRouteDataGaps([line({ cycleTimeMin: 1 / 60 })])).toEqual([]);
    expect(findRouteDataGaps([line({ cycleTimeMin: 0.6 / 60 })])).toEqual([]);
    expect(findRouteDataGaps([line({ cycleTimeMin: 0.36 / 60 })])).toEqual([]);
    expect(findRouteDataGaps([line({ cycleTimeMin: 0.01 / 60 })])).toEqual([]);
    // Rounds to 0.00 s at the column scale -> nothing was resolved.
    expect(findRouteDataGaps([line({ cycleTimeMin: 0.004 / 60 })])).toHaveLength(1);
    expect(findRouteDataGaps([line({ cycleTimeMin: 0 })])).toHaveLength(1);
  });

  it('reports a structured missing-lookup gap by its own required action', () => {
    const gaps = findRouteDataGaps([line({
      process: '2 Axis Router',
      machineClass: 'router_2axis',
      cycleTimeMin: 0,
      physicsGap: { gapType: 'missing_lookup', requiredAction: 'Add a real row to sm_lookup_router_cut.' },
    })]);
    expect(gaps[0]!.reason).toBe('Add a real row to sm_lookup_router_cut.');
  });

  it('reports an unsupported operation by its own reason', () => {
    const gaps = findRouteDataGaps([line({
      cycleTimeMin: 5,
      physicsGap: { gapType: 'unsupported_operation', reason: 'no bevel capability on this class' },
    })]);
    expect(gaps[0]!.reason).toBe('no bevel capability on this class');
  });

  it('treats an explicit null gap as no gap', () => {
    // Producers differ: some omit physicsGap, some set it to null.
    expect(findRouteDataGaps([line({ physicsGap: null })])).toEqual([]);
  });

  it('lists every incomplete operation, in line order', () => {
    const gaps = findRouteDataGaps([
      line({ process: 'A', cycleTimeMin: 0 }),
      line({ process: 'B', cycleTimeMin: 1 }),
      line({ process: 'C', cycleTimeMin: 0 }),
    ]);
    expect(gaps.map((g) => g.process)).toEqual(['A', 'C']);
  });
});

// ── selectRecommendedRoute ────────────────────────────────────────────────────
describe('selectRecommendedRoute', () => {
  const route = (
    routeId: string,
    totalCost: number | null,
    over: Partial<RankableRoute> = {},
  ): RankableRoute => ({
    routeId, totalCost,
    cycleTimes: { totalMin: 10 },
    capability: { overallCapable: true },
    dataComplete: true,
    isFeasible: true,
    ...over,
  });

  it('recommends the cheapest capable, fully-costed route', () => {
    expect(selectRecommendedRoute([
      route('sm-laser', 0.87), route('sm-standard-press', 0.73), route('sm-turret', 0.95),
    ])?.routeId).toBe('sm-standard-press');
  });

  it('will not recommend a route whose price is an artefact of missing data', () => {
    // The reported case: Tandem Press was $0.68 only because its own operation
    // had no cycle-time data on file and therefore cost nothing.
    expect(selectRecommendedRoute([
      route('sm-tandem-press', 0.68, { dataComplete: false }),
      route('sm-standard-press', 0.73),
      route('sm-laser', 0.87),
    ])?.routeId).toBe('sm-standard-press');
  });

  it('will not recommend a route the machine cannot physically produce', () => {
    expect(selectRecommendedRoute([
      route('sm-shear', 0.50, { capability: { overallCapable: false } }),
      route('sm-laser', 0.87),
    ])?.routeId).toBe('sm-laser');
  });

  it('returns null rather than choosing when nothing qualifies', () => {
    expect(selectRecommendedRoute([
      route('a', 0.5, { dataComplete: false }),
      route('b', 0.6, { capability: { overallCapable: false } }),
      route('c', null),
    ])).toBeNull();
    expect(selectRecommendedRoute([])).toBeNull();
  });

  it('is deterministic on ties — cycle time, then route id', () => {
    const byTime = selectRecommendedRoute([
      route('sm-b', 0.80, { cycleTimes: { totalMin: 12 } }),
      route('sm-a', 0.80, { cycleTimes: { totalMin: 9 } }),
    ]);
    expect(byTime?.routeId).toBe('sm-a');

    const byId = selectRecommendedRoute([route('sm-z', 0.80), route('sm-a', 0.80)]);
    expect(byId?.routeId).toBe('sm-a');
    // Same inputs in the other order must give the same answer.
    expect(selectRecommendedRoute([route('sm-a', 0.80), route('sm-z', 0.80)])?.routeId).toBe('sm-a');
  });

  it('carries no per-process preference — the cheapest eligible route wins whatever it is', () => {
    for (const winner of ['sm-turret', 'sm-progressive-die', 'sm-waterjet', 'sm-laser']) {
      const routes = ['sm-turret', 'sm-progressive-die', 'sm-waterjet', 'sm-laser']
        .map((id) => route(id, id === winner ? 0.10 : 0.90));
      expect(selectRecommendedRoute(routes)?.routeId).toBe(winner);
    }
  });

  // THE REPORTED REGRESSION (830-001720-00, SECC 1.5mm, four discrete R0.8
  // bends). rollBendingGeometryCapability already marked the roll route
  // isFeasible:false — but this filter only ever read capability.overallCapable,
  // which that gate deliberately does not touch, so '3 Roll Bending' was still
  // returned as recommendedRouteId and the process tree was built from it.
  it('will not recommend a route the route-level feasibility check rejected', () => {
    expect(selectRecommendedRoute([
      route('sm-roll-bending-3', 0.31, { isFeasible: false }),
      route('sm-laser', 0.87),
    ])?.routeId).toBe('sm-laser');
  });

  // A forming route omits blanking entirely, so it competes in the same
  // minimum at a structurally smaller scope of work and wins on price for a
  // reason that is not economic. Only a route that actually produces the blank
  // can be recommended as the whole route for the part.
  it('will not recommend a route that never produces the blank', () => {
    expect(selectRecommendedRoute([
      route('sm-roll-bending-3', 0.31, { producesBlank: false }),
      route('sm-laser', 0.87),
    ])?.routeId).toBe('sm-laser');
  });

  it('treats an unset producesBlank as no evidence against the route', () => {
    // CNC and injection-molding routes share this ranking and have no
    // sheet-metal blanking concept at all.
    expect(selectRecommendedRoute([route('cnc-3ax', 4.20)])?.routeId).toBe('cnc-3ax');
  });
});

// A roll bender had NO capability check at all: its engine takes
// flatPatternLengthMm as the roll feed length, and every sheet part has one, so
// it always produced a plausible cycle time and always ranked as a candidate.
// That is how "3 Roll Bending" became the applied route for a bracket whose
// formed geometry is four discrete R0.8 creases.
describe('rollBendingGeometryCapability', () => {
  it('rejects a roll bender for a part with discrete bends, naming the real reason', () => {
    const r = rollBendingGeometryCapability('roll_bending_3', 4);
    expect(r.capable).toBe(false);
    if (!r.capable) {
      expect(r.reason).toContain('4 discrete bends');
      expect(r.reason).toContain('press-brake');
    }
  });

  it('rejects every roll-bending class, not just the 3-roll one', () => {
    for (const cls of ['roll_bending_2', 'roll_bending_3', 'roll_bending_4']) {
      expect(rollBendingGeometryCapability(cls, 1).capable).toBe(false);
    }
  });

  it('singularises the reason for a single bend', () => {
    const r = rollBendingGeometryCapability('roll_bending_2', 1);
    expect(r.capable).toBe(false);
    if (!r.capable) expect(r.reason).toContain('1 discrete bend ');
  });

  // Deliberately silent, not positive: no curvature signal reaches the backend,
  // so a part with no discrete bends is left genuinely selectable rather than
  // being guessed either way.
  it('stays capable when the part has no discrete bends', () => {
    expect(rollBendingGeometryCapability('roll_bending_3', 0).capable).toBe(true);
  });

  it('never constrains a class that does not form by rolling', () => {
    for (const cls of ['press_brake', 'fiber_laser', 'progressive_die_press', 'standard_press']) {
      expect(rollBendingGeometryCapability(cls, 4).capable).toBe(true);
    }
  });
});

// ── routeProducesBlank ────────────────────────────────────────────────────────
// Sourced from the real catalog taxonomy, not a hand-kept list: every process
// that can generate the blank has a `//Blank` operation on file
// (process_taxonomy_operations.feature_type, migration 609, seeded from
// memory/sheetmetal/process/process_operations.json — "Fiber Laser
// Cut:...//Blank", "Std Press:Std Press//Blank", "Tandem Press:Blanking//Blank",
// "Progressive Die:Die Station:Blanking//Blank", "Shear:...//Blank", ...).
// 2/3/4 Roll Bending have NO such row — their only operations are
// StraightBend / Form / As Formed//CurvedSurface / As Formed//CurvedWall /
// Coil Uncoil. A roll bender consumes a blank someone else produced.
describe('routeProducesBlank', () => {
  const blankCapable = new Set([
    'fiber_laser', 'co2_laser', 'laser_punch', 'turret_punch', 'waterjet',
    'plasma_cut', 'plasma_punch', 'oxyfuel_cut', 'shear', 'router_2axis',
    'standard_press', 'tandem_press', 'progressive_die_press',
  ]);

  it('confirms every cutting class that really has a //Blank operation on file', () => {
    for (const cls of ['fiber_laser', 'turret_punch', 'waterjet', 'shear', 'plasma_cut', 'oxyfuel_cut']) {
      expect(routeProducesBlank(cls, blankCapable)).toBe(true);
    }
  });

  it('confirms the press family blanks in-die — its own taxonomy says so', () => {
    for (const cls of ['standard_press', 'tandem_press', 'progressive_die_press']) {
      expect(routeProducesBlank(cls, blankCapable)).toBe(true);
    }
  });

  it('reports that a roll bender produces no blank', () => {
    for (const cls of ['roll_bending_2', 'roll_bending_3', 'roll_bending_4']) {
      expect(routeProducesBlank(cls, blankCapable)).toBe(false);
    }
  });

  // Fail-open, disclosed by the caller: when the taxonomy could not be read
  // there is no evidence a process cannot blank, and treating every route as
  // blank-less would leave the comparison with no recommendation at all.
  it('assumes nothing when the taxonomy is unavailable', () => {
    expect(routeProducesBlank('roll_bending_3', null)).toBe(true);
    expect(routeProducesBlank('fiber_laser', null)).toBe(true);
  });
});

// ── Positive rolled-geometry evidence (CAD Phase 2, 2026-09-09) ──────────────
//
// Until rolled_form_count existed, this gate could only ever say "these are
// discrete bends, so not rollable". It could not say "this IS rolled", because
// no curvature signal reached the backend at all — a genuinely rolled part
// reported bend_count 0 and looked exactly like a flat blank.
//
// cad-engine/sheet_metal/features/rolled_form.py now supplies confident
// detections only: a single cylindrical face sweeping past the 180 degrees a
// press brake can form in one hit. Ambiguous candidates are excluded upstream
// and never reach this count.
describe('rollBendingGeometryCapability — with real rolled-form evidence', () => {
  it('keeps a roll bender capable for a rolled part that also has a discrete bend', () => {
    // A rolled shell with a flanged edge is an ordinary combination; the bend
    // alone must no longer disqualify the roll bender.
    expect(rollBendingGeometryCapability('roll_bending_3', 2, 1).capable).toBe(true);
  });

  it('still rejects a roll bender when the part has bends and no rolled form', () => {
    // The reported regression part: four discrete R0.8 creases, no curvature.
    const r = rollBendingGeometryCapability('roll_bending_3', 4, 0);
    expect(r.capable).toBe(false);
    if (!r.capable) expect(r.reason).toContain('no rolled form was detected');
  });

  it('defaults to the pre-signal behaviour when no count is supplied', () => {
    expect(rollBendingGeometryCapability('roll_bending_3', 4).capable).toBe(false);
    expect(rollBendingGeometryCapability('roll_bending_3', 0).capable).toBe(true);
  });
});

describe('rolledFormNeedsRollBender — the mirror of that gate', () => {
  it('warns that a cutting route cannot press-brake a detected rolled form', () => {
    const w = rolledFormNeedsRollBender('cutting', 'fiber_laser', 1);
    expect(w).toContain('1 continuous rolled form');
    expect(w).toContain('press brake cannot produce that curvature');
  });

  it('says nothing when no rolled form was detected', () => {
    expect(rolledFormNeedsRollBender('cutting', 'fiber_laser', 0)).toBeNull();
  });

  it('says nothing on the roll benders that can actually produce it', () => {
    for (const cls of ['roll_bending_2', 'roll_bending_3', 'roll_bending_4']) {
      expect(rolledFormNeedsRollBender('forming', cls, 2)).toBeNull();
    }
  });

  // A press route already bends in-process and gets no separate Press Brake
  // line, so the warning would be describing an operation the route never had.
  it('says nothing on a forming route', () => {
    expect(rolledFormNeedsRollBender('forming', 'standard_press', 2)).toBeNull();
  });

  it('pluralises honestly', () => {
    expect(rolledFormNeedsRollBender('cutting', 'waterjet', 3)).toContain('3 continuous rolled forms');
  });
});
