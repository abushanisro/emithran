// The Part Assembly service on the real memory/Part Assembly data, with the database stood in for by what it would return: a weldment's
// components (its BOM children, or the part itself), its weld table from the Cost Guide, its plate and material, the route quoted, and the
// location's currency.
import { allPartAssemblyMachines, must, realPartAssemblyReference } from './part-assembly-test-data';
import { partAssemblyCalculatorsByName } from '../../../../../modules/bom-items/costing/part-assembly/calculators/part-assembly-calculator-spec';
import { PartAssemblyCostService, type PartAssemblyCostRequest } from '../../../../../modules/bom-items/costing/part-assembly/part-assembly-cost.service';

import type { BOMItemResponseDto } from '../../../../../modules/bom-items/dto/bom-item-response.dto';

/** A raw_materials read that finds `cutCode` for any material (none when null). */
const rawMaterials = (cutCode: number | null) => ({
  from: () => {
    const q = { select: () => q, or: () => q, not: () => q, order: () => q, limit: () => Promise.resolve({ data: cutCode == null ? [] : [{ cut_code: cutCode }], error: null }) };
    return q;
  },
});
function service(over: { machines?: object; calculators?: object; reference?: boolean } = {}): PartAssemblyCostService {
  const s = new PartAssemblyCostService(
    {} as never,
    { getMachinesByClass: () => Promise.resolve(over.machines ?? allPartAssemblyMachines()) } as never,
    { loadPartAssemblyCalculators: () => Promise.resolve(over.calculators ?? partAssemblyCalculatorsByName()) } as never,
  );
  s.reference = () => Promise.resolve(over.reference === false
    ? { reference: null, missing: ['the memory/Part Assembly reference data (2026-PartAssembly) is not staged'] }
    : { reference: realPartAssemblyReference(), missing: [] });
  return s;
}
const STEEL = 'Steel, Cold Worked, AISI 1020';
const bracket = (id: string, over: object = {}) => ({
  id, name: `Bracket ${id}`, quantity: 1, weight: 1.5, maxLength: 300, maxWidth: 80, maxHeight: 3, sheetThicknessMm: 3, materialGrade: STEEL, featureGraph: null, ...over,
}) as unknown as BOMItemResponseDto;
const frame = { id: 'frame', name: 'Frame', quantity: 1, featureGraph: null } as unknown as BOMItemResponseDto;
const WELDS = [
  { id: 'f1', process: 'MIG Welding', operation: 'Fillet Welding', feature: 'Edge', count: 2, lengthMm: 300, grind: true },
  { id: 's1', process: 'Spot Welding', operation: 'Spot Welding', feature: 'Blank', count: 8 },
  { id: 'l1', process: 'Laser Seam Welding', operation: 'Laser Seam Welding', feature: 'Edge', lengthMm: 200 },
];
const request = (over: Partial<PartAssemblyCostRequest> = {}): PartAssemblyCostRequest => ({
  client: rawMaterials(1) as never, accessToken: 't', location: 'USA', item: frame, children: [bracket('a'), bracket('b')],
  overrides: { processGroup: 'Part Assembly', partAssemblyWelds: WELDS }, batchSize: 25, usdToLocal: 1,
  costContext: { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 }, ...over,
});

