import { SandMachineService } from '../../../../../modules/bom-items/costing/casting/sand/sand-machine.service';
import { runWithRequestCache } from '../../../../../modules/bom-items/costing/shared/core/request-cache';

describe('SandMachineService', () => {
  const rows = [
    { id: 'a', machine_name: 'Pour A', machine_class: 'sand_casting_pour', mhr_usd_per_hour: 30, usd_labor_rate_per_hr: 40, operators: 2, setup_time_hr: 0.5, machine_power_kw: 25, specs: { ladle_weight_capacity_kg: 250, is_preferred: true } },
    { id: 'b', machine_name: 'Furnace B', machine_class: 'sand_casting_melting', mhr_usd_per_hour: null, usd_labor_rate_per_hr: 48, operators: 3, setup_time_hr: 0, machine_power_kw: 400, specs: { furnace_capacity_m3: 0.5 } },
  ];
  const fullRows = [{ ...rows[1], landed_machine_cost: 8700 }];
  function client() {
    const calls: Array<{ select: string; filters: Record<string, unknown> }> = [];
    return {
      calls,
      from: () => {
        const filters: Record<string, unknown> = {};
        let select = '';
        const c: any = {
          select: (s: string) => ((select = s), c), in: (k: string, v: unknown) => ((filters[k] = v), c), eq: (k: string, v: unknown) => ((filters[k] = v), c), order: () => c,
          then: (resolve: (r: unknown) => unknown) => { calls.push({ select, filters }); return Promise.resolve({ data: select === '*' ? fullRows : rows, error: null }).then(resolve); },
        };
        return c;
      },
    };
  }

  it('reads the machines slim, and the whole row only for a machine with no stored rate, which the HR Rates engine prices', async () => {
    const c = client();
    const seen: Array<Record<string, any>> = [];
    const svc = new SandMachineService({ engineHourRate: (row: Record<string, any>) => { seen.push(row); return { ratePerHr: 12.5, assumedDefaults: ['paybackPeriodYears=5 (default)'] }; } } as never);
    const out = await runWithRequestCache(() => svc.getMachinesByClass(c as never, ['sand_casting_pour', 'sand_casting_melting'], 'USA'));
    expect(c.calls.map((x) => x.select === '*')).toEqual([false, true]);
    expect(c.calls[1]!.filters['id']).toEqual(['b']); // only the unpriced machine
    expect(out['sand_casting_pour']![0]).toMatchObject({ name: 'Pour A', machineRatePerHr: 30, rateSource: 'stored', powerKw: 25, preferred: true });
    expect(out['sand_casting_melting']![0]).toMatchObject({ name: 'Furnace B', machineRatePerHr: 12.5, rateSource: 'engine', assumedDefaults: ['paybackPeriodYears=5 (default)'] });
    expect(seen[0]!['landed_machine_cost']).toBe(8700); // the engine got the full row
  });

  it('a machine the engine cannot price has no rate, and a read error gives no machines', async () => {
    const svc = new SandMachineService({ engineHourRate: () => { throw new Error('bad row'); } } as never);
    const out = await runWithRequestCache(() => svc.getMachinesByClass(client() as never, ['sand_casting_melting', 'sand_casting_pour'], 'USA'));
    expect(out['sand_casting_melting']![0]!.machineRatePerHr).toBeNull();
  });
});
