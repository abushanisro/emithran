import { buildInvestmentRoute, type InvestmentRouteInput } from '../../../../../modules/bom-items/costing/casting/investment/investment-route';
import { investmentCastingCalculatorsByName, loadInvestmentCastingCalculatorSpec } from '../../../../../modules/bom-items/costing/casting/investment/calculators/investment-casting-calculator-spec';
import { alloyPrice, investmentPart } from '../../../../../modules/bom-items/costing/casting/investment/investment-cost.service';
import { INVESTMENT_CLASS } from '../../../../../modules/bom-items/costing/casting/investment/investment-reference';
import { investmentCastingRoute } from '../../../../../modules/bom-items/costing/casting/investment/investment-route-comparison';
import { buildCastingCostSummary } from '../../../../../modules/bom-items/costing/casting/casting-cost-summary';
import { findRouteDataGaps } from '../../../../../modules/bom-items/costing/shared/core/engine-kernel';
import { routeToolingItems } from '../../../../../modules/bom-items/costing/shared/route-tooling';
import { allInvestmentMachines, investmentMaterial, realInvestmentReference } from './investment-test-data';

// The investment casting route on the real memory/Casting Investment data. The part: a 120 x 80 x 40 mm, 60 cm³, 300 cm² stainless 304 casting
// with a 4 mm wall, in batches of 500, 50,000 over its life.
const ZERO = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
const input = (over: Partial<InvestmentRouteInput> = {}): InvestmentRouteInput => ({
  ref: realInvestmentReference(), spec: loadInvestmentCastingCalculatorSpec(), calculators: investmentCastingCalculatorsByName(),
  material: investmentMaterial('Stainless Steel, AISI 304'), priceSource: 'cost_usa (USA price)',
  part: { volumeMm3: 60_000, surfaceAreaMm2: 30_000, dimsMm: [120, 80, 40], wallMm: 4, slides: 0 },
  machinesByClass: allInvestmentMachines(),
  scenario: { batchSize: 500, cavities: null, energyPricePerKwh: 0.1, energyPriceSource: 'test price', lifetimeVolume: 50_000 },
  costContext: ZERO, ...over,
});
const build = (over: Partial<InvestmentRouteInput> = {}) => buildInvestmentRoute(input(over));
const routeOf = (over: Partial<InvestmentRouteInput> = {}) => {
  const { route, missing } = build(over);
  if (!route) throw new Error(`no route: ${missing.join('; ')}`);
  return route;
};
const lineOf = (route: ReturnType<typeof routeOf>, process: string) => route.lines.find((l) => l.process === process)!;

describe('investment casting route: the tree every shared step is divided over', () => {
  it('stacks the layers the plant can take: the knockout machine (609.6 mm) is lower than the tree limit (800 mm)', () => {
    // Layer pitch 80 + 12.7 (small part spacing) = 92.7 mm; (609.6 - 38.1 runner + 12.7) / 92.7 = 6.3 -> 6 layers of 4 = 24 patterns.
    const { tree } = routeOf();
    expect(tree).toMatchObject({ layers: 6, patternsPerTree: 24, treesInBatch: 21, primaryDips: 3, backupDips: 3, gatesPerPattern: 1 });
    expect(tree.heightMm).toBeCloseTo(6 * 92.7 - 12.7 + 38.1, 2); // 581.6
    expect(tree.widthMm).toBeCloseTo(25.4 + 2 * (25.4 + 40), 2); // runner + 2 x (gate + pattern), 156.2
  });

  it('never has more patterns than the batch, so a small batch carries its whole tree', () => {
    const small = routeOf({ scenario: { ...input().scenario, batchSize: 5 } });
    expect(small.tree).toMatchObject({ patternsPerTree: 5, treesInBatch: 1 });
    expect(lineOf(small, 'Mold Burnout').totalCost).toBeGreaterThan(lineOf(routeOf(), 'Mold Burnout').totalCost * 4);
  });

  it('gives a heavier part more gates, backup dips and a lower share of gating metal', () => {
    // 2,000 cm³ of 304 is 16.1 kg: large for gates (8 per pattern, 70% gating efficiency), medium for dips (6 backup).
    const heavy = routeOf({ part: { volumeMm3: 2_000_000, surfaceAreaMm2: 150_000, dimsMm: [250, 200, 100], wallMm: 12, slides: 0 } });
    expect(heavy.tree).toMatchObject({ gatesPerPattern: 8, backupDips: 6 });
    expect(heavy.material.yieldPct).toBe(70);
  });
});

