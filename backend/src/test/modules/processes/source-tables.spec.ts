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
});
