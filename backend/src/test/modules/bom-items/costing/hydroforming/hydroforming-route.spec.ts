// The Sheet Metal - Hydroforming routes on the real memory/Sheetmetal Hydroforming data and the presses as migration 1109 rates them.
import { readFileSync } from 'fs';
import { join } from 'path';

import { allHydroformingMachines, MILD_STEEL, realHydroformingCatalog, realHydroformingReference, realToolShop } from './hydroforming-test-data';
import { hydroformingCalculatorsByName, loadHydroformingCalculatorSpec } from '../../../../../modules/bom-items/costing/hydroforming/calculators/hydroforming-calculator-spec';
import { buildHydroformingCalculatorsMigrationSql } from '../../../../../modules/bom-items/costing/hydroforming/calculators/hydroforming-calculators-migration';
import { buildHydroformingCostSummary, HYDROFORMING_NOT_COSTED } from '../../../../../modules/bom-items/costing/hydroforming/hydroforming-cost-summary';
import { rectangleNest, type HydroformingCostResult } from '../../../../../modules/bom-items/costing/hydroforming/hydroforming-cost.service';
import { hydroformPart, type HydroformPart } from '../../../../../modules/bom-items/costing/hydroforming/hydroforming-part';
import {
  blankAddendum, buildHydroformingRoutes, chooseHydroformingRoute, drawCount, hydroformingRule, manualFormLength, sheetMeasure,
  type HydroformingNest, type HydroformingRouteInput,
} from '../../../../../modules/bom-items/costing/hydroforming/hydroforming-route';
import { hydroformingRouteFor } from '../../../../../modules/bom-items/costing/hydroforming/hydroforming-route-comparison';
import { stepRow } from '../../../../../modules/bom-items/costing/hydroforming/hydroforming-tooling';

import type { CostSummaryResponseDto, ProcessLineCost } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';


const ZERO = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
const ref = realHydroformingReference();
const NEST: HydroformingNest = { grossKgPerPart: 0.2, partsPerSheet: 50, utilizationPct: 70, sheetLengthMm: 2438.4, sheetWidthMm: 1219.2, method: 'true_shape', note: null };

// A cup drawn 60 mm deep with an 80 mm opening, 1 mm sheet: its developed area (bottom + wall) on an equal-area round blank.
const CUP_AREA = (Math.PI / 4) * 80 ** 2 + Math.PI * 80 * 60;
const CUP_D0 = Math.sqrt((4 * CUP_AREA) / Math.PI);
const CUP: HydroformPart = {
  depthMm: 60, planLengthMm: 80, planWidthMm: 80, minWidthMm: 80, projectedAreaMm2: (Math.PI / 4) * 80 ** 2, developedAreaMm2: CUP_AREA,
  mainSurface: { areaMm2: 0, perimeterMm: 0 },
  drawn: { depthMm: 60, openingWidthMm: 80, formProjectedAreaMm2: (Math.PI / 4) * 80 ** 2, formDevelopedAreaMm2: CUP_AREA },
  blank: {
    method: 'drawn_equal_area', areaMm2: CUP_AREA, perimeterMm: Math.PI * CUP_D0, lengthMm: CUP_D0, widthMm: CUP_D0, circumscribedDiameterMm: CUP_D0,
    outlinePointsMm: null, piercedHoleAreaMm2: 0, piercedHolePerimeterMm: 0,
  },
  flanges: [], holes: [], unmeasured: [],
};
// A 200 x 100 plate, 1.5 mm, with two 90° straight flanges 20 mm high along its long sides, a curved flange turned 90° along 50 mm of a
// rounded corner, and two holes in the flat: one 10 mm and one 2 mm from the main surface's edge.
const PLATE: HydroformPart = {
  depthMm: 21.5, planLengthMm: 200, planWidthMm: 100, minWidthMm: 100, projectedAreaMm2: 20000, developedAreaMm2: 28000,
  mainSurface: { areaMm2: 20000, perimeterMm: 600 }, drawn: null,
  blank: { method: 'true_unfold', areaMm2: 28000, perimeterMm: 680, lengthMm: 200, widthMm: 140, circumscribedDiameterMm: 244.1, outlinePointsMm: null, piercedHoleAreaMm2: 157.1, piercedHolePerimeterMm: 62.8 },
  flanges: [
    { kind: 'straight', angleDeg: 90, lengthMm: 200, heightMm: 20, edgeRadiusMm: null },
    { kind: 'straight', angleDeg: 90, lengthMm: 200, heightMm: 20, edgeRadiusMm: null },
    { kind: 'curved', angleDeg: 90, lengthMm: 50, heightMm: 20, edgeRadiusMm: 30 },
  ],
  holes: [
    { featureType: 'SimpleHole', diameterMm: 10, perimeterMm: 31.4, areaMm2: 78.5, inFlat: true, onMainSurface: true, edgeDistanceMm: 10, faceIds: [] },
    { featureType: 'SimpleHole', diameterMm: 10, perimeterMm: 31.4, areaMm2: 78.5, inFlat: true, onMainSurface: true, edgeDistanceMm: 2, faceIds: [] },
  ],
  unmeasured: [],
};

