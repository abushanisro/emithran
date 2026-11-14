// A sand-casting machine as the steps need it: its rates and crew from the mhr_records row, its specs (seeded from the machine
// CSVs by migration 851), and its power, which is a column of its own. A machine with no stored machine hour rate (the melting
// furnaces: their data has no overhead rates) is priced by the HR Rates engine, never by a formula of ours; the line's trace says so.
import type { FinishingMachine } from '../casting-finishing';

export type RateSource = 'stored' | 'engine';

export interface SandMachine {
  id: string;
  name: string;
  machineClass: string;
  machineRatePerHr: number | null;
  /** Where the machine hour rate came from. */
  rateSource: RateSource;
  /** For an engine-priced rate: the fields the row lacked and the engine filled with its defaults (the rate is then partly assumed). */
  assumedDefaults: string[];
  labourRatePerHr: number | null;
  operators: number | null;
  setupTimeHr: number | null;
  preferred: boolean;
  powerKw: number | null;
  specs: Readonly<Record<string, unknown>>;
  /** The HR Rates location the record is priced for (the dialog shows the class's machines there); null when the row has none. */
  location: string | null;
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** The mhr_records columns a sand machine is read from (the whole row goes to the engine for a machine with no stored rate). */
export function sandMachineFromRow(
  row: Record<string, any>,
  engineRate: (row: Record<string, any>) => { ratePerHr: number; assumedDefaults: string[] } | null,
): SandMachine {
  const stored = num(row.mhr_usd_per_hour);
  const engine = stored != null && stored > 0 ? null : engineRate(row);
  const derived = engine?.ratePerHr ?? null;
  const specs = (row.specs ?? {}) as Record<string, unknown>;
  return {
    id: String(row.id),
    name: String(row.machine_name),
    machineClass: String(row.machine_class),
    machineRatePerHr: stored != null && stored > 0 ? stored : derived != null && derived > 0 ? derived : null,
    rateSource: stored != null && stored > 0 ? 'stored' : 'engine',
    assumedDefaults: engine?.assumedDefaults ?? [],
    labourRatePerHr: num(row.usd_labor_rate_per_hr),
    operators: num(row.operators),
    setupTimeHr: num(row.setup_time_hr),
    preferred: specs['is_preferred'] === true || String(specs['is_preferred']).toLowerCase() === 'true',
    powerKw: num(row.machine_power_kw),
    specs,
    location: row.location == null ? null : String(row.location),
  };
}

/** The shape the shared casting line builder (casting-finishing.ts `line`) costs. */
export const asFinishingMachine = (m: SandMachine): FinishingMachine => ({
  id: m.id, name: m.name, machineRatePerHr: m.machineRatePerHr, labourRatePerHr: m.labourRatePerHr,
  operators: m.operators, setupTimeHr: m.setupTimeHr, specs: { ...m.specs },
});

/** A text spec of a machine (a type such as shakeout_type), trimmed and lower-cased; null when absent. */
export function machineText(m: SandMachine, key: string): string | null {
  const v = m.specs[key];
  return v == null || String(v).trim() === '' ? null : String(v).trim().toLowerCase();
}

/** The value of a machine column: a spec of the machine, or its power, by the key the calculator spec names. */
export function machineValue(m: SandMachine, key: string): number | null {
  return key === 'machine_power_kw' ? m.powerKw : num(m.specs[key]);
}
