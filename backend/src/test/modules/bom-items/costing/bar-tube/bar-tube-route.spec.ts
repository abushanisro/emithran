import { barTubeCalculatorsByName, loadBarTubeCalculatorSpec } from '../../../../../modules/bom-items/costing/bar-tube/calculators/bar-tube-calculator-spec';
import { barTubePart } from '../../../../../modules/bom-items/costing/bar-tube/bar-tube-cost.service';
import { buildBarTubeCostSummary } from '../../../../../modules/bom-items/costing/bar-tube/bar-tube-cost-summary';
import { barTubeRouteFor } from '../../../../../modules/bom-items/costing/bar-tube/bar-tube-route-comparison';
import {
  buildBarTubeRoutes, chooseBarTubeRoute, type BarTubePart, type BarTubeRoute, type BarTubeRouteInput,
} from '../../../../../modules/bom-items/costing/bar-tube/bar-tube-route';
import { machineValue } from '../../../../../modules/bom-items/costing/casting/sand/sand-machines';
import type { CostSummaryResponseDto } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';
import { allBarTubeMachines, barTubeMaterial, realBarTubeReference } from './bar-tube-test-data';

const ZERO = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
const A36 = 'Steel, Hot Worked, ASTM A36';
// A 1 m length of 25 x 1.5 mm round tube, square at both ends: metal area π/4 (25² − 22²) = 110.74 mm².
const AREA = (Math.PI / 4) * (25 ** 2 - 22 ** 2);
const TUBE: BarTubePart = {
  stockForm: 'ROUND_TUBE',
  section: { areaMm2: AREA, widthMm: 25, heightMm: 25, outerPerimeterMm: Math.PI * 25, odMm: 25, wallMm: 1.5, circumscribingDiameterMm: 25 },
  developedLengthMm: 1000, bends: [], holes: [], complexHoles: [], cutouts: [],
  ends: [{ end: 'start', variant: 'square', cutAngleDeg: 0, cutPerimeterMm: Math.PI * 25 }, { end: 'end', variant: 'square', cutAngleDeg: 0, cutPerimeterMm: Math.PI * 25 }],
  forms: [],
};
const input = (part: BarTubePart = TUBE, over: Partial<BarTubeRouteInput> = {}): BarTubeRouteInput => ({
  ref: realBarTubeReference(), spec: loadBarTubeCalculatorSpec(), calculators: barTubeCalculatorsByName(), material: barTubeMaterial(A36, part.stockForm),
  part, machinesByClass: allBarTubeMachines(), scenario: { batchSize: 100, route: null }, costContext: ZERO, ...over,
});
const routeOf = (key: string, part: BarTubePart = TUBE) => {
  const r = buildBarTubeRoutes(input(part)).routes.find((x) => x.key === key);
  if (!r) throw new Error(`no ${key} route`);
  return r;
};
const processes = (r: BarTubeRoute) => r.lines.map((l) => l.process);
const gapsOf = (r: BarTubeRoute) => r.lines.filter((l) => l.physicsGap).map((l) => `${l.process}: ${(l.physicsGap as { reason?: string }).reason}`);

describe('saw and punch, a 25 x 1.5 A36 round tube 1 m long', () => {
  const saw = routeOf('saw');

  it('is cut on a band saw (saw_routing_evaluation allows only the band saw for a round tube; a shear does not cut one) and is complete', () => {
    expect(processes(saw)).toEqual(['Band Saw']);
    expect(saw.complete).toBe(true);
  });

  it('cycle: the section at the band saw rate for cut-code family 1 at 50 mm wide, the 1 m index at the axial feed, load and unload, per bundle', () => {
    const line = saw.lines[0]!;
    const m = allBarTubeMachines()['bar_tube_fab_band_saw']!.find((x) => x.name === line.machineName)!;
    const ref = realBarTubeReference();
    const rate = Number(ref.table('saw_cut_rate').find((r) => r['Process Name'] === 'Band Saw' && String(r['Material Cut Code Family']) === '1' && Number(r['Material Width (mm)']) === 50)!['Cutting Rate (mm^2 / min)']);
    expect(rate).toBe(6451.6);
    const bundle = Math.min(Math.floor(machineValue(m, 'max_stock_height_mm')! / 25) * Math.floor(machineValue(m, 'max_stock_width_mm')! / 25), ref.number('maxPartsPerBundleBandSaw')!);
    const sec = (AREA / rate * 60 + 1000 / machineValue(m, 'axial_feed_rate_mm_per_s')! + machineValue(m, 'load_plus_unload_time_s')!) / bundle;
    expect(line.cycleTimeMin * 60).toBeCloseTo(sec, 1);
  });

  it('stock: floor((6096 − 75) / (1000 + 3 mm band saw kerf)) = 6 parts per 6096 mm length; a sixth of the length at the round tube price', () => {
    const mat = barTubeMaterial(A36, 'ROUND_TUBE');
    expect(saw.material.partsPerStock).toBe(6);
    const perPartKg = (6096 * AREA * 7850) / 1e9 / 6;
    expect(saw.material.massKg).toBeCloseTo(perPartKg, 3);
    expect(saw.material.costUsd).toBeCloseTo(perPartKg * mat.stockPricePerKgUsd!, 4);
    expect(saw.material.partKg).toBeCloseTo((1000 * AREA * 7850) / 1e9, 3);
  });
});

