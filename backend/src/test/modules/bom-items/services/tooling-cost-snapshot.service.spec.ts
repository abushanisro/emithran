import { ToolingCostSnapshotService } from '../../../../modules/bom-items/services/tooling-cost-snapshot.service';

const mold = { moldClass: 'Class104', moldCostUsd: 9808.59, moldCostPerPartUsd: 1.9617, annualVolume: 1000, productionLifeYears: 5, moldsRequired: 1 };
const OWNED = 'auto_fill_from_scenario:mold';

function build(records: object[]) {
  const tooling = { findAll: jest.fn().mockResolvedValue({ records }), remove: jest.fn().mockResolvedValue(undefined), create: jest.fn().mockResolvedValue({}) };
  const svc = new ToolingCostSnapshotService(tooling as never);
  const run = (summary: object) => svc.ensure({ bomItemId: 'i1', summary: { family: 'plastic_molded', ...summary } as never, userId: 'u', organizationId: 'o', token: 't' });
  return { tooling, run };
}
const current = { id: 'r1', description: 'Injection mold (SPI Class104)', unitCost: 9808.59, amortizationParts: 5000, notes: OWNED };

describe('ToolingCostSnapshotService', () => {
  it('writes the mold as a tooling item, in USD, spread over the job', async () => {
    const { tooling, run } = build([]);
    expect(await run({ tooling: mold })).toEqual({ action: 'replaced', items: ['Injection mold (SPI Class104)'] });
    expect(tooling.create).toHaveBeenCalledWith(expect.objectContaining({ bomItemId: 'i1', unitCost: 9808.59, quantity: 1, amortizationParts: 5000, usagePercentage: 100, notes: OWNED }), 'u', 't', 'o');
  });

  it('keeps a record that is already right, so applying again changes nothing', async () => {
    const { tooling, run } = build([current]);
    expect(await run({ tooling: mold })).toMatchObject({ action: 'kept' });
    expect(tooling.create).not.toHaveBeenCalled();
    expect(tooling.remove).not.toHaveBeenCalled();
  });

  it('replaces a stale one (the volume changed) instead of adding a second', async () => {
    const { tooling, run } = build([{ ...current, amortizationParts: 3000 }]);
    await run({ tooling: mold });
    expect(tooling.remove).toHaveBeenCalledWith('r1', 'u', 't');
    expect(tooling.create).toHaveBeenCalledTimes(1);
  });

  it('removes the mold when the route no longer needs one, and never touches a tool the user added', async () => {
    const byHand = { id: 'r2', description: 'Fixture', unitCost: 500, amortizationParts: 1000, notes: 'my own' };
    const { tooling, run } = build([current, byHand]);
    expect(await run({})).toEqual({ action: 'none', items: [] });
    expect(tooling.remove).toHaveBeenCalledTimes(1);
    expect(tooling.remove).toHaveBeenCalledWith('r1', 'u', 't');
  });
});
