import { Injectable } from '@nestjs/common';
import type { DbClient } from '../../../../../common/db/postgrest-client';
import { MHRService } from '../../../../mhr/mhr.service';
import { sandMachineFromRow, type SandMachine } from './sand-machines';

/**
 * The sand-casting machines of one class and location, from their HR Rates rows. A machine with no stored machine hour rate is priced by
 * the HR Rates engine (MHRService.engineHourRate), so the route uses the same rate the HR Rates screens show for it.
 */
@Injectable()
export class SandMachineService {
  constructor(private readonly mhr: MHRService) {}

  async getMachines(client: DbClient, machineClass: string, location: string): Promise<SandMachine[]> {
    const { data, error } = await client.from('mhr_records').select('*').eq('machine_class', machineClass).eq('location', location).order('id');
    if (error) return [];
    return (data ?? []).map((row: Record<string, any>) =>
      sandMachineFromRow(row, (r) => {
        try {
          return this.mhr.engineHourRate(r);
        } catch {
          return null; // the engine could not price it: the machine has no rate, and a step says so
        }
      }),
    );
  }
}