const input = (part: HydroformPart, over: Partial<HydroformingRouteInput> = {}, scenario: Partial<HydroformingRouteInput['scenario']> = {}): HydroformingRouteInput => ({
  ref, spec: loadHydroformingCalculatorSpec(), calculators: hydroformingCalculatorsByName(), material: MILD_STEEL, part,
  thicknessMm: part === CUP ? 1 : 1.5, machinesByClass: allHydroformingMachines(), costContext: ZERO, nest: NEST, toolShop: realToolShop(),
  ...over,
  scenario: { batchSize: 100, route: null, partsPerTray: null, intensifier: false, amortizationParts: 10000, ...scenario },
});
const routesOf = (inp: HydroformingRouteInput) => {
  const { routes, missing } = buildHydroformingRoutes(inp);
  if (missing.length) throw new Error(missing.join('; '));
  return routes;
};
const route = (inp: HydroformingRouteInput, key: 'deep-draw' | 'fluid-cell') => routesOf(inp).find((r) => r.key === key)!;
/** The calculated fields of a line's calculator run, by name (its calculation trace). */
const runOf = (line: ProcessLineCost): Record<string, number> =>
  Object.fromEntries((line.calculationTrace ?? []).filter((t) => t.kind === 'calculated' && typeof t.value === 'number').map((t) => [t.fieldName, t.value as number]));

describe('the Sheet Metal - Hydroforming calculators (migration 1110)', () => {
  it('are what migration 1110 creates (regenerate it after editing the spec)', () => {
    expect(readFileSync(join(__dirname, '../../../../../../migrations/1110_hydroforming_calculators.sql'), 'utf8')).toBe(buildHydroformingCalculatorsMigrationSql());
  });

  it('every variable and lookup they read is in memory/Sheetmetal Hydroforming', () => {
    for (const c of loadHydroformingCalculatorSpec().calculators) {
      for (const f of c.fields) if (f.source && 'variable' in f.source) expect([c.name, f.source.variable, ref.text(f.source.variable) != null]).toEqual([c.name, f.source.variable, true]);
    }
  });
});

describe("memory's route rule (fluidCellFormingRatioThreshold 0.65)", () => {
  it('a cup mostly drawn: its depth over its opening, 60 / 80 = 0.75, is Deep Draw', () => {
    expect(hydroformingRule(ref, CUP)).toMatchObject({ route: 'deep-draw', basis: 'drawn form', threshold: 0.65 });
    expect(hydroformingRule(ref, CUP).ratio).toBeCloseTo(0.75, 9);
  });

  it('a flanged plate: the part depth over its narrowest plan width, 21.5 / 100, is Fluid Cell', () => {
    expect(hydroformingRule(ref, PLATE)).toMatchObject({ route: 'fluid-cell', basis: 'part' });
  });
});

