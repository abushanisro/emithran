// The Part Assembly engine on the real memory/Part Assembly data: the weld table, the weld geometry, the routes (one line per weld process,
// load and unload by weight, prep and finishing along the flagged welds, gaps named), the quoted route and its summary.
import { join } from 'path';

import { allPartAssemblyMachines, must, readCsv, realPartAssemblyReference } from './part-assembly-test-data';
import { componentOf } from '../../../../../modules/bom-items/costing/assembly/assembly-joints';
import { machineValue } from '../../../../../modules/bom-items/costing/casting/sand/sand-machines';
import { loadPartAssemblyCalculatorSpec, partAssemblyCalculatorsByName } from '../../../../../modules/bom-items/costing/part-assembly/calculators/part-assembly-calculator-spec';
import { buildPartAssemblyCostSummary } from '../../../../../modules/bom-items/costing/part-assembly/part-assembly-cost-summary';
import { weldmentMaterial, weldmentThickness, type PartAssemblyCostResult } from '../../../../../modules/bom-items/costing/part-assembly/part-assembly-cost.service';
import {
  bevelRow, buildPartAssemblyRoutes, choosePartAssemblyRoute, laserFamilyOf, laserRow, type PartAssemblyRoute, type PartAssemblyRouteInput,
} from '../../../../../modules/bom-items/costing/part-assembly/part-assembly-route';
import { partAssemblyRouteFor } from '../../../../../modules/bom-items/costing/part-assembly/part-assembly-route-comparison';
import { WELD_OPERATIONS, weldTable } from '../../../../../modules/bom-items/costing/part-assembly/part-assembly-welds';
import { JOINT_TYPE, minimumFilletLegMm, spotsOf, weldMetal } from '../../../../../modules/bom-items/costing/part-assembly/weld-geometry';

import type { CostSummaryResponseDto, ProcessLineCost } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';


const ZERO = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
const ref = realPartAssemblyReference();
const machines = allPartAssemblyMachines();
// Two 3 mm steel brackets of 1.5 kg welded together: a fillet each side (2 x 300 mm, ground and brushed), 8 spots and a 200 mm laser seam.
const BRACKET = (id: string) => componentOf({ id, name: `Bracket ${id}`, quantity: 1, weight: 1.5, maxLength: 300, maxWidth: 80, maxHeight: 3, featureGraph: null });
const COMPONENTS = [BRACKET('a'), BRACKET('b')];
const WELDS = [
  { id: 'f1', process: 'MIG Welding', operation: 'Fillet Welding', feature: 'Edge', count: 2, lengthMm: 300, grind: true, wireBrush: true },
  { id: 's1', process: 'Spot Welding', operation: 'Spot Welding', feature: 'Blank', count: 8 },
  { id: 'l1', process: 'Laser Seam Welding', operation: 'Laser Seam Welding', feature: 'Edge', lengthMm: 200 },
];
const input = (welds: unknown[] = WELDS, over: Partial<PartAssemblyRouteInput> = {}): PartAssemblyRouteInput => ({
  ref, spec: loadPartAssemblyCalculatorSpec(), calculators: partAssemblyCalculatorsByName(), components: COMPONENTS, welds: weldTable(welds).welds,
  weldment: { massKg: 3 }, thickness: { mm: 3, source: 'the components\' sheet thickness, 3 mm' }, material: { name: 'Steel, Cold Worked, AISI 1020', cutCodeFamily: '1' },
  machinesByClass: machines, batchSize: 25, costContext: ZERO, ...over,
});
const routeOf = (key: string, welds: unknown[] = WELDS, over: Partial<PartAssemblyRouteInput> = {}): PartAssemblyRoute => {
  const r = buildPartAssemblyRoutes(input(welds, over)).routes.find((x) => x.key === key);
  if (!r) throw new Error(`no ${key} route`);
  return r;
};
const sec = (l: ProcessLineCost | undefined) => (l?.cycleTimeMin ?? 0) * 60;
/** A cycle of `s` seconds as a line stores it: minutes to 3 decimals (casting-finishing's rounding contract). */
const stored = (s: number) => (Math.round((s / 60) * 1000) / 1000) * 60;
const line = (r: PartAssemblyRoute, process: string) => r.lines.find((l) => l.process === process && !l.physicsGap);
const gapsOf = (r: PartAssemblyRoute) => r.lines.filter((l) => l.physicsGap).map((l) => `${l.process}: ${(l.physicsGap as { reason?: string }).reason ?? ''}`);
const stepValue = (l: ProcessLineCost | undefined, field: string) => l?.calculationTrace?.find((s) => s.fieldName === field || s.groupField === field)?.value;

