// The two tables behind the TPP calculator's lookup eyes, read from the real database
// (migration 902 staged both). Real ProcessesService, read-only, no mocks.
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import * as path from 'path';
import { ProcessesModule } from '../src/modules/processes/processes.module';
import { ProcessesService } from '../src/modules/processes/processes.service';

jest.setTimeout(120_000);

describe('[e2e] Turret Press reference tables', () => {
  let service: ProcessesService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: path.resolve(__dirname, '../.env') }), ProcessesModule],
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
});
