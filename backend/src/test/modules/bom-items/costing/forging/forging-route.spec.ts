import { buildForgingRoutes, chooseForgingRoute, ringOf, type ForgingPart, type ForgingRoute, type ForgingRouteInput, type ForgingRouteKey } from '../../../../../modules/bom-items/costing/forging/forging-route';
import { forgingCalculatorsByName, loadForgingCalculatorSpec } from '../../../../../modules/bom-items/costing/forging/calculators/forging-calculator-spec';
import { forgingOverridesOf, forgingPart } from '../../../../../modules/bom-items/costing/forging/forging-cost.service';
import { buildForgingCostSummary } from '../../../../../modules/bom-items/costing/forging/forging-cost-summary';
import { forgingRouteFor } from '../../../../../modules/bom-items/costing/forging/forging-route-comparison';
import { routeToolingItems } from '../../../../../modules/bom-items/costing/shared/route-tooling';
import { findRouteDataGaps } from '../../../../../modules/bom-items/costing/shared/core/engine-kernel';
import { allForgingMachines, forgingMaterial, realForgingReference } from './forging-test-data';

// The forging routes on the real memory/Forging data. The part: 150 cm³ of AISI 4140 (1.17 kg), 6,000 mm² in outline along the die direction
// with a 320 mm parting line, 40 mm deep, 100 x 70 mm in plan; in batches of 1,000, 50,000 over its life.
const ZERO = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
const BLOCK: ForgingPart = { volumeMm3: 150_000, projectedAreaMm2: 6_000, partingPerimeterMm: 320, dieDepthMm: 40, planLengthMm: 100, planWidthMm: 70, holes: [] };
// A ring 200 mm outside, 120 mm bore, 50 mm high, the bore along the die direction.
const RING: ForgingPart = {
  volumeMm3: (Math.PI / 4) * (200 ** 2 - 120 ** 2) * 50, projectedAreaMm2: (Math.PI / 4) * (200 ** 2 - 120 ** 2), partingPerimeterMm: Math.PI * 200,
  dieDepthMm: 50, planLengthMm: 200, planWidthMm: 200, holes: [{ diameterMm: 120, depthMm: 50, angleToDieDeg: 0, variant: 'through' }],
};
// 6 litres: a mult too thick for the induction coils.
const BIG: ForgingPart = { volumeMm3: 6_000_000, projectedAreaMm2: 60_000, partingPerimeterMm: 1_000, dieDepthMm: 120, planLengthMm: 300, planWidthMm: 200, holes: [] };

const input = (over: Partial<ForgingRouteInput> = {}): ForgingRouteInput => ({
  ref: realForgingReference(), spec: loadForgingCalculatorSpec(), calculators: forgingCalculatorsByName(),
  material: forgingMaterial('Steel, AISI 4140, Medium-Carbon'), part: BLOCK,
  machinesByClass: allForgingMachines(), toolShopMachiningUsdPerHr: 75,
  scenario: { batchSize: 1000, complexity: null, route: null, lifetimeVolume: 50_000 },
  costContext: ZERO, ...over,
});
const routesOf = (over: Partial<ForgingRouteInput> = {}) => buildForgingRoutes(input(over));
const routeOf = (key: ForgingRouteKey, over: Partial<ForgingRouteInput> = {}): ForgingRoute => {
  const { routes, gaps, missing } = routesOf(over);
  const r = routes.find((x) => x.key === key);
  if (!r) throw new Error(`no ${key}: ${[...missing, ...gaps.map((g) => `${g.key}: ${g.reason}`)].join('; ')}`);
  return r;
};
const complexity = (c: number) => ({ scenario: { ...input().scenario, complexity: c } });
const lineOf = (route: ForgingRoute, process: string) => route.lines.find((l) => l.process === process)!;
const processes = (route: ForgingRoute) => route.lines.map((l) => l.process);