describe('the weld table', () => {
  it('offers exactly the operations memory/Part Assembly gives each weld process (manual and robotic alike)', () => {
    const ops = readCsv(join(__dirname, '../../../../../../../memory/Part Assembly/operations_welding_group.csv')).rows.map((r) => String(r['Process Name']));
    const of = (process: string) => ops.filter((o) => o.startsWith(`${process}:`)).map((o) => o.slice(process.length + 1)).sort();
    const ours = (kind: keyof typeof WELD_OPERATIONS) => WELD_OPERATIONS[kind].map((o) => `${o.operation}//${o.feature}`).sort();
    expect(of('Manual MIG Welding')).toEqual(ours('MIG Welding'));
    expect(of('Robotic MIG Welding')).toEqual(ours('MIG Welding'));
    expect(of('Manual Spot Welding')).toEqual(ours('Spot Welding'));
    expect(of('Robotic Spot Welding')).toEqual(ours('Spot Welding'));
    expect(of('Laser Seam Welding')).toEqual(ours('Laser Seam Welding'));
    for (const o of WELD_OPERATIONS['MIG Welding']) expect(JOINT_TYPE[o.operation]).toBeDefined();
  });

  it('reads each row defensively and reports one it cannot use', () => {
    const { welds, ignored } = weldTable([...WELDS, { process: 'Gas Welding' }, { process: 'MIG Welding', operation: 'Fillet Welding', feature: 'Blank' }, 'x']);
    expect(welds.map((w) => [w.id, w.label, w.count])).toEqual([['f1', 'Fillet Welding 1', 2], ['s1', 'Spot Welding 2', 8], ['l1', 'Laser Seam Welding 3', null]]);
    expect(ignored).toHaveLength(3);
  });
});

describe('the weld geometry', () => {
  it('defaults a fillet to the AWS D1.1 minimum for its plate, and takes a leg or area set on the weld', () => {
    expect([3, 6, 6.1, 12, 20, 25].map(minimumFilletLegMm)).toEqual([3, 3, 5, 5, 6, 8]);
    expect(weldMetal({ operation: 'Fillet Welding', count: 2, lengthMm: 300, sizeMm: null, areaMm2: null }, 3, 6)).toMatchObject({ areaMm2: 4.5, lengthMm: 600, welds: 2, tacked: true });
    expect(weldMetal({ operation: 'Fillet Welding', count: 1, lengthMm: 100, sizeMm: 6, areaMm2: null }, 3, 6)).toMatchObject({ areaMm2: 18 });
    expect(weldMetal({ operation: 'J-Groove Welding', count: 1, lengthMm: 100, sizeMm: null, areaMm2: 40 }, 10, 6)).toMatchObject({ areaMm2: 40 });
  });

  it('a V (60 deg), bevel (45 deg) or square groove through the plate at a 2 mm gap; a plug fills its hole to the plate thickness', () => {
    const area = (operation: string, t: number) => {
      const m = weldMetal({ operation, count: 1, lengthMm: 100, sizeMm: null, areaMm2: null }, t, 6);
      return 'areaMm2' in m ? m.areaMm2 : null;
    };
    expect(area('V-Groove Welding', 10)).toBeCloseTo(100 * Math.tan(Math.PI / 6) + 20, 9);
    expect(area('Bevel Groove Welding', 10)).toBeCloseTo(50 + 20, 9);
    expect(area('Square Groove Welding', 3)).toBeCloseTo(6, 9);
    expect(weldMetal({ operation: 'Plug Welding', count: 4, lengthMm: null, sizeMm: null, areaMm2: null }, 3, 6))
      .toMatchObject({ areaMm2: (Math.PI * 11 * 11) / 4, lengthMm: 12, welds: 4, tacked: false });
    expect(weldMetal({ operation: 'Tack Welding', count: 5, lengthMm: null, sizeMm: null, areaMm2: null }, 3, 6)).toMatchObject({ lengthMm: 30, tacked: false });
  });

  it('names what a joint with no default shape, or no length, lacks', () => {
    expect(weldMetal({ operation: 'J-Groove Welding', count: 1, lengthMm: 100, sizeMm: null, areaMm2: null }, 10, 6)).toEqual({ missing: 'its cross-section (area): a j-groove joint has no default shape' });
    expect(weldMetal({ operation: 'Fillet Welding', count: 1, lengthMm: null, sizeMm: null, areaMm2: null }, 3, 6)).toEqual({ missing: 'its length' });
  });

  it('spots: the count, else the length at a pitch of 10 x the sheet', () => {
    expect(spotsOf({ count: 8, lengthMm: null }, null)).toMatchObject({ spots: 8 });
    expect(spotsOf({ count: null, lengthMm: 300 }, 1.5)).toMatchObject({ spots: 20 });
    expect(spotsOf({ count: null, lengthMm: 300 }, null)).toHaveProperty('missing');
  });
});