describe('Deep Draw: the cup', () => {
  const deep = route(input(CUP), 'deep-draw');

  it('draws from the equal-area blank to the opening in the draws drawReductionPercentage gives a 1 mm sheet', () => {
    const row = stepRow(ref.table('drawReductionPercentage'), 'Material Thickness (mm)', 1)!;
    const blankDia = Math.sqrt((4 * deep.material.blankAreaMm2) / Math.PI);
    let dia = blankDia * Number(row['Draw Punch Ratio00']) / 100;
    let draws = 1;
    while (dia > 80) { dia *= Number(row[`Draw Punch Ratio0${Math.min(draws, 3)}`]) / 100; draws += 1; }
    expect(deep.draws).toBe(draws);
    expect(drawCount(ref, blankDia, 80, 1, false)?.draws).toBe(draws);
  });

  it('lists the ratio of each draw made, not every column of the table row (LEAD NUT HOUSING: 2 draws listed 52 > 70 > 75 > 75)', () => {
    // A 1 mm row (52, 70, 75, 75): a 100 mm blank to a 40 mm opening is 52 then 36.4 mm, two draws.
    expect(drawCount(ref, 100, 40, 1, false)).toEqual({ draws: 2, ratiosPct: [52, 70] });
    // Past the row's columns the last ratio repeats: 100 -> 52 -> 36.4 -> 27.3 -> 20.5 -> 15.4 mm is five draws.
    expect(drawCount(ref, 100, 16, 1, false)).toEqual({ draws: 5, ratiosPct: [52, 70, 75, 75, 75] });
  });

  it('the blank carries blankAddendumWidth at the 60 mm drawn depth on each side (trimmed after drawing)', () => {
    const addendum = blankAddendum(ref, CUP).mm;
    expect(addendum).toBe(Number(stepRow(ref.table('blankAddendumWidth'), 'Total Form Depth (mm)', 60)!['Addendum Width (mm)']));
    expect(deep.material.blankAreaMm2).toBeCloseTo(CUP_AREA + Math.PI * CUP_D0 * addendum + Math.PI * addendum ** 2, 6);
    expect(deep.material.blankKg).toBeCloseTo((deep.material.blankAreaMm2 * 1 * 7850) / 1e9, 9);
  });

  it('is complete: the offline blank, then the press, on the preferred 456 Dia deep draw press (usePreferredMachines)', () => {
    expect(deep.complete).toBe(true);
    expect(deep.lines.map((l) => [l.process, l.processRoute])).toEqual([['Offline Blank', 'Offline Blank'], ['Hydroform', 'Hydroform Deep Draw']]);
    expect(deep.press?.name).toBe('Hydroform Press - Deep Draw - 456 Dia');
    expect(deep.press?.formingCycleTimeS).toBe(45);
    expect(deep.totalUsd).toBeCloseTo(deep.material.costUsd + deep.lines.reduce((s, l) => s + l.totalCost, 0), 2);
  });

  it('the press cycle: handling, forming and cleaning once per draw, inspection once (calculator Hydroforming - Hydroform)', () => {
    const press = deep.lines[1];
    const out = runOf(press);
    const handling = (kg: number) => Number(stepRow(ref.table('tblMaterialHandling'), 'Weight (kg)', kg)!['Load Time (s)']);
    const clean = Math.max(CUP_AREA / Number(stepRow(ref.table('tblCleanRate'), 'Component Area (mm^2)', CUP_AREA)!['Manual Clean Rate (mm^2 / s)']), ref.number('minimumToolCleanTime')!);
    const partKg = (CUP_AREA * 1 * 7850) / 1e9;
    expect(out['Handling Time']).toBeCloseTo((handling(deep.material.blankKg) + handling(partKg)) * deep.draws, 9);
    expect(out['Press Time']).toBeCloseTo((45 + clean) * deep.draws, 9);
    expect(press.cycleTimeMin * 60).toBeCloseTo(out['Handling Time'] + out['Press Time'] + ref.number('defaultInspectionTime')!, 1);
    expect(press.featureBreakdown?.map((o) => o.name)).toEqual([
      'Loading', `Deep Draw Forming${deep.draws > 1 ? ` (${deep.draws} draws)` : ''}`, 'Clean Tooling', 'Visual Inspection', 'Unloading',
    ]);
  });

  it('a deep draw tool a draw (punch and draw ring), spread over the job by its life', () => {
    const tool = deep.tooling.find((t) => t.key === 'hydroform-deep-draw')!;
    expect(tool.copies).toBe(deep.draws);
    expect(tool.costUsd).toBeGreaterThan(0);
    // Steel (tblToolLife, 3,000,000) x Nitrided Steel's tblToolCoating life factor (1.9): 10,000 parts wear out one set.
    expect(tool.toolLife).toBeCloseTo(3_000_000 * 1.9, 6);
    expect(tool.sets).toBe(1);
    expect(tool.investmentUsd).toBeCloseTo(tool.costUsd! * deep.draws, 1);
    expect(tool.perPartUsd).toBeCloseTo((tool.costUsd! * deep.draws) / 10000, 3);
    expect(deep.tooling.find((t) => t.key === 'offline-blanking-die')).toMatchObject({ costUsd: null, perPartUsd: null });
  });
});

