// The costing scenario a person sets for one board: where it is built, in what quantity, which machine (from HR Rates)
// runs each assembly step, and the assembly inputs the platform does not hold yet, each with who stated it. Nothing in a
// scenario is defaulted or estimated: an input that is absent stays absent and the step that needs it reports a gap.
//
// Pure: validation only. The scenario travels with a quote request and is stored inside that cost result, so a stored
// result always says exactly what it was priced with.
import { PLANNED_ENGINES } from '../reference/engine-inputs';

import type { RateEntry } from '../rates/rate-book';

/** A value a person states, with the document or measurement it came from. */
export interface StatedValue {
  value: number;
  note: string;
}

/** The assembly steps a scenario can price, in line order. Each is one engine. */
export const ASSEMBLY_STEPS = [
  'stencil_print_spi',
  'pick_and_place',
  'reflow',
  'aoi',
  'tht_insertion',
  'selective_solder',
  'depanel',
  'line_setup',
] as const;
export type AssemblyStepId = (typeof ASSEMBLY_STEPS)[number];

// Inputs a scenario may state that are not engine time inputs: what the uploaded files describe, and the two material
// lines of a PCBA (the bare board is priced from the fabricator's quote, never computed here).
export const SCENARIO_FACT_KEYS = {
  'panel.boards_in_files': { unit: 'boards', integer: true, label: 'Boards in the uploaded files (1 for a single board, 2 for a 2-up panel)' },
  'depanel.route_length_per_board_mm': { unit: 'mm', integer: false, label: 'Router path per board' },
  'bare_pcb.price_per_board': { unit: 'usd/board', integer: false, label: 'Bare PCB price per board, USD (fab quote)' },
  'components.cost_per_board': { unit: 'usd/board', integer: false, label: 'Components cost per board, USD (BOM pricing)' },
} as const;
export type ScenarioFactKey = keyof typeof SCENARIO_FACT_KEYS;

/** Every engine input key a scenario may state: the planned PCBA engine inputs plus the scenario facts. */
export function allowedInputKeys(): Set<string> {
  const keys = new Set<string>(Object.keys(SCENARIO_FACT_KEYS));
  for (const engine of PLANNED_ENGINES) {
    if (engine.family !== 'pcba') continue;
    for (const input of engine.inputs) keys.add(input.key);
  }
  return keys;
}

export interface ElectronicsScenario {
  /** Manufacturing location, as named in mhr_records (the HR Rates locations). */
  location: string;
  /** Currency the result is shown in; costs are computed in USD from the machine rates. */
  displayCurrency?: string;
  annualVolume?: number;
  /** The HR Rates machine (mhr_records id) chosen for each step. */
  machines: Partial<Record<AssemblyStepId, string>>;
  /** Stated inputs by key (engine input keys and scenario facts). */
  inputs: Record<string, StatedValue>;
}

export interface ScenarioProblem {
  field: string;
  reason: string;
}

export type ScenarioValidation = { ok: true; scenario: ElectronicsScenario } | { ok: false; problems: ScenarioProblem[] };

const NOTE_MAX = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function validateScenario(raw: unknown): ScenarioValidation {
  const problems: ScenarioProblem[] = [];
  if (!isRecord(raw)) return { ok: false, problems: [{ field: 'scenario', reason: 'must be an object' }] };

  const location = typeof raw.location === 'string' ? raw.location.trim() : '';
  if (location === '' || location.length > 100) problems.push({ field: 'location', reason: 'choose the manufacturing location' });

  let displayCurrency: string | undefined;
  if (raw.displayCurrency !== undefined) {
    if (typeof raw.displayCurrency === 'string' && /^[A-Z]{3}$/.test(raw.displayCurrency)) displayCurrency = raw.displayCurrency;
    else problems.push({ field: 'displayCurrency', reason: 'must be a three-letter currency code' });
  }

  let annualVolume: number | undefined;
  if (raw.annualVolume !== undefined) {
    if (Number.isInteger(raw.annualVolume) && (raw.annualVolume as number) >= 1 && (raw.annualVolume as number) <= 100_000_000) annualVolume = raw.annualVolume as number;
    else problems.push({ field: 'annualVolume', reason: 'must be a whole number of boards, at least 1' });
  }

  const machines: Partial<Record<AssemblyStepId, string>> = {};
  if (raw.machines !== undefined) {
    if (!isRecord(raw.machines)) problems.push({ field: 'machines', reason: 'must map a step to a machine' });
    else {
      for (const [step, id] of Object.entries(raw.machines)) {
        if (!(ASSEMBLY_STEPS as readonly string[]).includes(step)) problems.push({ field: `machines.${step}`, reason: 'not an assembly step' });
        else if (typeof id !== 'string' || !UUID.test(id)) problems.push({ field: `machines.${step}`, reason: 'must be an HR Rates machine id' });
        else machines[step as AssemblyStepId] = id;
      }
    }
  }

  const inputs: Record<string, StatedValue> = {};
  const allowed = allowedInputKeys();
  if (raw.inputs !== undefined) {
    if (!isRecord(raw.inputs)) problems.push({ field: 'inputs', reason: 'must map an input key to a stated value' });
    else {
      for (const [key, entry] of Object.entries(raw.inputs)) {
        const field = `inputs.${key}`;
        if (!allowed.has(key)) { problems.push({ field, reason: 'not an input this scenario can state' }); continue; }
        if (!isRecord(entry)) { problems.push({ field, reason: 'must be { value, note }' }); continue; }
        const value = entry.value;
        const note = typeof entry.note === 'string' ? entry.note.trim() : '';
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) { problems.push({ field, reason: 'must be a number greater than 0' }); continue; }
        const fact = SCENARIO_FACT_KEYS[key as ScenarioFactKey] as { integer: boolean } | undefined;
        if (fact?.integer && !Number.isInteger(value)) { problems.push({ field, reason: 'must be a whole number' }); continue; }
        if (note === '' || note.length > NOTE_MAX) { problems.push({ field, reason: `say where the value comes from (1-${NOTE_MAX} characters)` }); continue; }
        inputs[key] = { value, note };
      }
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    scenario: { location, machines, inputs, ...(displayCurrency ? { displayCurrency } : {}), ...(annualVolume ? { annualVolume } : {}) },
  };
}

/** Units of every input a scenario can state, by key. */
export function inputUnit(key: string): string {
  const fact = SCENARIO_FACT_KEYS[key as ScenarioFactKey] as { unit: string } | undefined;
  if (fact) return fact.unit;
  for (const engine of PLANNED_ENGINES) for (const i of engine.inputs) if (i.key === key) return i.unit;
  return '';
}

// The scenario's stated inputs as rate-book entries, so a quote cites them like any other rate. The note (who stated the
// value) is the source; the scope 'scenario' tells a stated value from a confirmed reference row of the same key.
export function scenarioRateEntries(scenario: ElectronicsScenario): RateEntry[] {
  return Object.entries(scenario.inputs).map(([key, stated]) => ({
    kind: 'reference' as const,
    key,
    scope: 'scenario',
    value: stated.value,
    unit: inputUnit(key),
    sourceRef: `scenario: ${stated.note}`,
  }));
}