describe('closed-die forging on a screw press: the metal', () => {
  const route = routeOf('closed_die_press');

  it('forges the part with the flash of its complexity and the scale of induction heating', () => {
    // Complexity 7 (min3DComplexityScore): 21 % flash -> 181,500 mm³ forged; 1 % scale -> 183,315 mm³ mult.
    expect(route.complexity).toBe(7);
    expect(route.heating).toBe('induction');
    expect(route.flash!.volumeMm3).toBeCloseTo(31_500, 0);
    expect(route.material.forgedKg).toBeCloseTo(181_500 * 1e-9 * 7830, 4);
  });

  it('saws the mult from the thinnest round bar that keeps it within the billet ratio', () => {
    const ratio = (d: number) => (4 * 183_315) / (Math.PI * d ** 3);
    expect(ratio(route.barDiameterMm)).toBeLessThanOrEqual(3.5);
    expect(route.multLengthMm).toBeCloseTo(183_315 / (Math.PI * route.barDiameterMm ** 2 / 4), 1);
  });

  it('buys whole mults from a standard bar, the end left over paid by the mults', () => {
    const area = Math.PI * route.barDiameterMm ** 2 / 4;
    const mults = Math.floor(6096 / (route.multLengthMm + 3.175));
    expect(route.material.boughtKg).toBeCloseTo(area * (6096 / mults) * 1e-9 * 7830, 3);
    expect(route.material.costUsd).toBeCloseTo(route.material.boughtKg * 0.968, 2);
  });

  it("sizes the flash land by the forged mass (Vieregge's rule with the data's coefficients)", () => {
    const m = route.material.forgedKg;
    const t = 1.13 + 0.89 * Math.sqrt(m) - 0.017 * m;
    expect(route.flash!.thicknessMm).toBeCloseTo(t, 2);
    expect(route.flash!.widthMm).toBeCloseTo(t * (3 + 1.25 * Math.exp(-1.09 * m)), 2);
  });
});

describe('closed-die forging on a screw press: the steps and dies', () => {
  const route = routeOf('closed_die_press');

  it('is complete, in process order, every step on a real machine', () => {
    expect(route.complete).toBe(true);
    expect(processes(route)).toEqual(['Band Saw', 'Conveyor Induction Heat', 'Press', 'Trim']);
    for (const l of route.lines) expect(l.machineName).toBeTruthy();
    expect(findRouteDataGaps(route.lines)).toEqual([]);
  });

  it('forges on the cheapest press that delivers the finishing blow', () => {
    // Flow stress 41.28 x 10^0.25 MPa over 6,000 + 320 x flash width mm², x 10 (complexity 7 is complex).
    const flow = 41.28 * 10 ** 0.25;
    expect(route.forming).toEqual({ quantity: 'force_kn', value: expect.closeTo((10 * flow * (6000 + 320 * route.flash!.widthMm)) / 1000, -1) });
    const rejected = lineOf(route, 'Press').machineChoice!.candidates.filter((c) => c.status === 'rejected');
    for (const r of rejected) expect(r.reasons.join(' ')).toMatch(/kN/);
  });

  it('a simpler part needs a smaller press and forges with less flash', () => {
    const simple = routeOf('closed_die_press', complexity(4));
    expect(simple.flash!.volumeMm3).toBeCloseTo(150_000 * 0.12, 0);
    expect(simple.forming.value).toBeLessThan(route.forming.value);
  });

  it('a part simple enough to forge without flash has no trim step', () => {
    const flashless = routeOf('closed_die_press', complexity(1));
    expect(processes(flashless)).toEqual(['Band Saw', 'Conveyor Induction Heat', 'Press']);
    expect(flashless.trimForceKn).toBeNull();
  });

  it('trims with the force to shear the flash along the parting line', () => {
    expect(route.trimForceKn).toBeCloseTo((491 * 320 * route.flash!.thicknessMm) / 1000, -1);
  });

  it('prices the finishing die within the range the data holds valid, the trim die at its least, over the tool life', () => {
    expect(route.tooling!.finishDieUsd).toBe(5000);
    expect(route.tooling!.trimDieUsd).toBe(500);
    expect(route.tooling!.dieSets).toBe(Math.ceil(50_000 / 7500));
    expect(route.tooling!.perPartUsd).toBeCloseTo((7 * 5500) / 50_000, 4);
    expect(route.warnings.join(' ')).toMatch(/outside the range the forging data holds valid/);
  });

  it('does not cost the dies without a lifetime volume or a tool shop rate, and says so', () => {
    expect(routeOf('closed_die_press', { scenario: { ...input().scenario, lifetimeVolume: null } }).tooling).toBeNull();
    expect(routeOf('closed_die_press', { toolShopMachiningUsdPerHr: null }).warnings.join(' ')).toMatch(/tool shop machining rate is not on file/);
  });
});

