import {
  pressForceKnOf, pressForceTonnes, strokeRateFactorTable, turretMachinesTable, turretNibbleMmPerMin, waterjetMachinesTable,
} from '../../../../../../modules/bom-items/costing/sheet-metal/lookup/turret-reference-tables';

// Amada EM-3510 ZRB as staged (machine library nibble data, Countries punchRate, library press force 300 kN).
const AMADA = {
  punch_rate_cycles_min: 500, nibble_rate_cycles_min: 410, nibble_tool_diameter_mm: 6.35, nibble_tool_overlap_mm: 0.5, tool_change_time_s: 1.5,
};

describe('turret reference tables', () => {
  it('nibble speed is the nibble rate x the step one hit advances', () => {
    expect(turretNibbleMmPerMin(AMADA)).toBeCloseTo(2398.5, 9);
  });

  it('nibble speed is null when a field is missing or the step is not positive', () => {
    expect(turretNibbleMmPerMin({ ...AMADA, nibble_rate_cycles_min: undefined })).toBeNull();
    expect(turretNibbleMmPerMin({ ...AMADA, nibble_tool_overlap_mm: 6.35 })).toBeNull();
    expect(turretNibbleMmPerMin(null)).toBeNull();
  });

  it('tonnage is the press force in kN / 9.80665, from the first library row that carries one', () => {
    expect(pressForceTonnes(300)).toBeCloseTo(30.59, 2);
    expect(pressForceTonnes(undefined)).toBeNull();
    expect(pressForceKnOf([{ raw: { name: 'x' } }, { raw: { press_force_kn: 300 } }, { raw: { press_force_kn: 250 } }])).toBe(300);
  });

  it('the machines table carries every value the calculator reads, one row per machine', () => {
    const table = turretMachinesTable(
      [{ key: 'turretPunchMachine:Amada EM-3510 ZRB', raw: AMADA }, { key: 'turretPunchMachine:Another', raw: { ...AMADA, punch_rate_cycles_min: 240 } }],
      [{ key: 'Turret Press (Punch Press):Amada EM-3510 ZRB', raw: { name: 'dup' } }, { key: 'Turret Press (Punch Press):Amada EM-3510 ZRB', raw: { press_force_kn: 300 } }],
    );
    const row = table.rows.find((r) => r.machine_name === 'Amada EM-3510 ZRB')!;
    expect(row.punch_rate_cycles_min).toBe(500);
    expect(row.tool_change_time_s).toBe(1.5);
    expect(row.nibble_speed_mm_per_min).toBeCloseTo(2398.5, 9);
    expect(row.machine_tonnage_t).toBeCloseTo(30.59, 2);
    expect(table.rows.find((r) => r.machine_name === 'Another')!.machine_tonnage_t).toBeNull();
    expect(table.columnDefinitions.map((c) => c.name)).toContain('nibble_speed_mm_per_min');
  });

  it('Lookup Table 1 is sorted by tonnage and skips rows that are not complete', () => {
    const table = strokeRateFactorTable([
      { raw: { tonnage_t: 30, simple: 0.78, intermediate: 0.62, complex: 0.55 } },
      { raw: { tonnage_t: 10, simple: 0.9, intermediate: 0.8, complex: 0.7 } },
      { raw: { tonnage_t: 20, simple: 0.8 } },
    ]);
    expect(table.rows.map((r) => r.tonnage_t)).toEqual([10, 30]);
  });
});

describe('waterjet machines table', () => {
  it('carries the nozzle delay and jet data of each machine (Flow Mach 2 1313b as staged)', () => {
    const table = waterjetMachinesTable([
      { key: 'Waterjet Cutting Machine:Flow Mach 2 1313b', raw: { nozzle_delay_s: 4, pressure_n_mm2: 413.69, orifice_diameter_mm: 0.356, mixing_tube_diameter_mm: 1.061, abrasive_flow_rate_kg_min: 0.46, rapid_traverse_rate_mm_min: 15240 } },
      { key: 'Waterjet Cutting Machine:ESAB Hydrocut LX 6500', raw: { nozzle_delay_s: 6 } },
    ]);
    expect(table.rows.map((r) => r.machine_name)).toEqual(['ESAB Hydrocut LX 6500', 'Flow Mach 2 1313b']);
    expect(table.rows[1]).toMatchObject({ nozzle_delay_s: 4, pressure_n_mm2: 413.69, rapid_traverse_rate_mm_min: 15240 });
    expect(table.rows[0]!.pressure_n_mm2).toBeNull();
  });
});
