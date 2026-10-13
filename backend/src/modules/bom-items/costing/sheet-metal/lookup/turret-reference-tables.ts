// Turret Press reference data (sm_reference_data) as the engine reads it and as the
// calculator dialog shows it. One definition of each derived value, so the number the
// cost uses and the number the "view table" eye shows cannot differ.
//
//   'turretPunchMachine:<name>'   punch / nibble / tool-change data of one machine (migration 902)
//   'Turret Press (Punch Press):<name>'  the machine library row (press force); the key exists once
//                                 per staged export and only some carry the press force
//   'strokeRateFactor:<tonnage>'  Lookup Table 1: stroke rate factor by machine tonnage and part complexity

export const KN_PER_TONNE_FORCE = 9.80665;

type Raw = Record<string, unknown> | null | undefined;
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Machine tonnage from a press force in kN (kN / 9.80665), or null when there is no force. */
export function pressForceTonnes(pressForceKn: unknown): number | null {
  return positive(pressForceKn) ? pressForceKn / KN_PER_TONNE_FORCE : null;
}

/** The press force (kN) of a machine, from the first library row that carries one. */
export function pressForceKnOf(libraryRows: ReadonlyArray<{ raw: Raw }>): number | null {
  return libraryRows.map((r) => r.raw?.press_force_kn).find(positive) ?? null;
}

/**
 * Nibbling speed: nibble rate x the step one hit advances (tool diameter - overlap).
 * Null when the row lacks any of the three or the step is not positive.
 */
export function turretNibbleMmPerMin(raw: Raw): number | null {
  const rate = raw?.nibble_rate_cycles_min;
  const dia = raw?.nibble_tool_diameter_mm;
  const overlap = raw?.nibble_tool_overlap_mm;
  if (!positive(rate) || typeof dia !== 'number' || typeof overlap !== 'number') return null;
  const step = dia - overlap;
  return step > 0 ? rate * step : null;
}

export interface ReferenceTablePayload {
  id: string;
  tableName: string;
  columnDefinitions: Array<{ name: string; label: string; unit?: string }>;
  rows: Array<Record<string, unknown>>;
}

/** Every Turret Press machine with the values the TPP calculator reads from it. */
export function turretMachinesTable(
  machineRows: ReadonlyArray<{ key: string; raw: Raw }>,
  libraryRows: ReadonlyArray<{ key: string; raw: Raw }>,
): ReferenceTablePayload {
  const rows = machineRows
    .map((r) => {
      const name = r.key.replace(/^turretPunchMachine:/, '');
      const library = libraryRows.filter((l) => l.key === `Turret Press (Punch Press):${name}`);
      return {
        machine_name: name,
        punch_rate_cycles_min: positive(r.raw?.punch_rate_cycles_min) ? r.raw.punch_rate_cycles_min : null,
        tool_change_time_s: typeof r.raw?.tool_change_time_s === 'number' ? r.raw.tool_change_time_s : null,
        nibble_speed_mm_per_min: turretNibbleMmPerMin(r.raw),
        machine_tonnage_t: pressForceTonnes(pressForceKnOf(library)),
      };
    })
    .sort((a, b) => a.machine_name.localeCompare(b.machine_name));
  return {
    id: 'machine_library:turret_machines',
    tableName: 'Turret Press machines — punch rate, tool change, nibble speed',
    columnDefinitions: [
      { name: 'machine_name', label: 'Machine' },
      { name: 'punch_rate_cycles_min', label: 'Punch Rate', unit: 'hits/min' },
      { name: 'tool_change_time_s', label: 'Tool Change Time', unit: 's' },
      { name: 'nibble_speed_mm_per_min', label: 'Nibble Speed', unit: 'mm/min' },
      { name: 'machine_tonnage_t', label: 'Machine Tonnage', unit: 't' },
    ],
    rows,
  };
}

/** Lookup Table 1: the stroke rate factor by machine tonnage and part complexity. */
export function strokeRateFactorTable(rows: ReadonlyArray<{ raw: Raw }>): ReferenceTablePayload {
  const table = rows
    .map((r) => ({
      tonnage_t: r.raw?.tonnage_t,
      simple: r.raw?.simple,
      intermediate: r.raw?.intermediate,
      complex: r.raw?.complex,
    }))
    .filter((r): r is { tonnage_t: number; simple: number; intermediate: number; complex: number } =>
      typeof r.tonnage_t === 'number' && typeof r.simple === 'number' && typeof r.intermediate === 'number' && typeof r.complex === 'number')
    .sort((a, b) => a.tonnage_t - b.tonnage_t);
  return {
    id: 'lookup_table_1:stroke_rate_factor',
    tableName: 'Lookup Table 1 — stroke rate factor by machine tonnage and part complexity',
    columnDefinitions: [
      { name: 'tonnage_t', label: 'Machine Tonnage', unit: 't' },
      { name: 'simple', label: 'Simple' },
      { name: 'intermediate', label: 'Intermediate' },
      { name: 'complex', label: 'Complex' },
    ],
    rows: table,
  };
}

/** Every waterjet machine of the machine library with the values the waterjet calculator reads. */
export function waterjetMachinesTable(machineRows: ReadonlyArray<{ key: string; raw: Raw }>): ReferenceTablePayload {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  // The key exists once per staged export and once per location rate row (rate-only rows carry no
  // machine data): one row per machine, taking each value from the first row that has it.
  const byMachine = new Map<string, ReturnType<typeof rowOf>>();
  const rowOf = (r: { key: string; raw: Raw }) => ({
      machine_name: r.key.replace(/^Waterjet Cutting Machine:/, ''),
      pressure_n_mm2: num(r.raw?.pressure_n_mm2),
      orifice_diameter_mm: num(r.raw?.orifice_diameter_mm),
      mixing_tube_diameter_mm: num(r.raw?.mixing_tube_diameter_mm),
      abrasive_flow_rate_kg_min: num(r.raw?.abrasive_flow_rate_kg_min),
      rapid_traverse_rate_mm_min: num(r.raw?.rapid_traverse_rate_mm_min),
      nozzle_delay_s: num(r.raw?.nozzle_delay_s),
  });
  for (const r of machineRows) {
    const row = rowOf(r);
    const have = byMachine.get(row.machine_name);
    byMachine.set(row.machine_name, have
      ? Object.fromEntries(Object.entries(have).map(([k, v]) => [k, v ?? (row as Record<string, unknown>)[k]])) as typeof row
      : row);
  }
  const rows = [...byMachine.values()].sort((a, b) => a.machine_name.localeCompare(b.machine_name));
  return {
    id: 'machine_library:waterjet_machines',
    tableName: 'Waterjet machines — nozzle delay (pierce time) and jet data',
    columnDefinitions: [
      { name: 'machine_name', label: 'Machine' },
      { name: 'pressure_n_mm2', label: 'Pressure', unit: 'N/mm²' },
      { name: 'orifice_diameter_mm', label: 'Orifice', unit: 'mm' },
      { name: 'mixing_tube_diameter_mm', label: 'Mixing Tube', unit: 'mm' },
      { name: 'abrasive_flow_rate_kg_min', label: 'Abrasive Flow', unit: 'kg/min' },
      { name: 'rapid_traverse_rate_mm_min', label: 'Rapid Traverse', unit: 'mm/min' },
      { name: 'nozzle_delay_s', label: 'Nozzle Delay (pierce)', unit: 's' },
    ],
    rows,
  };
}