describe('investment casting route: its lines', () => {
  const route = routeOf();

  it('is complete, in process order, every step on a real machine', () => {
    expect(route.complete).toBe(true);
    expect(route.lines.map((l) => l.process)).toEqual([
      'Wax Pattern Molding', 'Pattern Finishing', 'Tree Assembly', 'Primary Slurry Dipping', 'Primary Sand Coating', 'Secondary Slurry Dipping',
      'Secondary Sand Coating', 'Robotic Assist', 'Flash Fire De-Waxing', 'Wax Vent Plugging', 'Mold Cleaning', 'Shell Inspection', 'Mold Burnout',
      'Mold Preheating', 'Metal Pouring', 'Cooling', 'Knockout', 'Band Saw', 'Belt Sand', 'Finishing', 'Dimensional Inspection',
    ]);
    for (const l of route.lines) {
      expect(l.physicsGap).toBeUndefined();
      expect(l.machineName).toBeTruthy();
      expect(l.processGroup).toBe('Casting Investment');
    }
  });

  it('wax pattern: fill, plate cooling of the wall, open and close, unload', () => {
    // Fill 60,000 / 245,000 mm³/s = 0.245 s. Diffusivity 0.33 / (885 x 2300) = 1.6212e-7 m²/s; cooling 0.004² / (pi² x 1.6212e-7) x ln(4/pi x 57 / 10)
    // = 10.000 x 1.9821 = 19.82 s. Stroke 40 x 1.25 = 50 mm at 40 mm/s each way = 2.5 s. Unload 1 s (a 53 g pattern). Shot 23.57 s, one cavity.
    const wax = lineOf(route, 'Wax Pattern Molding');
    expect(wax.machineName).toBe('Wax Injection 15 Ton');
    expect(wax.cycleTimeMin * 60).toBeCloseTo(0.245 + 19.82 + 2.5 + 1, 0);
  });

  it('a pattern thicker than the chill threshold is molded around a chill', () => {
    const thick = routeOf({ part: { ...input().part, wallMm: 20 } });
    // Cooling through 8 mm: 0.008² / (pi² x 1.6212e-7) x 1.9821 = 79.3 s, plus the 10 s chill load.
    expect(lineOf(thick, 'Wax Pattern Molding').cycleTimeMin * 60).toBeCloseTo(0.245 + 79.28 + 2.5 + 10 + 1, 0);
    expect(thick.warnings.join(' ')).toMatch(/molded around a chill/);
  });

  it('a step shared by the tree is divided by its patterns: three robotic primary dips of 100 s over 24 patterns', () => {
    expect(lineOf(route, 'Primary Slurry Dipping').cycleTimeMin * 60).toBeCloseTo((3 * 100) / 24, 1);
    // Burnout of a 6-dip shell soaks 4 h; the bed takes 0.85 x 1524 x 1219.2 / 156.2² = 64 trees, the batch has 21: (14,400 + 21 x 600) / (21 x 24).
    expect(lineOf(route, 'Mold Burnout').cycleTimeMin * 60).toBeCloseTo((4 * 3600 + 21 * 600) / (21 * 24), 1);
  });

  it('drying is calculated and reported, not a line of the route: every line can be saved', () => {
    // Six dip cycles of 3 h each and 24 h of final drying: 42 h per tree.
    expect(route.drying!.hoursPerTree).toBe(42);
    expect(route.lines.map((l) => l.process)).not.toContain('Drying');
    expect(route.warnings.join(' ')).toMatch(/Shell drying \(42 h per tree\) is not charged and is not a line of the route/);
    expect(findRouteDataGaps(route.lines)).toEqual([]);
  });

  it('a bench operation is crewed by the plant variable of that operation', () => {
    const finishing = lineOf(route, 'Pattern Finishing');
    expect(finishing.operators).toBe(1);
    expect(finishing.cycleTimeMin * 60).toBeCloseTo(30_000 / 161.29, 0);
    // 186 s at the bench: 14.09 overhead + 1 x 48.05 labour per hour.
    expect(finishing.totalCost).toBeCloseTo((186 / 3600) * (14.09 + 48.05), 1);
  });

  it('cuts off and grinds on the machine while the casting is light enough, at the bench above that', () => {
    const heavy = routeOf({ part: { volumeMm3: 2_000_000, surfaceAreaMm2: 150_000, dimsMm: [250, 200, 100], wallMm: 12, slides: 0 } });
    expect(heavy.lines.map((l) => l.process)).toEqual(expect.arrayContaining(['Abrasive Wheel Cutting', 'Abrasive Disc Grinding']));
    expect(heavy.lines.map((l) => l.process)).not.toEqual(expect.arrayContaining(['Band Saw']));
  });

  it('melts titanium under vacuum only', () => {
    const ti = routeOf({ material: investmentMaterial('Titanium, Ti-6Al-4V') });
    expect(lineOf(ti, 'Metal Pouring').machineName).toMatch(/Consarc/);
    expect(ti.warnings.join(' ')).toMatch(/Chemical etching/);
  });

  it('charges the melt energy only with an energy price, and says so without one', () => {
    const unpriced = routeOf({ scenario: { ...input().scenario, energyPricePerKwh: null } });
    expect(lineOf(unpriced, 'Metal Pouring').totalCost).toBeLessThan(lineOf(route, 'Metal Pouring').totalCost);
    expect(unpriced.warnings.join(' ')).toMatch(/Melting energy is not charged/);
  });
});