describe('the tube laser route', () => {
  it('is a named gap when process_cut_rate has no Tube Laser feed for the material: its feeds are for cut-code family 9 only', () => {
    const laser = routeOf('laser');
    expect(laser.complete).toBe(false);
    expect(gapsOf(laser).join(' ')).toMatch(/no Tube Laser feed for cut-code family 1 .*family 9/);
  });

  it('a solid bar is not a tube laser route (sawn), and says why', () => {
    const bar: BarTubePart = { ...TUBE, stockForm: 'ROUND_BAR', section: { ...TUBE.section, areaMm2: Math.PI / 4 * 625, wallMm: null } };
    const { routes, gaps } = buildBarTubeRoutes(input(bar));
    expect(routes.map((r) => r.key)).toEqual(['saw']);
    expect(gaps).toEqual([{ key: 'laser', label: 'Tube laser', reason: 'a tube laser cuts tubes and open profiles, not round bar' }]);
  });

  it('the saw route is quoted: the only complete one', () => {
    const { routes, gaps } = buildBarTubeRoutes(input());
    const { route, note } = chooseBarTubeRoute(routes, gaps, null);
    expect(route!.key).toBe('saw');
    expect(note).toMatch(/Saw and punch is quoted .* the cheapest complete route/);
  });
});

