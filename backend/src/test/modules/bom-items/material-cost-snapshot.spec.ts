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

  it('when raw_materials has no price the record carries the engine\'s price per kg in USD, not zero', async () => {
    const { svc, costRecords } = build([], { id: 'new', unitCost: 0 });
    await svc.ensure(input(summary({ materialCostPerKg: 8, usdToDisplayRate: 2 })));
    expect(costRecords.update).toHaveBeenCalledWith('new', { unitCost: 4, notes: expect.stringContaining('the cost engine\'s price per kg (4.0000 USD)') }, 'u', 't');
  });

  it('does not overwrite a price the service found', async () => {
    const { svc, costRecords } = build([], { id: 'new', unitCost: 3.2 });
    await svc.ensure(input(summary()));
    expect(costRecords.update).not.toHaveBeenCalled();
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