describe('investment casting route: metal and the wax pattern die', () => {
  const route = routeOf();

  it('buys the casting and the melt loss; the gating returns to the furnace', () => {
    // Net 60 cm³ x 8073 = 0.4844 kg; poured at 50% gating efficiency 0.9688 kg; melt loss 0.9688 / 0.95 - 0.9688 = 0.0510 kg.
    expect(route.material.netKg).toBeCloseTo(0.4844, 4);
    expect(route.material.pouredKg).toBeCloseTo(0.9688, 4);
    expect(route.material.boughtKg).toBeCloseTo(0.4844 + 0.051, 3);
    expect(route.material.costUsd).toBeCloseTo(0.5354 * 3.497, 2);
  });

  it('prices the wax die from the regression and spreads it over the lifetime volume', () => {
    // Die 272.4 x 232.4 mm = 98.12 in²; 10.98 x 98.12 + 4172.91 + 589.23 x 40 / 25.4 = 6178.2; x 1.10 (cooling lines) = 6796.
    expect(route.tooling).toMatchObject({ tools: 1 });
    expect(route.tooling!.toolCostUsd).toBeCloseTo(6796, 0);
    expect(route.tooling!.perPartUsd).toBeCloseTo(6796 / 50_000, 4);
    expect(route.totalUsd).toBeCloseTo(route.material.costUsd! + route.lines.reduce((s, l) => s + l.totalCost, 0) + route.tooling!.perPartUsd, 2);
  });

  it('does not cost the die without a lifetime volume, and says so', () => {
    const r = routeOf({ scenario: { ...input().scenario, lifetimeVolume: null } });
    expect(r.tooling).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/wax pattern die is not costed/);
  });

  it('a slide of the part adds its share to the die', () => {
    const withSlide = routeOf({ part: { ...input().part, slides: 1 } });
    expect(withSlide.tooling!.toolCostUsd).toBeCloseTo(6178.2 * (1.1 + 0.128), 0);
  });
});

describe('investment casting route: what it refuses', () => {
  it('names a step no machine can do and gives no total', () => {
    const machines = { ...allInvestmentMachines(), [INVESTMENT_CLASS.pouring]: [] };
    const r = routeOf({ machinesByClass: machines });
    expect(r.complete).toBe(false);
    expect(r.totalUsd).toBeNull();
    expect(lineOf(r, 'Metal Pouring').physicsGap).toBeDefined();
    expect(r.material.costUsd).toBeNull();
  });

  it('a part too wide for every slurry tank is a gap on the dipping lines, not a smaller tree', () => {
    const wide = routeOf({ part: { volumeMm3: 5_000_000, surfaceAreaMm2: 900_000, dimsMm: [1500, 300, 200], wallMm: 6, slides: 0 } });
    expect((lineOf(wide, 'Primary Slurry Dipping').physicsGap as { reason: string }).reason).toMatch(/the tree is 1500 mm wide/);
  });

  it('says what is missing when the alloy has no density', () => {
    const material = { ...investmentMaterial('Stainless Steel, AISI 304'), columns: {} };
    expect(build({ material })).toEqual({ route: null, missing: ['Stainless Steel, AISI 304: density_kg_m3'] });
  });

  it('uses 2 x volume / surface for the wax cooling when no wall is measured, and says so', () => {
    const r = routeOf({ part: { ...input().part, wallMm: null } });
    expect(lineOf(r, 'Wax Pattern Molding').physicsGap).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/Wall thickness not measured: the wax cooling time uses 2 x volume \/ surface \(4 mm\)/);
  });
});