describe('openings, end forms and bends', () => {
  it('holes through the wall are punched, one hit each, indexed from the first to the last', () => {
    const holed = { ...TUBE, holes: [{ featureType: 'SimpleHole', diameterMm: 6, stationMm: 100 }, { featureType: 'SimpleHole', diameterMm: 6, stationMm: 900 }] };
    const saw = routeOf('saw', holed);
    expect(processes(saw)).toEqual(['Band Saw', 'Punching']);
    const punch = saw.lines[1]!;
    expect(punch.physicsGap).toBeUndefined();
    expect(JSON.stringify(punch.calculationTrace ?? punch)).toMatch(/2 hole\(s\)/);
  });

  it('a flared end is formed on a flaring machine on either route', () => {
    const flared = { ...TUBE, forms: [{ end: 'end' as const, variant: 'flare' }] };
    expect(processes(routeOf('saw', flared))).toEqual(['Band Saw', 'Flaring']);
    expect(processes(routeOf('laser', flared))).toEqual(['Tube Laser', 'Flaring']);
  });

  it('a notched end is notched on the saw route and profiled by the tube laser', () => {
    const notched = { ...TUBE, ends: [TUBE.ends[0]!, { ...TUBE.ends[1]!, variant: 'notch' }] };
    expect(processes(routeOf('saw', notched))).toEqual(['Band Saw', 'Notching']);
    expect(processes(routeOf('laser', notched))).toEqual(['Tube Laser']);
  });

  it('bends are a named gap until the bending methods are costed, so the route is incomplete', () => {
    const bent = { ...TUBE, bends: [{ clrMm: 50, angleDeg: 90 }] };
    const saw = routeOf('saw', bent);
    expect(saw.complete).toBe(false);
    expect(gapsOf(saw)).toEqual(['Bending: 1 bend(s): the bending methods (rotary draw, compression, roll, bend brake) are not costed yet']);
  });

  it('an end cut steeper than maxSawableCutoutAngle (45) is not sawn, though the DoAll vertical saw swings to 90; a shear cuts square only', () => {
    const steep = { ...TUBE, ends: [{ ...TUBE.ends[0]!, cutAngleDeg: 80 }, TUBE.ends[1]!] };
    expect(gapsOf(routeOf('saw', steep)).join(' ')).toMatch(/an end is cut at 80 degrees, beyond the reference's maxSawableCutoutAngle of 45/);
    const angled = { ...TUBE, ends: [{ ...TUBE.ends[0]!, cutAngleDeg: 30 }, TUBE.ends[1]!] };
    expect(routeOf('saw', angled).complete).toBe(true);
  });
});

describe('what the cad-engine measured, as the routes take it', () => {
  it('not measured, not stock, plate and extrusion each say why (never priced as something else)', () => {
    expect(barTubePart(null).missing[0]).toMatch(/press Refresh analysis/);
    expect(barTubePart({ extractionVersion: 'bar-tube-1', stockForm: null, reason: 'not one cross-section along a straight or bent line, and not a flat plate' }).missing[0])
      .toBe('the part is not a length of bar, tube or profile: not one cross-section along a straight or bent line, and not a flat plate');
    expect(barTubePart({ extractionVersion: 'bar-tube-1', stockForm: 'PLATE' }).missing[0]).toMatch(/cut from plate/);
    expect(barTubePart({ extractionVersion: 'bar-tube-1', stockForm: 'GENERIC_EXTRUSION' }).missing[0]).toMatch(/extruded profile/);
  });

  it('reads the cad-engine output (snake case) into the part', () => {
    const { part } = barTubePart({
      extractionVersion: 'bar-tube-1', stockForm: 'ROUND_TUBE', developedLengthMm: 1000,
      section: { area_mm2: AREA, width_mm: 25, height_mm: 25, outer_perimeter_mm: 78.54, od_mm: 25, wall_mm: 1.5 },
      bends: [{ clr_mm: 50, angle_deg: 90 }], holes: [{ feature_type: 'SimpleHole', diameter_mm: 6, station_mm: 100 }],
      ends: [{ end: 'start', variant: 'angled', cut_angle_deg: 30, cut_perimeter_mm: 90 }], forms: [{ end: 'end', variant: 'flare' }],
    });
    expect(part).toMatchObject({
      stockForm: 'ROUND_TUBE', developedLengthMm: 1000, section: { wallMm: 1.5, odMm: 25 }, bends: [{ clrMm: 50, angleDeg: 90 }],
      holes: [{ diameterMm: 6, stationMm: 100 }], ends: [{ end: 'start', variant: 'angled', cutAngleDeg: 30 }], forms: [{ end: 'end', variant: 'flare' }],
    });
  });
});

describe('the cost summary and the route comparison', () => {
  const { routes, gaps } = buildBarTubeRoutes(input());
  const { route, note } = chooseBarTubeRoute(routes, gaps, null);
  const summary = buildBarTubeCostSummary({
    barTube: { route, routes, gaps, part: TUBE, note, missing: [], warnings: [] }, materialGrade: A36, materialCostPerKg: 1, materialSource: 'db', batchSize: 100, warnings: [], ratesSource: 'test',
  });

  it('totals the stock and the saw line, and lists both routes with the laser\'s reason', () => {
    expect(summary.family).toBe('bar_tube');
    expect(summary.totalCost).toBeCloseTo(route!.totalUsd!, 2);
    expect(summary.barTube).toMatchObject({ route: 'saw', stockForm: 'ROUND_TUBE', partsPerStock: 6, complete: true });
    expect(summary.barTube!.options.find((o) => o.route === 'laser')!.reason).toMatch(/^Tube Laser: no Tube Laser machine fits .*no Tube Laser feed for cut-code family 1/);
  });

  it('the comparison entry of the quoted route carries its lines; the other says why it is not usable', () => {
    const saw = barTubeRouteFor('saw', summary as CostSummaryResponseDto);
    expect(saw).toMatchObject({ routeId: 'bar-tube-saw', isFeasible: true });
    const laser = barTubeRouteFor('laser', summary as CostSummaryResponseDto);
    expect(laser).toMatchObject({ routeId: 'bar-tube-laser', isFeasible: false, processLines: [] });
  });

  it('a part that is not stock is one named, uncosted line', () => {
    const s = buildBarTubeCostSummary({
      barTube: { route: null, routes: [], gaps: [], part: null, note: null, missing: ['a part cut from plate: plate cutting (laser, plasma, oxyfuel) is not costed yet'], warnings: [] },
      materialGrade: A36, materialCostPerKg: 1, materialSource: 'db', batchSize: 100, warnings: [], ratesSource: 'test',
    });
    expect(s.processLines).toHaveLength(1);
    expect(s.processLines[0]!.physicsGap).toMatchObject({ reason: 'Bar and Tube Fabrication cannot be costed: a part cut from plate: plate cutting (laser, plasma, oxyfuel) is not costed yet' });
  });
});