describe('the weldment\'s plate thickness and material', () => {
  it('the components\' gauge when they agree, else the weldment\'s own; its material, else its components\' when they share one', () => {
    expect(weldmentThickness({}, [{ name: 'a', sheetThicknessMm: 3 }, { name: 'b', sheetThicknessMm: 3 }]).mm).toBe(3);
    expect(weldmentThickness({ sheetThicknessMm: 2 }, [{ name: 'a', sheetThicknessMm: 3 }, { name: 'b', sheetThicknessMm: 4 }]).mm).toBeNull();
    expect(weldmentThickness({ sheetThicknessMm: 2 }, []).mm).toBe(2);
    expect(weldmentMaterial({}, COMPONENTS)).toBeNull();
    expect(weldmentMaterial({}, COMPONENTS.map((c) => ({ ...c, material: 'Steel' })))).toBe('Steel');
    expect(weldmentMaterial({ materialGrade: 'Aluminum, 5052' }, [])).toBe('Aluminum, 5052');
  });
});

describe('the manual route', () => {
  const r = routeOf('manual');

  it('is complete: MIG, spot and laser seam welding, then grinding and brushing along the fillets', () => {
    expect(r.complete).toBe(true);
    expect(r.lines.map((l) => l.process)).toEqual(['Manual MIG Welding', 'Manual Spot Welding', 'Laser Seam Welding', 'Grinding', 'Wire Brushing']);
    expect(r.lines.every((l) => l.calculatorId && l.calculationTrace?.length)).toBe(true);
  });

  it('MIG: the fillets\' metal at the chosen welder\'s deposition, tacked, with the components loaded (2 x 11 s) and the weldment unloaded (15 s)', () => {
    const mig = must(line(r, 'Manual MIG Welding'), 'the MIG line');
    const m = must(machines.part_assembly_manual_mig_welding.find((x) => x.name === mig.machineName), 'its welder');
    const deposition = must(machineValue(m, 'wire_feed_rate_mm_s'), 'its wire feed') * (Math.PI * must(machineValue(m, 'wire_diameter_mm'), 'its wire') ** 2 / 4) * 0.5;
    const arc = (600 * 4.5 / deposition) * 1.32;
    const tack = (600 / 100) * 6 * 4.5 / deposition;
    expect(sec(mig)).toBeCloseTo(stored(arc + tack + (2 * 2 + arc * 0.05) + 22 + 15), 6);
    expect(stepValue(mig, 'Load Time')).toBe(22);
    expect(stepValue(mig, 'Weld Metal Area')).toBe(4.5);
    expect(mig.calculationTrace?.find((s) => s.fieldName === 'Weld Metal Area')?.source).toContain('AWS D1.1 minimum fillet for 3 mm plate');
    expect(r.wireUsd).toBeGreaterThan(0);
  });

  it('spot: 8 x (0.96 + 2) s, the weldment loaded as one piece (11 s) and unloaded (15 s)', () => {
    expect(sec(line(r, 'Manual Spot Welding'))).toBeCloseTo(stored(8 * 2.96 + 11 + 15), 6);
  });

  it('laser seam: 200 mm at the 3 mm / 2500 W speed of the steel family, read as cm/s, plus 30 + 15 + 15 s', () => {
    const speed = Number(laserRow(ref, '1', 2500, 3)?.['Travel Speed']);
    expect(speed).toBe(8.25);
    expect(sec(line(r, 'Laser Seam Welding'))).toBeCloseTo(stored(200 / (speed * 10) + 60), 6);
  });

  it('grinding and brushing along the 600 mm of fillet at 10 and 5 mm/s', () => {
    expect(sec(line(r, 'Grinding'))).toBeCloseTo(stored(60), 6);
    expect(sec(line(r, 'Wire Brushing'))).toBeCloseTo(stored(120), 6);
  });
});

