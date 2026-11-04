import { Injectable } from '@nestjs/common';
import type { DbClient } from '../../../../../common/db/postgrest-client';
import { MHRService } from '../../../../mhr/mhr.service';
import { cachedRead } from '../../shared/core/request-cache';
import { sandMachineFromRow, type SandMachine } from './sand-machines';

/** The mhr_records columns a sand machine is read from. The whole row is read only for a machine with no stored rate (the engine prices it). */
const SLIM = 'id, machine_name, machine_class, mhr_usd_per_hour, usd_labor_rate_per_hr, operators, setup_time_hr, machine_power_kw, specs';

/**
 * The sand-casting machines of a location, from their HR Rates rows, by machine class. A machine with no stored machine hour rate is priced
 * by the HR Rates engine (MHRService.engineHourRate), so the route uses the same rate the HR Rates screens show for it, with the inputs the
 * engine had to assume.
 */
@Injectable()
export class SandMachineService {
  constructor(private readonly mhr: MHRService) {}

  /** The machines of several classes, read once per request. */
  getMachinesByClass(client: DbClient, machineClasses: readonly string[], location: string): Promise<Record<string, SandMachine[]>> {
    return cachedRead(`sand-machines:${location}:${machineClasses.join(',')}`, async () => {
      const { data, error } = await client.from('mhr_records').select(SLIM).in('machine_class', [...machineClasses]).eq('location', location).order('id');
      const out: Record<string, SandMachine[]> = Object.fromEntries(machineClasses.map((c) => [c, []]));
      if (error) return out;
      const rows = (data ?? []) as Array<Record<string, any>>;
      const unpriced = rows.filter((r) => !(Number(r.mhr_usd_per_hour) > 0)).map((r) => r.id);
      const full = new Map<string, Record<string, any>>();
      if (unpriced.length) {
        const { data: fullRows } = await client.from('mhr_records').select('*').in('id', unpriced);
        for (const r of (fullRows ?? []) as Array<Record<string, any>>) full.set(String(r.id), r);
      }
      for (const row of rows) {
        const machine = sandMachineFromRow(row, (r) => {
          try {
            return this.mhr.engineHourRate(full.get(String(r.id)) ?? r);
          } catch {
            return null; // the engine could not price it: the machine has no rate, and a step says so
          }
        });
        (out[machine.machineClass] ??= []).push(machine);
      }
      return out;
    });
  }

  async getMachines(client: DbClient, machineClass: string, location: string): Promise<SandMachine[]> {
    return (await this.getMachinesByClass(client, [machineClass], location))[machineClass] ?? [];
  }
}