describe('the other closed-die routes', () => {
  it('a die hammer delivers the blow energy, on the smallest hammer that has it', () => {
    const route = routeOf('closed_die_hammer');
    expect(route.complete).toBe(true);
    expect(processes(route)).toEqual(['Band Saw', 'Conveyor Induction Heat', 'Hammer', 'Trim']);
    expect(route.forming.quantity).toBe('energy_j');
    const hammer = lineOf(route, 'Hammer').machineChoice!;
    for (const r of hammer.candidates.filter((c) => c.status === 'rejected')) expect(r.reasons.join(' ')).toMatch(/J|table/);
  });

  it("the hammer's blow energy counts the material once, through its own flow law: a softer metal needs less", () => {
    const energy = (grade: string) => routeOf('closed_die_hammer', { material: forgingMaterial(grade) }).forming.value;
    const steel = routeOf('closed_die_hammer');
    // The deformation work: flow stress at the hammer's strain rate (100 /s) x forged volume x ln(mult length / part depth).
    const flow = 41.28 * 100 ** 0.25;
    expect(steel.forming.value).toBeCloseTo((flow * (150_000 * 1.21) * Math.log(steel.multLengthMm / 40)) / 1000, -1);
    expect(energy('Aluminum, ANSI 1050A')).toBeLessThan(steel.forming.value);
    expect(energy('Inconel 718')).toBeGreaterThan(steel.forming.value);
  });

  it('a mechanical press strikes every station on each stroke, at its multi-station force', () => {
    const route = routeOf('closed_die_mechanical_press');
    expect(route.complete).toBe(true);
    expect(processes(route)).toEqual(['Band Saw', 'Conveyor Induction Heat', 'Mechanical Press', 'Trim']);
    expect(route.hits).toBe(3);
    // Same finishing blow as the screw press: the force reduction is on the machine's side.
    expect(route.forming.value).toBeCloseTo(routeOf('closed_die_press').forming.value, 2);
  });

  it('a blow larger than the biggest hammer is a named gap, not a guessed machine', () => {
    const hammer = routeOf('closed_die_hammer', { part: BIG });
    expect(hammer.complete).toBe(false);
    expect(hammer.totalUsd).toBeNull();
    expect((lineOf(hammer, 'Hammer').physicsGap as { reason: string }).reason).toMatch(/the blow needs \d+ J/);
  });
});

describe('heating the mult', () => {
  it('a mult too thick for the induction coils is heated in a gas furnace', () => {
    const route = routeOf('closed_die_mechanical_press', { part: BIG });
    expect(route.heating).toBe('furnace');
    expect(route.complete).toBe(true);
    expect(processes(route)).toEqual(['Band Saw', 'Preheat', 'Mechanical Press', 'Trim']);
    expect(lineOf(route, 'Preheat').machineName).toBeTruthy();
  });
});

describe('open-die forging', () => {
  it('upsets a flashless shape between flat dies, with the force of the press that does it', () => {
    const route = routeOf('open_die', complexity(2));
    expect(route.complete).toBe(true);
    expect(processes(route)).toEqual(['Band Saw', 'Conveyor Induction Heat', 'Open Die Press']);
    expect(route.forming.quantity).toBe('force_kn');
    expect(route.forming.value).toBeGreaterThan(0);
    expect(route.tooling).toBeNull();
  });

  it('is not a route for a shape with flash', () => {
    const { routes, gaps } = routesOf();
    expect(routes.some((r) => r.key === 'open_die')).toBe(false);
    expect(gaps.find((g) => g.key === 'open_die')!.reason).toMatch(/carries flash/);
  });
});