describe('the robotic route and the route quoted', () => {
  it('robots weld the MIG and spot welds, each program shared by the batch; the laser is the same on both', () => {
    const r = routeOf('robotic');
    expect(r.lines.map((l) => l.process)).toEqual(['Robotic MIG Welding', 'Robotic Spot Welding', 'Laser Seam Welding', 'Grinding', 'Wire Brushing']);
    expect(stepValue(line(r, 'Robotic Spot Welding'), 'Programming Per Part')).toBeCloseTo(8 * 300 / 25, 9);
    expect(sec(line(r, 'Laser Seam Welding'))).toBeCloseTo(sec(line(routeOf('manual'), 'Laser Seam Welding')), 9);
  });

  it('quotes the cheapest complete route unless one is set; laser-only welds have no robotic route', () => {
    const { routes, gaps } = buildPartAssemblyRoutes(input());
    const cheapest = [...routes].sort((a, b) => must(a.totalUsd, a.key) - must(b.totalUsd, b.key))[0];
    expect(choosePartAssemblyRoute(routes, gaps, null).route?.key).toBe(cheapest.key);
    expect(choosePartAssemblyRoute(routes, gaps, 'robotic').route?.key).toBe('robotic');
    const laserOnly = buildPartAssemblyRoutes(input([WELDS[2]]));
    expect(laserOnly.routes.map((x) => x.key)).toEqual(['manual']);
    expect(laserOnly.gaps[0]?.reason).toContain('no MIG or spot weld');
  });
});

describe('what cannot be timed is named, never assumed', () => {
  it('a weld with no welds at all, a J-groove with no area, a fillet with no length', () => {
    expect(buildPartAssemblyRoutes(input([])).missing[0]).toContain('no welds');
    const r = routeOf('manual', [...WELDS, { id: 'j', process: 'MIG Welding', operation: 'J-Groove Welding', lengthMm: 100 }, { id: 'n', process: 'MIG Welding', operation: 'Fillet Welding' }]);
    expect(r.complete).toBe(false);
    expect(r.totalUsd).toBeNull();
    expect(gapsOf(r)).toEqual([
      'Manual MIG Welding: J-Groove Welding 4: its cross-section (area): a j-groove joint has no default shape',
      'Manual MIG Welding: Fillet Welding 5: its length',
    ]);
    // The other welds are still costed on their line.
    expect(sec(line(r, 'Manual MIG Welding'))).toBeGreaterThan(0);
  });

  it('a component with no weight leaves its load as a named gap', () => {
    const light = [BRACKET('a'), componentOf({ id: 'c', name: 'Clip', quantity: 1, weight: 0, featureGraph: null })];
    expect(gapsOf(routeOf('manual', WELDS, { components: light }))).toContain('Manual MIG Welding: the load time of Clip: no weight (set it in the BOM, or the part\'s material and model)');
  });

  it('bevel cutting: the oxy-fuel speed at the plate depth for steel; another material is named', () => {
    const bevelled = [{ ...WELDS[0], bevel: true }];
    const row = must(bevelRow(ref, 3), 'the 3 mm bevel row');
    const r = routeOf('manual', bevelled);
    expect(sec(line(r, 'Bevel Cutting'))).toBeCloseTo(stored(600 / (Number(row['Cut Speed (mm / min)']) / 60) + 2 * 13), 6);
    expect(gapsOf(routeOf('manual', bevelled, { material: { name: 'Aluminum, 5052', cutCodeFamily: '30' } }))[0]).toContain('oxy-fuel cutting data for carbon steel');
  });

  it('a V or U groove bevels both plates: twice the seam cut, a pierce for each edge; a bevel or J groove one', () => {
    const plate10 = { thickness: { mm: 10, source: 'the components\' sheet thickness, 10 mm' } };
    // J and U grooves have no default shape: their area is the row's.
    const groove = (operation: string) => [{ id: 'g', process: 'MIG Welding', operation, feature: 'Edge', count: 1, lengthMm: 500, bevel: true, ...(/^[JU]-Groove/.test(operation) ? { areaMm2: 60 } : {}) }];
    const speed = Number(must(bevelRow(ref, 10), 'the 10 mm bevel row')['Cut Speed (mm / min)']) / 60;
    const pierce = Number(must(bevelRow(ref, 10), 'the 10 mm bevel row')['Pierce Time (s)']);
    expect(sec(line(routeOf('manual', groove('V-Groove Welding'), plate10), 'Bevel Cutting'))).toBeCloseTo(stored(1000 / speed + 2 * pierce), 6);
    expect(sec(line(routeOf('manual', groove('U-Groove Welding'), plate10), 'Bevel Cutting'))).toBeCloseTo(stored(1000 / speed + 2 * pierce), 6);
    expect(sec(line(routeOf('manual', groove('Bevel Groove Welding'), plate10), 'Bevel Cutting'))).toBeCloseTo(stored(500 / speed + pierce), 6);
    expect(sec(line(routeOf('manual', groove('J-Groove Welding'), plate10), 'Bevel Cutting'))).toBeCloseTo(stored(500 / speed + pierce), 6);
  });
});

