import { describe, expect, it } from 'vitest';

import type { CalculationTraceStep } from '@/lib/api/hooks/useBOMItems';
import { calculationPanel, evidenceOfRef, isSheetMetalLibraryTable, lookupPanel, opensTable, smTablePanel, variablePanel, type SourceRef } from '@/lib/calculators/input-source';
import { isMatchedLookupRow } from '@/lib/calculators/lookup-row-match';

describe('opensTable / evidenceOfRef', () => {
  it('opens a record, table or calculation; a CAD measurement shows its faces instead', () => {
    expect(opensTable({ kind: 'variable', domain: 'sand_casting', name: 'ambientTemp' })).toBe(true);
    expect(opensTable({ kind: 'cad', evidence: 'part_volume' })).toBe(false);
    expect(opensTable(undefined)).toBe(false);
    expect(evidenceOfRef({ kind: 'calculation', name: 'Metal', evidence: 'part_volume', steps: [] })).toBe('part_volume');
    expect(evidenceOfRef({ kind: 'material', materialId: 'm', materialName: 'Al', column: 'density_kg_m3' })).toBeUndefined();
  });
});

describe('lookupPanel', () => {
  const table = {
    key: 'lookupTables_Component_tblGrindingDimensions',
    columns: ['Max Weight (kg)', 'Ingate Height (mm)', 'Riser Height (mm)'],
    rows: [{ 'Max Weight (kg)': 1, 'Ingate Height (mm)': 2, 'Riser Height (mm)': 3 }, { 'Max Weight (kg)': 5, 'Ingate Height (mm)': 2, 'Riser Height (mm)': 6 }],
  };
  const ref = (row: Record<string, number> | null): Extract<SourceRef, { kind: 'lookup' }> =>
    ({ kind: 'lookup', domain: 'sand_casting', table: table.key, column: 'Riser Height (mm)', row });

  it('outlines the row the engine read and puts the value\'s column last', () => {
    const p = lookupPanel(ref({ 'Max Weight (kg)': 5 }), table, 6);
    expect(p.matchedRowKeys).toEqual({ 'Max Weight (kg)': 5 });
    expect(p.column_definitions.at(-1)!.name).toBe('Riser Height (mm)');
    expect(p.tableName).toBe('tblGrindingDimensions');
  });

  it('without the engine\'s row, outlines the one row holding the value, and says so', () => {
    const p = lookupPanel(ref(null), table, 3);
    expect(p.matchedRowKeys).toEqual({ 'Riser Height (mm)': 3 });
    expect(p.note).toMatch(/value in use/);
  });

  it('outlines no row when two rows hold the value: picking one would be a guess', () => {
    const p = lookupPanel({ ...ref(null), column: 'Ingate Height (mm)' }, table, 2);
    expect(p.matchedRowKeys).toBeNull();
    expect(p.note).toMatch(/2 rows/);
  });
});

describe('variablePanel', () => {
  it('lists the domain\'s variables (not its lookup tables) with the variable outlined and its value last', () => {
    const p = variablePanel({ kind: 'variable', domain: 'sand_casting', name: 'ambientTemp' }, [
      { key: 'ambientTemp', category: 'variable', value: '21', unitType: 'Temperature', notes: null },
      { key: 'lookupTables_Component_tblX', category: 'lookup_table', value: null, unitType: null, notes: null },
    ]);
    expect(p.rows).toEqual([{ key: 'ambientTemp', unit_type: 'Temperature', notes: null, value: '21' }]);
    expect(p.matchedRowKeys).toEqual({ key: 'ambientTemp' });
    expect(p.column_definitions.at(-1)!.name).toBe('value');
  });
});

describe('calculationPanel', () => {
  it('shows each step with where it came from and outlines the result', () => {
    const steps: CalculationTraceStep[] = [
      { fieldName: 'Volume', displayLabel: 'Part Volume (mm³)', kind: 'input', value: 14520.77, unit: 'mm³', source: 'part volume (mm³)' },
      { fieldName: 'Poured Weight', displayLabel: 'Poured Weight (kg)', kind: 'calculated', value: 0.0802, unit: 'kg', formula: '{Net} + {Gating} + {Risers}' },
    ];
    const p = calculationPanel({ kind: 'calculation', name: 'Sand Casting - Metal per casting', evidence: 'part_volume', steps });
    expect(p.rows).toEqual([
      { field: 'Part Volume (mm³)', source: 'part volume (mm³)', unit: 'mm³', value: 14520.77 },
      { field: 'Poured Weight (kg)', source: '{Net} + {Gating} + {Risers}', unit: 'kg', value: 0.0802 },
    ]);
    expect(p.matchedRowKeys).toEqual({ field: 'Poured Weight (kg)' });
    expect(p.note).toMatch(/faces/);
  });
});

