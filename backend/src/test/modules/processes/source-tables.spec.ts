import { machineSourceTable, materialSourceTable } from '../../../modules/processes/source-tables';

describe('machineSourceTable', () => {
  const rows = [
    { id: 'b', machine_name: 'Induction Furnace - 6.35m^3', machine_power_kw: 30000, specs: { yield_loss_factor: 0.98, furnace_factor: 1.5, nested: { x: 1 } } },
    { id: 'a', machine_name: 'Induction Furnace - 1.27m^3', machine_power_kw: 6000, specs: { yield_loss_factor: 0.98, furnace_factor: 1.5 } },
  ];
  const t = machineSourceTable(rows, { id: 'b', machineClass: 'sand_casting_melting', location: 'USA' }, 'yield_loss_factor');

  it('lists the class\'s machines with their specs flattened, the value\'s column last and the record\'s row matched by id', () => {
    expect(t.rows.map((r) => r['machine_name'])).toEqual(['Induction Furnace - 1.27m^3', 'Induction Furnace - 6.35m^3']);
    expect(t.columnDefinitions[0]!.name).toBe('machine_name');
    expect(t.columnDefinitions.at(-1)).toEqual({ name: 'yield_loss_factor', label: 'Yield Loss Factor' });
    expect(t.columnDefinitions.map((c) => c.name)).toEqual(expect.arrayContaining(['furnace_factor', 'machine_power_kw']));
    expect(t.matchedRowKeys).toEqual({ id: 'b' });
    expect(t.tableName).toBe('HR Rates machines: sand_casting_melting (USA)');
  });

  it('shows no nested spec as a column and does not show the id', () => {
    const names = t.columnDefinitions.map((c) => c.name);
    expect(names).not.toContain('nested');
    expect(names).not.toContain('id');
  });
});

describe('materialSourceTable', () => {
  it('lists the group\'s materials by name, bookkeeping columns left out, the value\'s column last, the record matched by id', () => {
    const t = materialSourceTable([
      { id: 'm2', name: 'Aluminum, ANSI 6061', grade: '6061', specific_heat_rt_j_kg_k: 900, created_at: '2026-01-01', organization_id: 'o' },
      { id: 'm1', name: 'ASTM Grade 20 Gray Iron', grade: '20', specific_heat_rt_j_kg_k: 460, created_at: '2026-01-01', organization_id: 'o' },
    ], { id: 'm2', group: 'Sand Casting' }, 'specific_heat_rt_j_kg_k');
    expect(t.rows.map((r) => r['name'])).toEqual(['Aluminum, ANSI 6061', 'ASTM Grade 20 Gray Iron']);
    expect(t.columnDefinitions.map((c) => c.name)).toEqual(['name', 'grade', 'specific_heat_rt_j_kg_k']);
    expect(t.matchedRowKeys).toEqual({ id: 'm2' });
  });

  describe('with the materials\' properties (raw_material_properties)', () => {
    const t = materialSourceTable([
      { id: 'a2', name: 'Aluminum, AA 380.0', grade: '380.0', density_kg_m3: 2760 },
      { id: 'a1', name: 'Aluminum, AA 360.0', grade: '360.0', density_kg_m3: 2630 },
    ], { id: 'a2', group: 'Die Casting' }, 'mold_temp', [
      { raw_material_id: 'a2', property_key: 'mold_temp', value_num: '240' },
      { raw_material_id: 'a2', property_key: 'shear_strength', value_num: 190 },
      { raw_material_id: 'a1', property_key: 'mold_temp', value_num: 230 },
      { raw_material_id: 'a1', property_key: 'density_kg_m3', value_num: 1 },
      { raw_material_id: 'a1', property_key: 'cooling_factor', value_num: null },
    ]);

    it('adds each property as a column of its material\'s row, named by property_key, the value\'s column last', () => {
      const al380 = t.rows.find((r) => r['id'] === 'a2')!;
      expect(al380['mold_temp']).toBe(240);
      expect(al380['shear_strength']).toBe(190);
      expect(t.rows.find((r) => r['id'] === 'a1')!['mold_temp']).toBe(230);
      expect(t.columnDefinitions.at(-1)).toEqual({ name: 'mold_temp', label: 'Mold Temp' });
      expect(t.matchedRowKeys).toEqual({ id: 'a2' });
    });

    it('never replaces a column of the record with a property of the same name, and shows no empty property', () => {
      expect(t.rows.find((r) => r['id'] === 'a1')!['density_kg_m3']).toBe(2630);
      expect(t.columnDefinitions.map((c) => c.name)).not.toContain('cooling_factor');
    });
  });
});

describe('machineSourceTable shows whatever column an engine reads', () => {
  it('passes through every value column of the record (a press dry cycle, a transfer index time), not a fixed list', () => {
    const t = machineSourceTable([
      { id: 'p1', machine_name: 'Engel 200T', machine_class: 'injection_molding', location: 'USA', press_cycle_time_s: 4.2, created_at: '2026-01-01', organization_id: 'o', specs: { injection_rate_mm3_per_s: 90000 } },
      { id: 't1', machine_name: 'Hydromat', machine_class: 'injection_molding', location: 'USA', drum_index_time_s: 1.1, specs: {} },
    ], { id: 'p1', machineClass: 'injection_molding', location: 'USA' }, 'press_cycle_time_s');
    const names = t.columnDefinitions.map((c) => c.name);
    expect(names.at(-1)).toBe('press_cycle_time_s');
    expect(names).toEqual(expect.arrayContaining(['drum_index_time_s', 'injection_rate_mm3_per_s']));
    for (const skipped of ['id', 'created_at', 'organization_id', 'machine_class', 'location', 'specs']) expect(names).not.toContain(skipped);
    expect(t.rows.find((r) => r['id'] === 'p1')!['press_cycle_time_s']).toBe(4.2);
  });
});