describe('Fluid Cell: the flanged plate', () => {
  const fluid = route(input(PLATE), 'fluid-cell');

  it('hand adjusts the curved flange turned beyond bendAngleFormingThreshold (50 mm at defaultManualFormFormingRate), not the straight ones', () => {
    expect(manualFormLength(ref, PLATE)).toBe(50);
    expect(fluid.handAdjustingLengthMm).toBe(50);
    const hand = fluid.lines[1].featureBreakdown?.find((o) => o.name.startsWith('Hand Adjusting'));
    expect(hand?.timeSec).toBeCloseTo((50 / ref.number('defaultManualFormFormingRate')!) * 60, 6);
  });

  it('lays the throw pad over the plan grown by throwPadAddendum, applied and removed at their rates', () => {
    const a = ref.number('throwPadAddendum')!;
    expect(fluid.throwPadAreaMm2).toBeCloseTo((200 + 2 * a) * (100 + 2 * a), 6);
  });

  it("forms memory's one part a tray, and up to what the press's tray holds when the Cost Guide asks for more", () => {
    expect(fluid.partsPerTray).toBe(1);
    expect(fluid.partsThatFit).toBeGreaterThan(1);
    const many = route(input(PLATE, {}, { partsPerTray: 4 }), 'fluid-cell');
    // Each part in its holder takes 200 + 2 x (20 + 50) by 100 + 2 x (20 + 50) mm: the press chosen holds partsThatFit of them.
    expect(many.partsPerTray).toBe(Math.min(4, many.partsThatFit!));
    expect(many.partsPerTray).toBeGreaterThan(1);
    // The press cycle, the cleaning and the throw pad are shared by the parts on the tray.
    const clean = Math.max(28000 / Number(stepRow(ref.table('tblCleanRate'), 'Component Area (mm^2)', 28000)!['Manual Clean Rate (mm^2 / s)']), ref.number('minimumToolCleanTime')!);
    const pad = many.throwPadAreaMm2 / ref.number('throwPadApplicationRate')! + many.throwPadAreaMm2 / ref.number('throwPadRemovalRate')!;
    expect(runOf(many.lines[1])['Press Time']).toBeCloseTo((many.press!.formingCycleTimeS + clean + pad) / many.partsPerTray, 3);
  });

  it('takes a capping tool for the hole 10 mm from the edge, not for the one 2 mm from it', () => {
    expect(fluid.cappingTools).toBe(1);
  });

  it('is complete on a preferred fluid cell press, its line filed under Hydroform Fluid Cell', () => {
    expect(fluid.complete).toBe(true);
    expect(fluid.lines[1].processRoute).toBe('Hydroform Fluid Cell');
  });
});

