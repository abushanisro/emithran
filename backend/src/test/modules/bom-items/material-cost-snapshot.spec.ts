import { InternalServerErrorException } from '@nestjs/common';

import { MaterialCostSnapshotService } from '../../../modules/bom-items/services/material-cost-snapshot.service';

const record = (over: Record<string, unknown> = {}) => ({ id: 'r1', materialName: 'ABS', totalCost: 5, grossUsage: 1.0, netUsage: 0.9, country: 'USA', unitCost: 2, ...over });

function build(active: object[], created: object = { id: 'new', unitCost: 2 }) {
  const costRecords = {
    findAll: jest.fn().mockResolvedValue({ records: active }),
    update: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue(created),
  };
  const materials = { findAll: jest.fn().mockResolvedValue({ items: [{ id: 'm1', material: 'ABS', materialGrade: 'ABS', materialGroup: 'Plastic', densityKgM3: 1050 }] }) };
  return { svc: new MaterialCostSnapshotService(costRecords as never, materials as never), costRecords, materials };
}
const summary = (over: Record<string, unknown> = {}) => ({ grossWeightKg: 1.0, blankSpec: { netWeightKg: 0.9, form: 'sheet' }, materialCostPerKg: 4, usdToDisplayRate: 1, ...over });
const input = (s: object, extra: object = {}) => ({
  item: { id: 'i1', volume: 100000, weight: 0.5, featureGraph: { classification: { family: 'plastic_molded' } } }, grade: 'ABS', location: 'USA', summary: s,
  userId: 'u', organizationId: 'o', token: 't', ...extra,
}) as never;

