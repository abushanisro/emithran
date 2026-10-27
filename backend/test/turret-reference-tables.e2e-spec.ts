// The two tables behind the TPP calculator's lookup eyes, read from the real database
// (migration 902 staged both). Real ProcessesService, read-only, no mocks.
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import * as path from 'path';
import { ProcessesModule } from '../src/modules/processes/processes.module';
import { ProcessesService } from '../src/modules/processes/processes.service';
import { SessionModule } from '../src/common/session/session.module';

jest.setTimeout(120_000);

describe('[e2e] Turret Press reference tables', () => {
  let service: ProcessesService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      // SessionModule is global in AppModule; the auth guard ProcessesModule wires needs it.
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: path.resolve(__dirname, '../.env') }), SessionModule, ProcessesModule],
    }).compile();
    service = moduleRef.get(ProcessesService);
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