describe('what cannot be made or measured', () => {
  it("a hole through a formed wall is pierced in the flat blank with the others, as memory's Offline Blank pierces every hole", () => {
    const wall = { ...CUP, holes: [{ featureType: 'SimpleHole', diameterMm: 6, perimeterMm: 18.8, areaMm2: 28.3, inFlat: false, onMainSurface: false, edgeDistanceMm: null, faceIds: [] }] };
    const plain = route(input(CUP), 'deep-draw');
    const deep = route(input(wall, { thicknessMm: 1 }), 'deep-draw');
    // No $0 line: the Offline Blank's one stroke pierces it, so its cut joins the blanking force (cut x 1 mm x 250 MPa shear).
    expect(deep.lines.map((l) => l.process)).toEqual(['Offline Blank', 'Hydroform']);
    expect(deep.blankingForceKn! - plain.blankingForceKn!).toBeCloseTo((18.8 * 1 * 250) / 1000, 6);
    expect(deep.warnings.some((w) => w.includes('1 hole(s) through a formed wall are pierced in the flat blank') && w.includes('toleranceLooseThresholdHole'))).toBe(true);
    expect(deep.complete).toBe(true);
  });

  it('a part larger than every deep draw press: a named gap on Deep Draw, and the quote takes the complete Fluid Cell route', () => {
    const big = { ...CUP, blank: { ...CUP.blank, circumscribedDiameterMm: 2000 } };
    const routes = routesOf(input(big));
    expect(routes.find((r) => r.key === 'deep-draw')!.complete).toBe(false);
    const { route: quoted, note } = chooseHydroformingRoute(routes, hydroformingRule(ref, big), null);
    expect(quoted?.key).toBe('fluid-cell');
    expect(note).toMatch(/but that route is incomplete/);
  });

  it('the Cost Guide route wins over the rule, and says so', () => {
    const routes = routesOf(input(PLATE));
    const { route: quoted, note } = chooseHydroformingRoute(routes, hydroformingRule(ref, PLATE), 'deep-draw');
    expect(quoted?.key).toBe('deep-draw');
    expect(note).toMatch(/set in the Cost Guide/);
  });

  it('a part not measured for hydroforming asks for Refresh analysis; a summary with no route is one named uncosted line', () => {
    // Absent: an analysis from before the measurement, so Refresh analysis measures it. null: the current engine found no sheet to measure.
    expect(hydroformPart(undefined).missing[0]).toMatch(/press Refresh analysis/);
    expect(hydroformPart(null).missing).toEqual(['the hydroforming measurements: the cad-engine found no sheet (a thickness and a main face) to measure on this part']);
    expect(hydroformPart({ version: 'hf_v0' }).part).toBeNull();
    const none: HydroformingCostResult = { route: null, routes: [], rule: null, part: null, nest: null, note: null, missing: ['the hydroforming measurements: press Refresh analysis'], warnings: [] };
    const s = buildHydroformingCostSummary({ hydroforming: none, materialGrade: 'X', materialCostPerKg: 1, materialSource: 'db', batchSize: 1, warnings: [], ratesSource: 't', scenario: { partsPerTray: null, intensifier: false } });
    expect(s.processLines).toHaveLength(1);
    expect(s.warnings.some((w) => w.startsWith(HYDROFORMING_NOT_COSTED))).toBe(true);
    expect(s.totalCost).toBe(0);
  });

  it('no tool shop: the tool is listed, not costed, and the route is still priced', () => {
    const deep = route(input(CUP, { toolShop: null }), 'deep-draw');
    expect(deep.complete).toBe(true);
    expect(deep.tooling[0]).toMatchObject({ costUsd: null, investmentUsd: null });
  });
});

describe('the process tree rows of each line (memory\'s catalog, the part\'s features)', () => {
  it('the Offline Blank and the press lines carry their catalog rows, and their breakdown rows the features they act on', () => {
    const graph = [{ id: 'blank_0', feature_type: 'Blank' }, { id: 'bend_0', feature_type: 'StraightBend' }, { id: 'hole_0', feature_type: 'SimpleHole' }];
    const plate = { ...PLATE, holes: PLATE.holes.map((h, i) => ({ ...h, faceIds: [40 + i] })) };
    const fluid = route(input(plate, { catalog: realHydroformingCatalog(), graphFeatures: graph }), 'fluid-cell');
    const [blankLine, pressLine] = fluid.lines;
    expect(blankLine.catalogOperations?.map((o) => `${o.operations[0]} // ${o.featureType} x${o.count}`)).toEqual(['Blanking // Blank x1', 'Piercing // SimpleHole x2']);
    expect(blankLine.featureBreakdown?.[0]).toMatchObject({ name: 'Blanking // Blank', featureIds: ['blank_0'] });
    expect(pressLine.catalogOperations?.[0]).toMatchObject({ operations: ['Fluid Cell Forming'], featureType: 'StraightBend', featureIds: ['bend_0'] });
    expect(pressLine.featureBreakdown?.find((o) => o.name.startsWith('Loading'))?.featureIds).toEqual(['bend_0', 'hole_0']);
  });
});