describe('smTablePanel', () => {
  const ref = (row: Record<string, string | number> | null, column = 'cutting_speed_m_per_min'): Extract<SourceRef, { kind: 'smTable' }> =>
    ({ kind: 'smTable', table: 'sm_lookup_laser_cut', column, row });
  // As GET /processes/sm-lookup-tables/by-name/:table serves it: rows wrapped as { rowData }, keys camelCased by the API.
  const byName = {
    tableName: 'sm_lookup_laser_cut',
    columnDefinitions: [
      { name: 'cutting_speed_m_per_min', label: 'Cutting Speed' },
      { name: 'material', label: 'Material' },
      { name: 'thickness_mm', label: 'Thickness' },
      { name: 'pierce_time_min', label: 'Pierce Time' },
    ],
    rows: [
      { id: '1', rowData: { material: 'Carbon Steel', thicknessMm: 2, cuttingSpeedMPerMin: 8, pierceTimeMin: 0.01 } },
      { id: '2', rowData: { material: 'Carbon Steel', thicknessMm: 3, cuttingSpeedMPerMin: 6, pierceTimeMin: 0.01 } },
    ],
  };

  it('unwraps the rows, puts the value\'s column last and outlines the row the engine read', () => {
    const p = smTablePanel(ref({ material: 'Carbon Steel', thicknessMm: 3 }), byName, 6);
    expect(p.rows).toEqual(byName.rows.map((r) => r.rowData));
    expect(p.column_definitions.map((c) => c.name)).toEqual(['material', 'thickness_mm', 'pierce_time_min', 'cutting_speed_m_per_min']);
    expect(p.rows.filter((r) => isMatchedLookupRow(r, p.matchedRowKeys))).toEqual([byName.rows[1]!.rowData]);
  });

  it('takes plain rows (a machine-library table) as they are', () => {
    const turret = {
      tableName: 'Turret Press machines',
      columnDefinitions: [{ name: 'machine_name', label: 'Machine' }, { name: 'punch_rate_cycles_min', label: 'Punch Rate' }],
      rows: [{ machineName: 'A', punchRateCyclesMin: 500 }, { machineName: 'B', punchRateCyclesMin: 500 }],
    };
    const p = smTablePanel({ kind: 'smTable', table: 'turret_machines', column: 'punch_rate_cycles_min', row: { machine_name: 'A' } }, turret, 500);
    expect(p.rows).toEqual(turret.rows);
    expect(p.rows.filter((r) => isMatchedLookupRow(r, p.matchedRowKeys))).toEqual([turret.rows[0]]);
  });

  it('without the engine\'s row, outlines the one row holding the value (either key spelling), else none', () => {
    expect(smTablePanel(ref(null), byName, 8).matchedRowKeys).toEqual({ cutting_speed_m_per_min: 8 });
    const shared = smTablePanel(ref(null, 'pierce_time_min'), byName, 0.01);
    expect(shared.matchedRowKeys).toBeNull();
    expect(shared.note).toMatch(/2 rows/);
  });

  it('opens a table, and names which tables have their own endpoint', () => {
    expect(opensTable(ref(null))).toBe(true);
    expect(isSheetMetalLibraryTable('stroke_rate_factor')).toBe(true);
    expect(isSheetMetalLibraryTable('sm_lookup_laser_cut')).toBe(false);
  });
});

describe('lookupPanel on camelCased rows', () => {
  it('finds the row holding the value when the API camelCased its keys (cutting_speed arrives as cuttingSpeed)', () => {
    const p = lookupPanel(
      { kind: 'lookup', domain: 'machining', table: 'tblDrilling', column: 'cutting_speed', row: null },
      { key: 'tblDrilling', columns: ['material_cut_code', 'cutting_speed'], rows: [{ materialCutCode: 1, cuttingSpeed: 30 }, { materialCutCode: 2, cuttingSpeed: 45 }] },
      45,
    );
    expect(p.matchedRowKeys).toEqual({ cutting_speed: 45 });
  });
});
