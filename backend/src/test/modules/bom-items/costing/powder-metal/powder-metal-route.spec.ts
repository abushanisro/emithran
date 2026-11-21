import { readFileSync } from 'fs';
import { join } from 'path';
import { buildPowderMetalCostSummary } from '../../../../../modules/bom-items/costing/powder-metal/powder-metal-cost-summary';
import {
  buildPowderMetalRoute, POWDER_METAL_CLASS, type PowderMetalPart, type PowderMetalRoute, type PowderMetalRouteInput,
} from '../../../../../modules/bom-items/costing/powder-metal/powder-metal-route';
import { loadPowderMetalCalculatorSpec, powderMetalCalculatorsByName } from '../../../../../modules/bom-items/costing/powder-metal/calculators/powder-metal-calculator-spec';
import { buildPowderMetalCalculatorsMigrationSql } from '../../../../../modules/bom-items/costing/powder-metal/calculators/powder-metal-calculators-migration';
import { findRouteDataGaps } from '../../../../../modules/bom-items/costing/shared/core/engine-kernel';
import { allPowderMetalMachines, powderMetalMaterial, realPowderMetalReference } from './powder-metal-test-data';

// The press-and-sinter route on the real memory/Powder metal data. The part: a bushing 30 mm outside, 15 mm bore, 20 mm high, pressed
// along its axis, in F-0005 (iron + graphite), in batches of 1,000.
const ZERO = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
const AREA = (Math.PI / 4) * (30 ** 2 - 15 ** 2);
const BUSHING: PowderMetalPart = { volumeMm3: AREA * 20, projectedAreaMm2: AREA, heightMm: 20, planLengthMm: 30, planWidthMm: 30, holes: [] };
const input = (over: Partial<PowderMetalRouteInput> = {}): PowderMetalRouteInput => ({
  ref: realPowderMetalReference(), spec: loadPowderMetalCalculatorSpec(), calculators: powderMetalCalculatorsByName(),
  material: powderMetalMaterial('F-0005'), part: BUSHING, machinesByClass: allPowderMetalMachines(),
  scenario: { batchSize: 1000, greenDensityKgM3: null }, costContext: ZERO, ...over,
});
const routeOf = (over: Partial<PowderMetalRouteInput> = {}) => {
  const { route, missing } = buildPowderMetalRoute(input(over));
  if (!route) throw new Error(`no route: ${missing.join('; ')}`);
  return route;
};
// F-0005's compaction curve (raw_materials.csv): A 1575.3, B -21148, C 71379, at its green density 7.02 g/cm³.
const curve = (gcc: number) => 1575.3 * gcc ** 2 - 21148 * gcc + 71379;

