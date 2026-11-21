import { assemblyCalculatorsByName } from '../../../../../modules/bom-items/costing/assembly/calculators/assembly-calculator-spec';
import { AssemblyCostService, type AssemblyCostRequest } from '../../../../../modules/bom-items/costing/assembly/assembly-cost.service';
import { componentOf } from '../../../../../modules/bom-items/costing/assembly/assembly-joints';
import type { BOMItemResponseDto } from '../../../../../modules/bom-items/dto/bom-item-response.dto';
import { allAssemblyMachines, realAssemblyReference } from './assembly-test-data';

// The service on the real memory/Assembly data, with the database stood in for by what it would return.
function service(): AssemblyCostService {
  const s = new AssemblyCostService(
    {} as never,
    { getMachinesByClass: () => Promise.resolve(allAssemblyMachines()) } as never,
    { loadAssemblyCalculators: () => Promise.resolve(assemblyCalculatorsByName()) } as never,
  );
  s.reference = () => Promise.resolve({ reference: realAssemblyReference(), missing: [] });
  return s;
}
// Cannula Holder Left as the BOM holds it: analysed, with ten threaded holes (M4 x5, M3 x3, M2.5 x2), and no parts under it.
const threaded = (id: string, spec: string, n: number) => ({ id, feature_type: 'SimpleHole', variant: 'threaded', occurrences: Array.from({ length: n }, () => ({ spec })) });
const holder = {
  id: 'holder', name: 'Cannula Holder Left', quantity: 1, weight: 0.041, volume: 15075.73, materialGrade: 'Aluminum, ANSI 1050A',
  maxLength: 80.3, maxWidth: 65.5, maxHeight: 22.5,
  featureGraph: { feature_graph_v2: { features: [threaded('m4', 'M4×0.7', 5), threaded('m3', 'M3×0.5', 3), threaded('m25', 'M2.5×0.45', 2)] } },
} as unknown as BOMItemResponseDto;
const request = (over: Partial<AssemblyCostRequest>): AssemblyCostRequest => ({
  client: {} as never, accessToken: 't', location: 'USA', item: holder, children: [], overrides: { processGroup: 'Assembly' }, batchSize: 250, usdToLocal: 1,
  costContext: { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 }, ...over,
});

describe('a component\'s mass', () => {
  it('is its BOM weight; else its volume at its material\'s density; else unknown', () => {
    expect(componentOf({ id: 'a', name: 'A', weight: 0.5, volume: 1000 }, 2700)).toMatchObject({ massKg: 0.5, massSource: 'weight' });
    expect(componentOf({ id: 'a', name: 'A', volume: 38354.17, materialGrade: 'Aluminum, 6061' }, 2700)).toMatchObject({ massKg: 0.103556, massSource: 'volume' });
    expect(componentOf({ id: 'a', name: 'A', volume: 38354.17 })).toMatchObject({ massKg: null, massSource: null, volumeMm3: 38354.17 });
  });
});