describe('a weldment of two steel brackets', () => {
  it('welds its BOM children: their gauge is the plate, their material and its cut code family the laser\'s data, the cheapest route quoted', async () => {
    const r = await service().price(request());
    expect(r.components.map((c) => [c.name, c.massKg])).toEqual([['Bracket a', 1.5], ['Bracket b', 1.5]]);
    expect(r.weldment.massKg).toBe(3);
    // Its material is its brackets', each in the BOM roll-up.
    expect(r.materialOfParts).toBe(true);
    expect(r.thickness).toEqual({ mm: 3, source: 'the components\' sheet thickness, 3 mm' });
    expect(r.material).toEqual({ name: STEEL, cutCodeFamily: '1' });
    expect(r.routes.map((x) => [x.key, x.complete])).toEqual([['manual', true], ['robotic', true]]);
    const cheapest = [...r.routes].sort((a, b) => must(a.totalUsd, a.key) - must(b.totalUsd, b.key))[0];
    expect(r.route?.key).toBe(cheapest.key);
    expect(r.note).toContain('Cheapest route');
    expect(r.missing).toEqual([]);
  });

  it('prices the route the Cost Guide sets, or the one the route comparison asks for', async () => {
    expect((await service().price(request({ overrides: { partAssemblyWelds: WELDS, partAssemblyRoute: 'robotic' } }))).route?.key).toBe('robotic');
    expect((await service().price(request({ forceRoute: 'manual', overrides: { partAssemblyWelds: WELDS, partAssemblyRoute: 'robotic' } }))).route?.key).toBe('manual');
  });

  it('in India the same route in rupees: each line, the wire and the total at the rate', async () => {
    const usd = must((await service().price(request({ forceRoute: 'manual' }))).route, 'the USD route');
    const inr = must((await service().price(request({ forceRoute: 'manual', usdToLocal: 88 }))).route, 'the INR route');
    expect(inr.totalUsd).toBeCloseTo(must(usd.totalUsd, 'the USD total') * 88, 0);
    expect(inr.wireUsd).toBeCloseTo(usd.wireUsd * 88, 6);
    expect(inr.lines.map((l) => l.cycleTimeMin)).toEqual(usd.lines.map((l) => l.cycleTimeMin));
    // The MIG wire, the line's other charge, in rupees beside its USD figure: what the applied record stores in the row's currency.
    const mig = must(inr.lines.find((l) => l.process === 'Manual MIG Welding'), 'the MIG line');
    expect(mig.otherCostPerPart).toBeCloseTo(must(mig.otherCostPerPartUsd, 'its wire') * 88, 4);
  });

  it('a weld row it cannot read is reported, not costed', async () => {
    const r = await service().price(request({ overrides: { partAssemblyWelds: [...WELDS, { process: 'Gas Welding' }] } }));
    expect(r.welds).toHaveLength(3);
    expect(r.warnings.some((w) => w.includes('Gas Welding'))).toBe(true);
  });
});

describe('a part set to Part Assembly with no parts under it in the BOM', () => {
  it('is the one component, loaded and welded at its own gauge; its material is not priced here', async () => {
    const r = await service().price(request({ item: bracket('self', { name: 'Tab' }), children: [] }));
    expect(r.components.map((c) => [c.name, c.quantity, c.massKg])).toEqual([['Tab', 1, 1.5]]);
    // Its own one component: its material record is its own.
    expect(r.materialOfParts).toBe(false);
    expect(r.thickness.mm).toBe(3);
    expect(r.warnings[0]).toContain('Tab has no parts under it in the BOM');
    expect(r.route?.complete).toBe(true);
  });
});

describe('what it cannot price, it names', () => {
  it('no welds in the weld table', async () => {
    const r = await service().price(request({ overrides: { processGroup: 'Part Assembly' } }));
    expect(r.route).toBeNull();
    expect(r.missing).toEqual(['the weldment has no welds: add them to the weld table in the Cost Guide']);
  });

  it('the reference data, the calculators or the location\'s machines not in the database', async () => {
    expect((await service({ reference: false }).price(request())).missing[0]).toContain('2026-PartAssembly');
    expect((await service({ calculators: {} }).price(request())).missing[0]).toContain('run migration 1100');
    expect((await service({ machines: {} }).price(request({ location: 'Mexico' }))).missing).toEqual(['HR Rates has no Part Assembly machines for Mexico']);
  });

  it('a material with no cut code: the laser seam is a named gap, the rest is costed', async () => {
    const r = await service().price(request({ client: rawMaterials(null) as never, forceRoute: 'manual' }));
    expect(r.material.cutCodeFamily).toBeNull();
    expect(r.route?.complete).toBe(false);
    const lines = must(r.route, 'the manual route').lines;
    const gaps = lines.filter((l) => l.physicsGap).map((l) => [l.process, (l.physicsGap as { reason: string }).reason]);
    expect(gaps).toEqual([['Laser Seam Welding', `Laser Seam Welding 3: the weldment's material cut code family (${STEEL}), for laserSeamWeldTravelSpeed`]]);
    expect(lines.filter((l) => !l.physicsGap).map((l) => l.process)).toEqual(['Manual MIG Welding', 'Manual Spot Welding', 'Grinding']);
  });

  it('components of different gauges leave the plate to each weld', async () => {
    const r = await service().price(request({ children: [bracket('a'), bracket('b', { sheetThicknessMm: 4 })], forceRoute: 'manual' }));
    expect(r.thickness).toEqual({ mm: null, source: 'the components are 3, 4 mm: set each weld\'s thickness' });
    expect(r.route?.complete).toBe(false);
  });
});