describe('ring rolling', () => {
  it('a part round in plan with a through bore along the die direction is a ring', () => {
    expect(ringOf(RING, 10)).toEqual({ outsideMm: 200, boreMm: 120, heightMm: 50 });
    expect(ringOf(BLOCK, 10)).toBeNull();
    expect(ringOf({ ...RING, holes: [{ ...RING.holes[0]!, angleToDieDeg: 90 }] }, 10)).toBeNull(); // a cross bore is drilled, not rolled
    expect(ringOf({ ...RING, holes: [{ ...RING.holes[0]!, variant: 'blind' }] }, 10)).toBeNull();
  });

  it('upsets, punches and pierces a preform, then rolls it out to the ring', () => {
    const route = routeOf('ring_rolling', { part: RING });
    expect(route.complete).toBe(true);
    expect(processes(route)).toEqual(['Band Saw', 'Conveyor Induction Heat', 'Open Die Press', 'Ring Rolling']);
    expect(route.forming.value).toBeGreaterThan(0);
    // The mult carries the pierced slug, so it is heavier than the ring.
    expect(route.material.forgedKg).toBeGreaterThan(route.material.netKg);
  });

  it('is not a route for a part that is not a ring', () => {
    expect(routesOf().gaps.find((g) => g.key === 'ring_rolling')!.reason).toMatch(/not a ring/);
  });
});

describe("the engineer's settings over the engine's (Cost Guide)", () => {
  const set = (overrides: NonNullable<ForgingRouteInput['scenario']['overrides']>) => ({ scenario: { ...input().scenario, overrides } });

  it('a bar set by the engineer is sawn into mults of its own length, and a bar outside the billet ratio is said so', () => {
    const auto = routeOf('closed_die_press');
    const route = routeOf('closed_die_press', set({ barDiameterMm: 80 }));
    expect(route.barDiameterMm).toBe(80);
    // An 80 mm mult is too short for an induction coil (inductionHeatMinMultRatio): it is furnace heated, with the furnace's larger scale loss.
    expect(route.heating).toBe('furnace');
    const multVolume = route.multLengthMm * (Math.PI * 80 ** 2 / 4);
    expect(multVolume).toBeGreaterThan(183_315);
    expect(multVolume).toBeLessThan(181_500 * 1.05);
    expect(route.multLengthMm).toBeLessThan(auto.multLengthMm);
    expect(route.warnings.join(' ')).toMatch(/The bar is 80 mm as set in the Cost Guide\./); // 0.46 diameters: within 0.3 to 3.5
    const stubby = routeOf('closed_die_press', set({ barDiameterMm: 120 }));
    expect(stubby.warnings.join(' ')).toMatch(/set in the Cost Guide: its mult is 0\.1\d diameters long, outside the billet ratio range 0\.3 to 3\.5/);
  });

  it('heating set to a gas furnace heats in the furnace, with its scale loss', () => {
    const route = routeOf('closed_die_press', set({ heating: 'furnace' }));
    expect(route.heating).toBe('furnace');
    expect(processes(route)).toContain('Preheat');
    expect(route.warnings.join(' ')).toMatch(/heated in a gas furnace, as set in the Cost Guide/);
  });

  it('a flash land set by the engineer drives the press force (its width) and the trim force (its thickness)', () => {
    const auto = routeOf('closed_die_press');
    const route = routeOf('closed_die_press', set({ flashThicknessMm: 3, flashWidthMm: 12 }));
    expect(route.flash).toMatchObject({ thicknessMm: 3, widthMm: 12 });
    const flow = 41.28 * 10 ** 0.25;
    expect(route.forming.value).toBeCloseTo((10 * flow * (6000 + 320 * 12)) / 1000, 0);
    expect(route.trimForceKn).toBeCloseTo((491 * 320 * 3) / 1000, 0);
    expect(route.forming.value).toBeGreaterThan(auto.forming.value);
  });

  it('blows set by the engineer are the screw press and hammer blows; the mechanical press keeps one per station', () => {
    expect(routeOf('closed_die_press', set({ hits: 5 })).hits).toBe(5);
    expect(routeOf('closed_die_hammer', set({ hits: 5 })).hits).toBe(5);
    expect(routeOf('closed_die_mechanical_press', set({ hits: 5 })).hits).toBe(3);
  });
});

describe('choosing the route to quote', () => {
  it('quotes the cheapest complete route and names what the others came to', () => {
    const { routes, gaps } = routesOf();
    const { route, note } = chooseForgingRoute(routes, gaps, null);
    const cheapest = Math.min(...routes.filter((r) => r.complete).map((r) => r.totalUsd!));
    expect(route!.totalUsd).toBe(cheapest);
    for (const r of routes.filter((x) => x !== route)) expect(note).toContain(r.label);
    for (const g of gaps) expect(note).toContain(`${g.label} not a route for this part`);
  });

  it("quotes the engineer's route when it was built", () => {
    const { routes, gaps } = routesOf();
    expect(chooseForgingRoute(routes, gaps, 'closed_die_press').route!.key).toBe('closed_die_press');
  });
});

