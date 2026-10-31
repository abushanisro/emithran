import { Injectable } from '@nestjs/common';

import { ElectronicsReferenceRepository } from './electronics-reference.repository';
import { DatabaseService } from '../../../../common/database/database.service';

import type { MachineCandidate, RateBook, RateEntry } from '../../domain/rates/rate-book';

export interface MachineRateRow {
  id: string;
  machine_name: string;
  location: string;
  mhr_usd_per_hour: number | null;
  usd_labor_rate_per_hr: number | null;
  currency_code: string | null;
  economics_version: string | number | null;
  updated_at: string;
}

// A machine name can be stored on more than one row (a second copy of the same import, or one machine
// serving two processes). Identical rates make the choice harmless, so the most recently updated row is
// cited, deterministically. Rows that disagree on a rate cannot be resolved by guessing: that is an error
// naming the machine, so the data gets fixed instead of one value being silently preferred.
export function chooseRateRows(rows: MachineRateRow[]): MachineRateRow[] {
  const byName = new Map<string, MachineRateRow[]>();
  for (const row of rows) byName.set(row.machine_name, [...(byName.get(row.machine_name) ?? []), row]);
  return [...byName.entries()].map(([name, group]) => {
    const distinct = new Set(group.map((r) => `${r.mhr_usd_per_hour}/${r.usd_labor_rate_per_hr}`));
    if (distinct.size > 1) {
      throw new Error(`Machine "${name}" has ${group.length} rows with different rates (${[...distinct].join(' | ')}); resolve the duplicate before quoting.`);
    }
    return [...group].sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id))[0];
  });
}

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

// Builds the rate book a quote reads from, so the quote can cite exactly what it used:
//  - reference inputs that a person has confirmed apply (status 'sourced'); rows still pending
//    confirmation are left out, so an engine cannot price from them and reports a gap instead;
//  - machine-hour and labour-hour rates of the named machines, each from one mhr_records row, with
//    that row's id and version stamps (economics_version, updated_at) as they are right now.
@Injectable()
export class ElectronicsRateBookLoader {
  constructor(
    private readonly database: DatabaseService,
    private readonly reference: ElectronicsReferenceRepository,
  ) {}

  async load(organizationId: string, machineNames: string[] = [], location?: string): Promise<RateBook> {
    if (machineNames.length > 0 && !location) throw new Error('A location is required to read machine rates; none is assumed');
    const [referenceRows, machineEntries] = await Promise.all([
      this.reference.listRows(),
      machineNames.length > 0 && location ? this.machineRates(organizationId, machineNames, location) : Promise.resolve([]),
    ]);
    const confirmed: RateEntry[] = referenceRows
      .filter((r) => r.status === 'sourced')
      .map((r) => ({ kind: 'reference', key: r.key, scope: r.scope, value: r.value, unit: r.unit, sourceRef: r.source_ref }));
    return { entries: [...confirmed, ...machineEntries] };
  }

  // The HR Rates machines a scenario chose, by id: benchmark rows and the quoting organisation's own rows only. A machine
  // that is not found is simply absent; the step that wanted it reports the gap.
  async machinesById(organizationId: string, ids: string[]): Promise<MachineCandidate[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.database
      .getPrivilegedClient('reference-data: the HR Rates machines an electronics scenario chose, benchmark rows and the quoting organization rows only')
      .from('mhr_records')
      .select('id, machine_name, machine_class, location, mhr_usd_per_hour, usd_labor_rate_per_hr, operators, setup_time_hr, currency_code, specs, economics_version, updated_at')
      .in('id', ids)
      .or(`organization_id.is.null,organization_id.eq.${organizationId}`);
    if (error) throw new Error(`mhr_records read failed: ${error.message}`);
    return (data as Record<string, unknown>[]).map((r) => ({
      recordId: String(r.id),
      name: String(r.machine_name),
      machineClass: typeof r.machine_class === 'string' ? r.machine_class : 'unclassified',
      location: String(r.location ?? ''),
      mhrPerHour: Number(r.mhr_usd_per_hour ?? 0),
      lhrPerHour: Number(r.usd_labor_rate_per_hr ?? 0),
      operators: Number(r.operators ?? 0),
      setupTimeHr: Number(r.setup_time_hr ?? 0),
      currency: 'USD', // the *_usd_* columns are read; currency_code is the row's local currency
      specs: (r.specs as Record<string, unknown> | null) ?? {},
      recordVersion: r.economics_version === null || r.economics_version === undefined ? undefined : String(r.economics_version),
      recordedAt: String(r.updated_at),
    }));
  }

  private async machineRates(organizationId: string, names: string[], location: string): Promise<RateEntry[]> {
    const { data, error } = await this.database
      .getPrivilegedClient('reference-data: machine and labour hour rates for electronics quotes, benchmark rows and the quoting organization rows only')
      .from('mhr_records')
      .select('id, machine_name, location, mhr_usd_per_hour, usd_labor_rate_per_hr, currency_code, economics_version, updated_at')
      .in('machine_name', names)
      .eq('location', location)
      .or(`organization_id.is.null,organization_id.eq.${organizationId}`);
    if (error) throw new Error(`mhr_records read failed: ${error.message}`);

    return chooseRateRows(data as MachineRateRow[]).flatMap((row) => {
      const common = {
        scope: row.machine_name,
        currency: row.currency_code ?? 'USD',
        sourceRef: `mhr_records:${row.id}`,
        recordId: row.id,
        recordVersion: row.economics_version === null ? undefined : String(row.economics_version),
        recordedAt: row.updated_at,
      };
      const entries: RateEntry[] = [];
      if (positive(row.mhr_usd_per_hour)) entries.push({ ...common, kind: 'machine_rate', key: 'mhr_usd_per_hour', value: row.mhr_usd_per_hour, unit: 'usd/h' });
      if (positive(row.usd_labor_rate_per_hr)) entries.push({ ...common, kind: 'labour_rate', key: 'lhr_usd_per_hour', value: row.usd_labor_rate_per_hr, unit: 'usd/h' });
      return entries;
    });
  }
}
