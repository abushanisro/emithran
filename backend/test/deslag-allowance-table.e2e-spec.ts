// The Deburring calculator's lookup panel: every Deslag machine's perimeter
// allowance from the real machine library (sm_reference_data), no mocks.
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import * as path from 'path';
import { DatabaseModule } from '../src/common/database/database.module';
import { DatabaseService } from '../src/common/database/database.service';
import { LoggerModule } from '../src/common/logger/logger.module';
import { Logger } from '../src/common/logger/logger.service';
import { ProcessesService } from '../src/modules/processes/processes.service';

jest.setTimeout(120_000);

describe('[e2e] Deslag allowance table', () => {
  it('lists the Deslag machines with their allowance, in the lookup-table shape', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: path.resolve(__dirname, '../../.env') }), DatabaseModule, LoggerModule],
    }).compile();
    const service = new ProcessesService(moduleRef.get(DatabaseService), moduleRef.get(Logger));

    const table = await service.getDeslagAllowanceTable();
    expect(table.columnDefinitions.map((c: { name: string }) => c.name)).toEqual(['machine_name', 'perimeter_allowance_s_per_mm']);
    expect(table.rows.length).toBeGreaterThan(0);
    for (const row of table.rows) expect(row.perimeter_allowance_s_per_mm).toBeGreaterThan(0);
    // memory/Sheetmetal/process/machine_data: "Default Deslag" perimeter_allowance_s_per_mm = 0.01
    expect(table.rows.find((r: { machine_name: string }) => r.machine_name === 'Default Deslag')?.perimeter_allowance_s_per_mm).toBe(0.01);
  });
});