describe('a part set to Assembly with no parts under it in the BOM', () => {
  it('is the one component: loaded and unloaded, and screwed into its own ten threaded holes', async () => {
    const r = await service().price(request({}));
    expect(r.components.map((c) => [c.name, c.quantity, c.massKg])).toEqual([['Cannula Holder Left', 1, 0.041]]);
    expect(r.joints.map((j) => [j.operation, j.count, j.featureIds])).toEqual([
      ['Screw Tighten - Manual', 5, ['m4']], ['Screw Tighten - Manual', 3, ['m3']], ['Screw Tighten - Manual', 2, ['m25']],
    ]);
    expect(r.route?.complete).toBe(true);
    expect(r.route!.lines.map((l) => l.process)).toEqual(['Pick and Place', 'Pick and Place', 'Mechanical Assembly', 'Mechanical Assembly', 'Mechanical Assembly']);
    expect(r.route!.lines.filter((l) => l.process === 'Mechanical Assembly').map((l) => Math.round(l.cycleTimeMin * 60 * 10) / 10)).toEqual([49, 29.4, 19.6]);
    expect(r.warnings[0]).toContain('has no parts under it in the BOM');
    expect(r.materialOfParts).toBe(false);
  });

  it('points at the part on the page: its load and unload highlight it whole, a screw count its own threaded holes, names stay short', async () => {
    const r = await service().price(request({}));
    const [load, unload, m4] = r.route!.lines;
    expect([load!.actsOnWholePart, unload!.actsOnWholePart]).toEqual([true, true]);
    expect(load!.featureBreakdown!.map((o) => o.name)).toEqual(['Cannula Holder Left ×1']);
    expect(unload!.featureBreakdown!.map((o) => o.name)).toEqual(['Finished assembly ×1']);
    expect(m4!.featureBreakdown!.map((o) => [o.name, o.featureIds])).toEqual([['M4×0.7 screws ×5', ['m4']]]);
    expect(m4!.calculationTrace!.find((t) => t.fieldName === 'Joints')?.ref).toEqual({ kind: 'features', label: 'M4×0.7 screws ×5', features: [{ featureId: 'm4' }] });
    expect(load!.calculationTrace!.find((t) => t.fieldName === 'Quantity')?.ref).toEqual({ kind: 'cad', evidence: 'part_volume' });
  });

  it('other parts\' features are not on the page: an assembly of children names them but points at none', async () => {
    const child = { ...holder, id: 'c' } as unknown as BOMItemResponseDto;
    const r = await service().price(request({ item: { ...holder, id: 'asm', name: 'Asm' } as unknown as BOMItemResponseDto, children: [child] }));
    expect(r.route!.lines.some((l) => l.actsOnWholePart)).toBe(false);
    const m4 = r.route!.lines.find((l) => l.process === 'Mechanical Assembly')!;
    expect(m4.calculationTrace!.find((t) => t.fieldName === 'Joints')?.ref).toBeUndefined();
  });

  it('a child with no weight is weighed by its volume at its material\'s density', async () => {
    const child = { ...holder, id: 'c', name: 'Bracket', weight: undefined, volume: 38354.17, materialGrade: 'Aluminum, 6061', featureGraph: null } as unknown as BOMItemResponseDto;
    const r = await service().price(request({ children: [child], densityOf: (g) => Promise.resolve(g === 'Aluminum, 6061' ? 2700 : null) }));
    expect(r.components[0]).toMatchObject({ massKg: 0.103556, massSource: 'volume' });
    expect(r.materialOfParts).toBe(true);
    expect(r.route?.complete).toBe(true);
  });

  it('a child with neither weight nor material says what to set', async () => {
    const child = { ...holder, id: 'c', name: 'Bracket', weight: undefined, materialGrade: undefined, volume: 38354.17, featureGraph: null } as unknown as BOMItemResponseDto;
    const r = await service().price(request({ children: [child] }));
    const gap = r.route!.lines.find((l) => l.physicsGap)!;
    expect((gap.physicsGap as { reason: string }).reason).toContain('Bracket: its weight: set its material (its 38,354 mm³ at the material\'s density gives it) or its weight in the BOM');
  });
});

describe('every Assembly process of memory/Assembly has an engine', () => {
  // memory/Assembly 'processes (1).csv': every process but No Cost Feature and User-Defined Process (no calculator by definition).
  const COSTED = [
    'Adhesive Bonding', 'Cap Sealing', 'Electron Beam Welding', 'Fay Sealing', 'Fillet Sealing', 'Laser Welding', 'Lock Bolt', 'Manual MIG Welding',
    'Manual Spot Welding', 'Manual TIG Welding', 'Mechanical Assembly', 'Pick and Place', 'Rivet', 'Robotic MIG Welding', 'Robotic Spot Welding',
    'Robotic TIG Welding', 'Threaded Insert', 'Ultrasonic Welding', 'Weld Clean Up', 'Weld Prep',
  ];
  const ALL_JOINTS = [
    { id: 'mig', process: 'MIG Welding', lengthMm: 200, throatMm: 4, prep: true, cleanUp: true },
    { id: 'tig', process: 'TIG Welding', lengthMm: 100, throatMm: 2 },
    { id: 'spot', process: 'Spot Welding', count: 12 },
    { id: 'ebw', process: 'Electron Beam Welding', lengthMm: 150, depthMm: 3 },
    { id: 'laser', process: 'Laser Welding', lengthMm: 150, depthMm: 2 },
    { id: 'us', process: 'Ultrasonic Welding', operation: 'stake', count: 4 },
    { id: 'rivet', process: 'Rivet', count: 8, timeS: 6 },
    { id: 'insert', process: 'Threaded Insert', count: 4 },
    { id: 'bolt', process: 'Lock Bolt', count: 2 },
    { id: 'bond', process: 'Adhesive Bonding', areaMm2: 5000 },
    { id: 'fay', process: 'Fay Sealing', areaMm2: 5000 },
    { id: 'fillet', process: 'Fillet Sealing', lengthMm: 400 },
    { id: 'cap', process: 'Cap Sealing', count: 10 },
  ];

  it('one assembly with every kind of joint is fully costed on both routes, and between them every process is a costed line', async () => {
    const r = await service().price(request({ overrides: { processGroup: 'Assembly', assemblyJoints: ALL_JOINTS } }));
    for (const route of r.routes) expect({ route: route.key, gaps: route.lines.filter((l) => l.physicsGap).map((l) => l.process) }).toEqual({ route: route.key, gaps: [] });
    const costed = new Set(r.routes.flatMap((route) => route.lines.filter((l) => !l.physicsGap && l.totalCost > 0).map((l) => l.process)));
    expect(COSTED.filter((p) => !costed.has(p))).toEqual([]);
  });
});