describe('MaterialCostSnapshotService.ensure', () => {
  it('keeps the active record when the grade, usage and location still agree', async () => {
    const { svc, costRecords } = build([record()]);
    const r = await svc.ensure(input(summary()));
    expect(r).toEqual({ action: 'kept', recordId: 'r1', usage: null });
    expect(costRecords.update).not.toHaveBeenCalled();
    expect(costRecords.create).not.toHaveBeenCalled();
  });

  it('replaces it when the usage has moved more than 1% from the engine\'s (a re-analysis, a new nesting)', async () => {
    const { svc, costRecords } = build([record({ grossUsage: 1.5 })]);
    const r = await svc.ensure(input(summary()));
    expect(r.action).toBe('replaced');
    expect(costRecords.update).toHaveBeenCalledWith('r1', { isActive: false }, 'u', 't');
    expect(costRecords.create).toHaveBeenCalledTimes(1);
  });

  it('replaces it when the Digital Factory changed: the price per kg is the location\'s', async () => {
    const { svc, costRecords } = build([record({ country: 'India' })]);
    expect((await svc.ensure(input(summary()))).action).toBe('replaced');
    expect(costRecords.create).toHaveBeenCalledWith(expect.objectContaining({ country: 'USA', materialName: 'ABS' }), 'u', 't', 'o');
  });

  it('retires every active record before it writes one: a second active record would double the material cost', async () => {
    const { svc, costRecords } = build([record({ id: 'a', materialName: 'PC' }), record({ id: 'b', totalCost: 0 })]);
    await svc.ensure(input(summary()));
    expect(costRecords.update.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
  });

  it('writes nothing when a stale record cannot be retired, and says why', async () => {
    const { svc, costRecords } = build([record({ materialName: 'PC' })]);
    costRecords.update.mockRejectedValue(new Error('locked'));
    await expect(svc.ensure(input(summary()))).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(costRecords.create).not.toHaveBeenCalled();
  });

  it('takes the usage from the engine, links the material row, and asks the service to price it (unitCost 0)', async () => {
    const { svc, costRecords } = build([]);
    const r = await svc.ensure(input(summary({ grossWeightKg: 2, blankSpec: { netWeightKg: 1.5, form: 'sheet' } }), {}));
    expect(r.action).toBe('replaced');
    const dto = costRecords.create.mock.calls[0]![0];
    expect(dto).toMatchObject({ bomItemId: 'i1', materialId: 'm1', materialGroup: 'Plastic', country: 'USA', unitCost: 0, overhead: 5, reclaimRate: 0, isActive: true });
    expect(dto.grossUsage).toBeGreaterThan(0);
    expect(dto.netUsage).toBeGreaterThan(0);
  });

  it('a casting is charged with the metal the casting route buys, not a generic scrap allowance', async () => {
    const { svc, costRecords } = build([]);
    await svc.ensure(input(summary({ grossWeightKg: 0.08, blankSpec: undefined, castingMetal: { partKg: 0.039, chargedKg: 0.041 } })));
    expect(costRecords.create.mock.calls[0]![0]).toMatchObject({ netUsage: 0.039, grossUsage: 0.041, scrap: 4.88 });
  });

  it('when raw_materials has no price the record carries the engine\'s price per kg, declared USD (an India grade with no cost_india)', async () => {
    const { svc, costRecords } = build([], { id: 'new', unitCost: 0 });
    await svc.ensure(input(summary({ materialCostPerKg: 8, usdToDisplayRate: 2 })));
    expect(costRecords.update).toHaveBeenCalledWith('new', { unitCost: 4, notes: expect.stringContaining('the cost engine\'s price per kg (4.0000 USD)') }, 'u', 't', 'USD');
  });

  it('carries the engine\'s price per kg when it differs from the service\'s: the price the quote used (a Bar and Tube part\'s bar stock)', async () => {
    // The engine priced the 24 x 22 rectangular bar at 7.011 USD/kg (material_stock_prices); the lookup found 5.38, the Die Casting row's.
    const { svc, costRecords } = build([], { id: 'new', unitCost: 5.38 });
    await svc.ensure(input(summary({ materialCostPerKg: 7.011, materialSource: 'db' })));
    expect(costRecords.update).toHaveBeenCalledWith('new', {
      unitCost: 7.011, notes: 'The unit cost is the cost engine\'s price per kg (7.0110 USD), the price the quote used; raw_materials lists 5.3800 USD for "ABS" at USA.',
    }, 'u', 't', 'USD');
  });

  it('keeps the service\'s price when the engine agrees, or took only a default', async () => {
    const same = build([], { id: 'new', unitCost: 4 });
    await same.svc.ensure(input(summary({ materialSource: 'db' })));
    expect(same.costRecords.update).not.toHaveBeenCalled();
    const fallback = build([], { id: 'new', unitCost: 3.2 });
    await fallback.svc.ensure(input(summary({ materialSource: 'default' })));
    expect(fallback.costRecords.update).not.toHaveBeenCalled();
  });

  describe('the material row linked is the one of the part\'s process (a name is a row in several material groups)', () => {
    const rows: Record<string, object[]> = {
      'Multi-Spindle Machining': [{ id: 'ferrous', material: 'Aluminum, ANSI 6061', materialGroup: 'Ferrous & Non-Ferrous', densityKgM3: 2700 }],
      Machining: [{ id: 'ferrous', material: 'Aluminum, ANSI 6061', materialGroup: 'Ferrous & Non-Ferrous', densityKgM3: 2700 }],
      any: [{ id: 'forging', material: 'Aluminum, ANSI 6061', materialGroup: 'Forging', densityKgM3: 2700 }],
    };
    const lookup = (by: Record<string, object[]>) => jest.fn((q: { processGroup?: string }) => Promise.resolve({ items: by[q.processGroup ?? 'any'] ?? [] }));
    const aluminium = (item: object, s: object) => ({ ...(input(s) as object), item: { id: 'i1', volume: 100000, weight: 0.5, ...item }, grade: 'Aluminum, ANSI 6061' }) as never;

    it('the chosen Process: a Multi-Spindle Machining part links the Ferrous & Non-Ferrous row, not the first of any group (Forging)', async () => {
      const { svc, costRecords, materials } = build([]);
      materials.findAll = lookup(rows);
      await svc.ensure(aluminium({ scenarioOverrides: { processGroup: 'Multi-Spindle Machining' } }, summary({ family: 'turned' })));
      expect(materials.findAll.mock.calls[0]![0]).toMatchObject({ search: 'Aluminum, ANSI 6061', processGroup: 'Multi-Spindle Machining' });
      expect(costRecords.create.mock.calls[0]![0]).toMatchObject({ materialId: 'ferrous', materialGroup: 'Ferrous & Non-Ferrous' });
    });

    it('with no Process chosen, the process group of the family the engine priced the part as', async () => {
      const { svc, costRecords, materials } = build([]);
      materials.findAll = lookup(rows);
      await svc.ensure(aluminium({}, summary({ family: 'turned' })));
      expect(materials.findAll.mock.calls[0]![0]).toMatchObject({ processGroup: 'Machining' });
      expect(costRecords.create.mock.calls[0]![0]).toMatchObject({ materialId: 'ferrous' });
    });

    it('any group when the process has no material of that name', async () => {
      const { svc, costRecords, materials } = build([]);
      materials.findAll = lookup({ any: rows['any']! });
      await svc.ensure(aluminium({ scenarioOverrides: { processGroup: 'Multi-Spindle Machining' } }, summary({ family: 'turned' })));
      expect(materials.findAll).toHaveBeenCalledTimes(2);
      expect(materials.findAll.mock.calls[1]![0]).not.toHaveProperty('processGroup');
      expect(costRecords.create.mock.calls[0]![0]).toMatchObject({ materialId: 'forging' });
    });
  });

  it('still writes the record when the material lookup fails: unlinked, and priced by the service from the name', async () => {
    const { svc, costRecords, materials } = build([]);
    materials.findAll.mockRejectedValue(new Error('search down'));
    await svc.ensure(input(summary()));
    const dto = costRecords.create.mock.calls[0]![0];
    expect(dto.materialName).toBe('ABS');
    expect(dto).not.toHaveProperty('materialId');
  });
});

describe('MaterialCostSnapshotService.explain', () => {
  it('explains the same usage ensure records, from the same summary, and writes nothing', async () => {
    const { svc, costRecords } = build([]);
    const s = summary({ family: 'plastic_molded', grossWeightKg: 0.1134, blankSpec: undefined, injectionMolding: { runnerSystemType: 'cold' } });
    const item = { id: 'i1', volume: 100000, weight: 0.5, featureGraph: { classification: { family: 'plastic_molded' } } } as never;
    const explained = await svc.explain(item, 'ABS', s as never, 'u', 't');
    // 100,000 mm³ of ABS at 1050 kg/m³ is 0.105 kg; the molding engine charges 0.1134 kg (the part plus its 8 % cold-runner allowance).
    expect(explained).toMatchObject({ source: 'molding_allowance', netUsage: 0.105, grossUsage: 0.1134, scrapPct: 7.41 });
    expect(explained.gross.trace.map((t) => `${t.displayLabel}=${t.value}`)).toEqual(['Net Usage=0.105', 'Runner Allowance=8', 'Gross Usage=0.1134']);
    expect(costRecords.create).not.toHaveBeenCalled();
    expect(costRecords.update).not.toHaveBeenCalled();

    const recorded = await svc.ensure(input(s));
    expect(recorded.usage).toMatchObject({ netUsage: explained.netUsage, grossUsage: explained.grossUsage, scrapPct: explained.scrapPct, source: explained.source });
  });

  describe('a 2-Model Machining part', () => {
    const source = { itemId: 's1', name: 'Housing casting', basis: 'fully_burdened', materialCost: 166, processCost: 83, toolingCost: 41.5, totalCost: 290.5, asSuppliedFeatures: 4, removedVolumeMm3: 900 };
    // The summary as the engine returns it: the source's mass as the weights (castingMetal), money in the display currency (INR at 83).
    const twoModel = (over: Record<string, unknown> = {}) => summary({ family: 'two_model', grossWeightKg: 2, blankSpec: undefined, castingMetal: { partKg: 1.6, chargedKg: 2 }, materialCostPerKg: 145.25, usdToDisplayRate: 83, sourceComponent: source, ...over });

    it('records the source component as one piece at its cost in USD, not the grade\'s stock by the kg', async () => {
      const { svc, costRecords } = build([record({ materialName: 'Aluminum, A356' })], { id: 'new', unitCost: 3.5 });
      const r = await svc.ensure(input(twoModel()));
      expect(r).toEqual({ action: 'replaced', recordId: 'new', usage: null });
      expect(costRecords.update).toHaveBeenCalledWith('r1', { isActive: false }, 'u', 't');
      expect(costRecords.create.mock.calls[0]![0]).toMatchObject({
        materialName: 'Source component: Housing casting', uom: 'PC', grossUsage: 1, netUsage: 1, scrap: 0, overhead: 0, reclaimRate: 0, unitCost: 3.5, country: 'USA',
      });
      expect(costRecords.create.mock.calls[0]![0]).not.toHaveProperty('materialId');
    });

    it('keeps the record while it is this source at this cost and location', async () => {
      const { svc, costRecords } = build([record({ materialName: 'Source component: Housing casting', totalCost: 3.5 })]);
      expect((await svc.ensure(input(twoModel())))).toEqual({ action: 'kept', recordId: 'r1', usage: null });
      expect(costRecords.create).not.toHaveBeenCalled();
    });

    it('rewrites it when the source\'s cost moved', async () => {
      const { svc, costRecords } = build([record({ materialName: 'Source component: Housing casting', totalCost: 3.0 })]);
      expect((await svc.ensure(input(twoModel()))).action).toBe('replaced');
      expect(costRecords.create).toHaveBeenCalledTimes(1);
    });

    it('writes no stock record for a 2-Model part with no source linked', async () => {
      const { svc, costRecords } = build([record()]);
      expect(await svc.ensure(input(twoModel({ sourceComponent: undefined })))).toEqual({ action: 'kept', recordId: null, usage: null });
      expect(costRecords.create).not.toHaveBeenCalled();
      expect(costRecords.update).not.toHaveBeenCalled();
    });
  });
});