describe('powder metal: compaction', () => {
  const route = routeOf();

  it("presses the powder at its compaction curve's pressure for its green density, over the part's outline", () => {
    expect(route.greenDensityKgM3).toBe(7020);
    expect(route.compactionPressureMpa).toBeCloseTo(curve(7.02), 1);
    expect(route.pressForceKn).toBeCloseTo((curve(7.02) * AREA) / 1000, 1);
  });

  it('fills the die with the part height times the compression ratio (green over apparent density)', () => {
    expect(route.compressionRatio).toBeCloseTo(7020 / 2950, 2);
    expect(route.fillHeightMm).toBeCloseTo(20 * (7020 / 2950), 1);
  });

  it('presses on the cheapest press with the force within its safety factor, the fill depth and the punch', () => {
    const press = route.lines[0]!;
    expect(press.process).toBe('Compaction Pressing');
    for (const c of press.machineChoice!.candidates.filter((x) => x.status === 'rejected')) expect(c.reasons.join(' ')).toMatch(/kN|fills|punch/);
    const chosen = allPowderMetalMachines()[POWDER_METAL_CLASS.press]!.find((m) => m.name === press.machineName)!;
    expect(Number(chosen.specs['press_force_kn']) * Number(chosen.specs['press_force_safety_factor'])).toBeGreaterThanOrEqual(route.pressForceKn);
    expect(press.cycleTimeMin * 60).toBeCloseTo(60 / Number(chosen.specs['max_stroke_rate_cycles_per_min']), 3);
  });

  it('a green density set by the engineer must lie within the powder\'s range; a denser part takes more pressure', () => {
    const dense = routeOf({ scenario: { batchSize: 1000, greenDensityKgM3: 7150 } });
    expect(dense.greenDensitySource).toBe('scenario');
    expect(dense.compactionPressureMpa).toBeCloseTo(curve(7.15), 1);
    expect(dense.compactionPressureMpa).toBeGreaterThan(route.compactionPressureMpa);
    expect(buildPowderMetalRoute(input({ scenario: { batchSize: 1000, greenDensityKgM3: 7500 } })).missing.join(' ')).toMatch(/outside F-0005's range \(6710 to 7200/);
  });

  it('a part too large for every press is a named gap, not a guessed machine', () => {
    const plate = routeOf({ part: { ...BUSHING, projectedAreaMm2: 200_000, volumeMm3: 200_000 * 20, planLengthMm: 500, planWidthMm: 400 } });
    expect(plate.complete).toBe(false);
    expect(plate.totalUsd).toBeNull();
    expect((plate.lines[0]!.physicsGap as { reason: string }).reason).toMatch(/no Compaction Pressing machine fits/);
  });
});

describe('powder metal: sintering', () => {
  const route = routeOf();

  it('runs the belt so a part soaks the soak time in the heat zone, within the belt speed range in inches per minute', () => {
    const sinter = route.lines[1]!;
    const furnace = allPowderMetalMachines()[POWDER_METAL_CLASS.furnace]!.find((m) => m.name === sinter.machineName)!;
    const speed = Math.min(Math.max(Number(furnace.specs['heat_zone']) / 20, Number(furnace.specs['min_be']) * 25.4), Number(furnace.specs['max_belt_s']) * 25.4);
    expect(route.belt!.speedMmPerMin).toBeCloseTo(speed, 1);
  });

  it('carries as many parts across as fit between the edge offsets, and per metre within the belt load', () => {
    const sinter = route.lines[1]!;
    const width = Number(allPowderMetalMachines()[POWDER_METAL_CLASS.furnace]!.find((m) => m.name === sinter.machineName)!.specs['belt_width_mm']);
    expect(route.belt!.partsAcross).toBe(Math.floor((width - 2 * 6.35 + 1.5875) / (30 + 1.5875)));
    const perMetre = Math.min((route.belt!.partsAcross * 1000) / (30 + 1.5875), 100 / route.material.partKg);
    expect(route.belt!.partsPerMetre).toBeCloseTo(perMetre, 0);
    // The line stores its cycle time rounded in minutes: to a tenth of a second here.
    expect(sinter.cycleTimeMin * 60).toBeCloseTo(60 / ((route.belt!.speedMmPerMin / 1000) * perMetre), 1);
  });

  it('a part taller than every muffle is a named gap', () => {
    const tall = routeOf({ part: { ...BUSHING, heightMm: 140, volumeMm3: AREA * 140 } });
    expect((tall.lines[1]!.physicsGap as { reason: string } | undefined)?.reason ?? '').toMatch(/muffle/);
  });
});

describe('powder metal: the route', () => {
  const route = routeOf();

  it('is complete, press then sinter, each on a real machine', () => {
    expect(route.complete).toBe(true);
    expect(route.lines.map((l) => l.process)).toEqual(['Compaction Pressing', 'Furnace Sintering']);
    expect(findRouteDataGaps(route.lines)).toEqual([]);
  });

  it('buys the powder for the part at its green density, over the material utilization', () => {
    const partKg = AREA * 20 * 7020 * 1e-9;
    expect(route.material.partKg).toBeCloseTo(partKg, 4);
    expect(route.material.costUsd).toBeCloseTo((partKg / 0.9) * 1.621, 2);
    expect(route.totalUsd).toBeCloseTo(route.material.costUsd + route.lines.reduce((s, l) => s + l.totalCost, 0), 2);
  });

  it('says what it does not cost or check: the compaction tooling, and whether the part can be pressed', () => {
    expect(route.warnings.join(' ')).toMatch(/compaction tooling \(die, punches, core rods\) is not costed/);
    expect(route.warnings.join(' ')).toMatch(/Whether the part can be pressed .* is not checked/);
  });

  it('its Cost Summary gives the powder\'s price with its source: the raw_materials row the route priced it from', () => {
    const summary = (built: PowderMetalRoute | null) => buildPowderMetalCostSummary({
      powderMetal: { route: built, missing: built ? [] : ['HR Rates has no powder metal machines for India'], warnings: [] },
      // The material resolution's own result, as when it found no row for the grade.
      materialGrade: 'F-0005', materialCostPerKg: 0, materialSource: 'default', batchSize: 1000, warnings: [], ratesSource: 'test',
    });
    expect(summary(route)).toMatchObject({ materialSource: 'db', materialCostPerKg: route.material.costPerKgUsd });
    expect(summary(null)).toMatchObject({ materialSource: 'default', materialCost: 0 });
  });

  it('names a powder with no green density or compaction curve', () => {
    expect(buildPowderMetalRoute(input({ material: { ...powderMetalMaterial('F-0005'), columns: {} } })).missing).toEqual(['F-0005: green_density']);
  });
});

describe('powder metal calculator spec', () => {
  it('is what migration 1060 creates (regenerate the migration after editing the spec)', () => {
    expect(readFileSync(join(__dirname, '../../../../../../migrations/1060_powder_metal_calculators.sql'), 'utf8')).toBe(buildPowderMetalCalculatorsMigrationSql());
  });

  it('every variable and machine column it reads is in memory/Powder metal', () => {
    const spec = loadPowderMetalCalculatorSpec();
    const ref = realPowderMetalReference();
    const keys = new Set(['machine_power_kw', ...Object.values(allPowderMetalMachines()).flat().flatMap((m) => Object.keys(m.specs))]);
    const sources = spec.calculators.flatMap((c) => c.fields.flatMap((f) => (f.source ? [f.source as Record<string, string>] : [])));
    expect(sources.filter((s) => 'variable' in s && ref.number(s['variable']!) == null)).toEqual([]);
    expect(sources.filter((s) => 'machine' in s && !keys.has(s['machine']!))).toEqual([]);
    const columns = powderMetalMaterial('F-0005').columns;
    expect(sources.filter((s) => 'material' in s && columns[s['material']!] == null)).toEqual([]);
  });
});
