// The two tables behind the TPP calculator's lookup eyes, read from the real database
// (migration 902 staged both). Real ProcessesService, read-only, no mocks.
import type { TestingModule } from '@nestjs/testing';
import { createE2eModule } from './support/create-e2e-app';
import { ProcessesService } from '../src/modules/processes/processes.service';

jest.setTimeout(120_000);

process.env.ELECTRONICS_QUEUE_DRIVER = 'memory'; // no queue polling in a read-only spec

describe('[e2e] Turret Press reference tables', () => {
  let moduleRef: TestingModule;
  let service: ProcessesService;

  beforeAll(async () => {
    moduleRef = await createE2eModule();
    service = moduleRef.get(ProcessesService, { strict: false });
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('lists the 21 turret machines with the rates the calculator reads', async () => {
    const table = await service.getTurretMachinesTable();
    expect(table.rows).toHaveLength(21);
    const amada = table.rows.find((r) => r.machine_name === 'Amada EM-3510 ZRB')!;
    expect(amada.punch_rate_cycles_min).toBe(500);
    expect(amada.nibble_speed_mm_per_min).toBeCloseTo(2398.5, 6);
    expect(amada.machine_tonnage_t as number).toBeCloseTo(30.6, 1);
  });

  it('serves Lookup Table 1 with the 17 tonnage rows', async () => {
    const table = await service.getStrokeRateFactorTable();
    expect(table.rows).toHaveLength(17);
    expect(table.rows.find((r) => r.tonnage_t === 30)).toMatchObject({ simple: 0.78, intermediate: 0.62, complex: 0.55 });
  });

  it('lists the waterjet machines with their nozzle delay', async () => {
    const table = await service.getWaterjetMachinesTable();
    expect(table.rows.length).toBe(new Set(table.rows.map((r) => r.machine_name)).size); // no duplicate machines
    expect(table.rows.length).toBeGreaterThanOrEqual(27);
    expect(table.rows.every((r) => r.nozzle_delay_s != null)).toBe(true);
    expect(table.rows.find((r) => r.machine_name === 'Flow Mach 2 1313b')).toMatchObject({ nozzle_delay_s: 4 });
  });
});