describe('forging: what it refuses, the part and the summary', () => {
  it('reads only usable settings from the scenario', () => {
    expect(forgingOverridesOf({ forgingBarDiameterMm: 40, forgingHeating: 'furnace', forgingHits: 2, forgingFlashThicknessMm: 1.5, forgingFlashWidthMm: 6 }))
      .toEqual({ barDiameterMm: 40, heating: 'furnace', hits: 2, flashThicknessMm: 1.5, flashWidthMm: 6 });
    expect(forgingOverridesOf({ forgingBarDiameterMm: -1, forgingHeating: 'laser', forgingHits: 2.5, forgingFlashThicknessMm: '3' }))
      .toEqual({ barDiameterMm: null, heating: null, hits: null, flashThicknessMm: null, flashWidthMm: null });
  });

  it('names a missing density, and a part not measured as a forging', () => {
    expect(routesOf({ material: { ...forgingMaterial('Steel, AISI 4140, Medium-Carbon'), columns: {} } }).missing).toEqual(['Steel, AISI 4140, Medium-Carbon: density_kg_m3']);
    expect(forgingPart({ volumeMm3: 1000, projectedAreaMm2: null, partingPerimeterMm: 100, dieDepthMm: null, planLengthMm: null, planWidthMm: null, holes: [] }).missing.join(' ')).toMatch(/Refresh analysis/);
  });

  it('the summary carries the quoted route, every option, the dies as tooling, and the route to apply', () => {
    const { routes, gaps } = routesOf();
    const { route, note } = chooseForgingRoute(routes, gaps, 'closed_die_press');
    const s = buildForgingCostSummary({ forging: { route, routes, gaps, note, missing: [], warnings: [] }, materialGrade: 'Steel, AISI 4140, Medium-Carbon', materialCostPerKg: 99, materialSource: 'db', batchSize: 1000, warnings: [], ratesSource: 'test' });
    expect(s.family).toBe('forged');
    // The price per kg is the one the route charged for the bar (round_bar_unit_cost 0.968), not the material resolution's (99 here): the
    // material record is written from it and the charged mass, and gives the material cost.
    expect(s.materialCostPerKg).toBeCloseTo(0.968, 6);
    expect(s.materialCostPerKg * s.castingMetal!.chargedKg).toBeCloseTo(s.materialCost, 2);
    expect(s.materialCost).toBeCloseTo(route!.material.costUsd, 2);
    expect(s.castingMetal).toEqual({ partKg: route!.material.netKg, chargedKg: route!.material.boughtKg });
    expect(s.forging).toMatchObject({ route: 'closed_die_press', complexity: 7, complete: true });
    expect(s.forging!.options.map((o) => o.route).sort()).toEqual([...routes.map((r) => r.key), ...gaps.map((g) => g.key)].sort());
    expect(routeToolingItems(s).map((t) => t.key)).toEqual(['forging-dies']);
    expect(forgingRouteFor('closed_die_press', { ...s, currency: 'USD' } as never)).toMatchObject({ routeId: 'forging-closed_die_press', isFeasible: true, dataComplete: true });
    // A route the summary does not quote is not feasible from it, and says why.
    expect(forgingRouteFor('ring_rolling', { ...s, currency: 'USD' } as never)).toMatchObject({ isFeasible: false });
  });

  it('a part that cannot be forged is one named, uncosted line and no route is feasible', () => {
    const s = buildForgingCostSummary({ forging: { route: null, routes: [], gaps: [], note: null, missing: ['"ABS" is not a forging material'], warnings: [] }, materialGrade: 'ABS', materialCostPerKg: 0, materialSource: 'db', batchSize: 1, warnings: [], ratesSource: 'test' });
    expect(s.processLines).toHaveLength(1);
    expect((s.processLines[0]!.physicsGap as { reason: string }).reason).toBe('Forging cannot be costed: "ABS" is not a forging material');
    expect(forgingRouteFor('closed_die_press', { ...s, currency: 'USD' } as never).isFeasible).toBe(false);
  });
});