describe('the cut code family of the weldment\'s material', () => {
  it('is the cut code\'s whole number, as memory numbers the laser seam families: stainless 5.21 is 5, not the thermoset 52', () => {
    expect(laserFamilyOf(ref, 5.21)).toBe('5');
    expect(laserFamilyOf(ref, 5.2)).toBe('5');
    expect(laserFamilyOf(ref, 1.5)).toBe('1');
    expect(laserFamilyOf(ref, 51.21)).toBe('51');
    expect(laserFamilyOf(ref, 52.13)).toBe('52');
    expect(laserFamilyOf(ref, 99.1)).toBeNull();
    expect(laserFamilyOf(ref, null)).toBeNull();
  });
});

describe('the summary and the route comparison', () => {
  const { routes, gaps } = buildPartAssemblyRoutes(input());
  const { route, note } = choosePartAssemblyRoute(routes, gaps, null);
  const result: PartAssemblyCostResult = {
    materialOfParts: true, route, routes, gaps, components: COMPONENTS, welds: weldTable(WELDS).welds, weldment: { massKg: 3 }, thickness: { mm: 3, source: 's' },
    material: { name: 'Steel', cutCodeFamily: '1' }, note, missing: [], warnings: [],
  };
  const summary = { ...buildPartAssemblyCostSummary({ partAssembly: result, batchSize: 25, warnings: [], ratesSource: 'test' }) } as CostSummaryResponseDto;

  it('the welding only: each weld\'s share, the options, the deposition disclosed', () => {
    expect(summary.family).toBe('part_assembly');
    expect(summary.materialCost).toBe(0);
    expect(summary.materialOfParts).toBe(true);
    expect(summary.partAssembly?.welds.find((w) => w.id === 'f1')?.cycleSec).toBeGreaterThan(0);
    expect(summary.partAssembly?.options.map((o) => o.route)).toEqual(['manual', 'robotic']);
    expect(summary.warnings.some((w) => w.includes('arcEfficency (0.5)'))).toBe(true);
  });

  it('each route is the summary priced on it, under its own id', () => {
    const key = must(route, 'the quoted route').key;
    const r = partAssemblyRouteFor(key, summary);
    expect(r.routeId).toBe(`partassembly-${key}`);
    expect(r.isFeasible).toBe(true);
    expect(partAssemblyRouteFor(key === 'manual' ? 'robotic' : 'manual', summary).isFeasible).toBe(false);
  });
});