describe('investment casting: the part, the alloy price and the summary', () => {
  it('takes the thickest wall, else the nominal one, and the box longest side first', () => {
    const m = { volumeMm3: 1000, surfaceAreaMm2: 600, bboxMm: [10, 30, 20], wallMaxMm: null, wallNominalMm: 3, slides: 2 };
    expect(investmentPart(m).part).toEqual({ volumeMm3: 1000, surfaceAreaMm2: 600, dimsMm: [30, 20, 10], wallMm: 3, slides: 2 });
    expect(investmentPart({ ...m, volumeMm3: null }).missing).toEqual(['the part volume']);
  });

  it('prices the alloy at the India list price in India, the USA price in the USA, and says when a location has none', () => {
    const ref = realInvestmentReference();
    const alloy = investmentMaterial('Stainless Steel, AISI 304');
    expect(alloyPrice(ref, alloy, 'USA')).toMatchObject({ usdPerKg: 3.497, warning: null });
    expect(alloyPrice(ref, alloy, 'India')).toMatchObject({ usdPerKg: 1.67, source: 'India price (raw_material_cost_master)', warning: null });
    expect(alloyPrice(ref, alloy, 'Germany').warning).toMatch(/no Germany price/);
  });

  const summaryOf = (investment: { route: ReturnType<typeof routeOf> | null; missing: string[] }) => buildCastingCostSummary({
    family: 'investment_cast', process: 'investment_casting', hpdc: null, materialGrade: 'Stainless Steel, AISI 304', materialCostPerKg: 3.497,
    materialDensityKgM3: 8073, materialSource: 'db', partVolumeMm3: 60_000, batchSize: 500, warnings: [], ratesSource: 'test', investment,
  });

  it('the summary carries the route: its lines, its metal, the tree and the wax die', () => {
    const route = routeOf();
    const s = summaryOf({ route, missing: [] });
    expect(s.processLines).toHaveLength(route.lines.length);
    expect(s.materialCost).toBe(route.material.costUsd);
    expect(s.castingMetal).toEqual({ partKg: route.material.netKg, chargedKg: route.material.boughtKg });
    expect(s.investmentCasting).toMatchObject({ patternsPerTree: 24, complete: true });
    expect(s.patternTooling).toMatchObject({ tools: 1, costUsd: route.tooling!.toolingCostUsd });
    expect(Object.keys(s.calculatorRuns!)).toEqual(expect.arrayContaining(['Investment tree', 'Investment metal per casting', 'Investment material cost', 'Investment wax pattern tooling']));
    expect(routeToolingItems(s).map((t) => t.key)).toEqual(['wax-pattern-die']);
    expect(investmentCastingRoute({ ...s, currency: 'USD' } as never)).toMatchObject({ routeId: 'investment-casting', isFeasible: true, dataComplete: true });
  });

  it('a route that cannot be built is one named, uncosted line and is not feasible', () => {
    const s = summaryOf({ route: null, missing: ['"ABS" is not an investment casting alloy'] });
    expect(s.processLines).toHaveLength(1);
    expect((s.processLines[0]!.physicsGap as { reason: string }).reason).toMatch(/Investment Casting cannot be costed: "ABS" is not an investment casting alloy/);
    const route = investmentCastingRoute({ ...s, currency: 'USD' } as never);
    expect(route.isFeasible).toBe(false);
    expect(route.capability.warnings).toEqual(['Investment Casting cannot be costed: "ABS" is not an investment casting alloy']);
  });
});