describe('a part that is not one sheet (the user\'s limits, 2026-11-21: refused above 2x, warned above 1.25x)', () => {
  // The real parts' volumes and the sheet the cad-engine measured on them.
  const measured = (developedAreaMm2: number) => ({ ...PLATE, developedAreaMm2 });

  it('a sheet part (its volume about its developed area x thickness) passes', () => {
    expect(sheetMeasure(CUP, 1, CUP_AREA * 1.02)).toMatchObject({ refuse: null, warn: null });
  });

  it('a machined block measured as a thin sheet is refused, naming both causes (R_M-0230-032 LEAD NUT HOUSING: 7.3x; FusionComponent: 4.7x)', () => {
    const housing = sheetMeasure(measured(756.8), 1, 5506.91);
    expect(housing?.ratio).toBeCloseTo(7.28, 2);
    expect(housing?.refuse).toBe("the part is not hydroformed from one sheet: the cad-engine found 14 % of the part's 5,507 mm³ as a 1 mm sheet (757 mm² developed, 7.28x); it is not a sheet part, or its sheet was not all measured (a curved sheet of B-spline faces is not found)");
    expect(sheetMeasure(measured(88.4), 5, 2055.51)?.refuse).toMatch(/^the part is not hydroformed from one sheet/);
  });

  it('a part partly sheet is quoted with a warning (Cannula Holder bottom: 1.57x); no volume, no check', () => {
    const cannula = sheetMeasure(measured(2051), 3.5, 11274.25);
    expect(cannula).toMatchObject({ refuse: null });
    expect(cannula?.warn).toMatch(/^Not all of the part is sheet: the cad-engine found 64 % of the part's 11,274 mm³ as a 3.5 mm sheet/);
    expect(sheetMeasure(PLATE, 1.5, null)).toBeNull();
  });
});

describe('the part as the cad-engine measures it (hf_v1)', () => {
  it('is read from the summary in its own keys', () => {
    const { part } = hydroformPart({
      version: 'hf_v1', forming_depth_mm: 60, plan: { length_mm: 80, width_mm: 80, min_width_mm: 80 }, projected_area_mm2: 5026.5, developed_area_mm2: CUP_AREA,
      main_surface: { area_mm2: 0, perimeter_mm: 0 },
      drawn: { depth_mm: 60, opening_width_mm: 80, form_projected_area_mm2: 5026.5, form_developed_area_mm2: CUP_AREA },
      blank: { method: 'drawn_equal_area', area_mm2: CUP_AREA, perimeter_mm: Math.PI * CUP_D0, length_mm: CUP_D0, width_mm: CUP_D0, circumscribed_diameter_mm: CUP_D0, outline_points_mm: null, pierced_hole_area_mm2: 0, pierced_hole_perimeter_mm: 0 },
      flanges: [{ kind: 'curved', angle_deg: 90, length_mm: 10, height_mm: null, edge_radius_mm: null }], holes: [{ feature_type: 'SimpleHole', diameter_mm: 6, perimeter_mm: 18.8, area_mm2: 28.3, in_flat: false }],
    });
    expect(part).toMatchObject({ depthMm: 60, drawn: { openingWidthMm: 80 }, blank: { method: 'drawn_equal_area' }, holes: [{ inFlat: false }] });
    expect(part?.flanges).toHaveLength(1);
  });

  it('is read from feature_graph.summary.hydroformGeometry as Refresh analysis writes it (top-level keys camelCase, the objects inside snake_case)', () => {
    const { part, missing } = hydroformPart({
      extractionVersion: 'hf_v1', normal: [0, 0, 1], formingDepthMm: 21.5, plan: { length_mm: 200, width_mm: 100, min_width_mm: 100 },
      projectedAreaMm2: 20000, developedAreaMm2: 28000, mainSurface: { area_mm2: 20000, perimeter_mm: 600 }, drawn: null,
      blank: { method: 'true_unfold', area_mm2: 28000, perimeter_mm: 680, length_mm: 200, width_mm: 140, circumscribed_diameter_mm: 244.1, outline_points_mm: [[0, 0], [200, 0], [200, 140], [0, 140]], pierced_hole_area_mm2: 157.1, pierced_hole_perimeter_mm: 62.8 },
      flanges: [{ kind: 'straight', angle_deg: 90, length_mm: 200, height_mm: 20, edge_radius_mm: null }],
      holes: [{ feature_type: 'SimpleHole', diameter_mm: 10, perimeter_mm: 31.4, area_mm2: 78.5, in_flat: true, on_main_surface: true, edge_distance_mm: 10 }],
    });
    expect(missing).toEqual([]);
    expect(part).toMatchObject({
      depthMm: 21.5, planLengthMm: 200, planWidthMm: 100, developedAreaMm2: 28000, mainSurface: { areaMm2: 20000 }, drawn: null,
      blank: { method: 'true_unfold', piercedHoleAreaMm2: 157.1 }, holes: [{ onMainSurface: true, edgeDistanceMm: 10, faceIds: [] }],
    });
    expect(part?.blank.outlinePointsMm).toHaveLength(4);
  });

  it('a value the current measurement left null is named as not measurable (analysing again gives the same), never as "press Refresh analysis"', () => {
    const base = {
      extractionVersion: 'hf_v1', formingDepthMm: 21.5, plan: { length_mm: 200, width_mm: 100 }, projectedAreaMm2: 20000, developedAreaMm2: 28000,
      mainSurface: { area_mm2: 20000, perimeter_mm: 600 }, drawn: null, flanges: [], holes: [],
    };
    const several = hydroformPart({ ...base, blank: null });
    expect(several.part).toBeNull();
    expect(several.missing).toEqual(['the blank (a part of several bodies, or bends the unfold could not lay flat): the cad-engine could not measure it on this part']);
    // The unfold declined the outline: the part is still costed; only the blanking force goes unchecked, and the holes and flanges not measured are said.
    const declined = hydroformPart({
      ...base, holes: null, flanges: null,
      blank: { method: 'true_unfold', area_mm2: 28000, perimeter_mm: null, length_mm: 200, width_mm: 140, circumscribed_diameter_mm: null, outline_points_mm: null },
    });
    expect(declined.part?.blank).toMatchObject({ perimeterMm: null, circumscribedDiameterMm: Math.hypot(200, 140) });
    expect(declined.part?.unmeasured).toEqual([
      "the blank's outline (its cut length), so the blanking press's force is not checked",
      'the holes, so none is pierced and no capping tool is costed',
      'the flanges, so no hand adjusting is costed',
    ]);
  });

  it('a blank with no outline is still blanked: the Offline Blank line is costed with no force check', () => {
    const plate = { ...PLATE, blank: { ...PLATE.blank, perimeterMm: null } };
    const r = route(input(plate), 'fluid-cell');
    expect(r.lines.find((l) => l.process === 'Offline Blank')?.physicsGap ?? null).toBeNull();
    expect(r.complete).toBe(true);
  });
});

describe('the summary and the route comparison', () => {
  const inp = input(PLATE);
  const routes = routesOf(inp);
  const rule = hydroformingRule(ref, PLATE);
  const { route: quoted, note } = chooseHydroformingRoute(routes, rule, null);
  const result: HydroformingCostResult = { route: quoted, routes, rule, part: PLATE, nest: NEST, note, missing: [], warnings: [] };
  const summary = buildHydroformingCostSummary({
    hydroforming: result, materialGrade: MILD_STEEL.name, materialCostPerKg: 1.75, materialSource: 'db', batchSize: 100, warnings: [], ratesSource: 't',
    scenario: { partsPerTray: null, intensifier: false },
  }) as CostSummaryResponseDto;

  it("quotes memory's Fluid Cell route with the nest Apply's material record holds", () => {
    expect(summary.hydroforming).toMatchObject({ route: 'fluid-cell', rule: { route: 'fluid-cell', basis: 'part' }, holes: { pierced: 2, inFormedWalls: 0 }, cappingTools: 1 });
    expect(summary.blankSpec).toMatchObject({ form: 'sheet', grossWeightKg: 0.2, partsPerSheet: 50 });
    expect(summary.totalCost).toBeCloseTo(quoted!.totalUsd!, 2);
    expect(summary.hydroformingTooling?.[0]?.costUsd).toBeCloseTo(quoted!.tooling[0].investmentUsd!, 2);
  });

  it('its route is feasible in the comparison; the other is not a route for this quote', () => {
    expect(hydroformingRouteFor('fluid-cell', summary)).toMatchObject({ routeId: 'hydroform-fluid-cell', isFeasible: true, processFamily: 'forming' });
    expect(hydroformingRouteFor('deep-draw', summary)).toMatchObject({ routeId: 'hydroform-deep-draw', isFeasible: false, totalCost: null });
  });
});

describe('the blank nest when the true-shape nest cannot run', () => {
  it('fits rectangles in the better orientation, spacing between them and margin at the edges', () => {
    // 2438.4 x 1219.2 sheet, 200 x 140 blanks, 20 mm apart, 2.25 mm margin: 11 x 7 along the length, or 15 x 5 turned.
    expect(rectangleNest({ lengthMm: 2438.4, widthMm: 1219.2 }, { lengthMm: 200, widthMm: 140 }, 20, 2.25)).toBe(Math.max(11 * 7, 15 * 5));
  });
});
