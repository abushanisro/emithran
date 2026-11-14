import { describe, expect, it } from 'vitest';

import type { CalculationTraceStep } from '@/lib/api/hooks/useBOMItems';
import { calculationPanel, evidenceOfRef, lookupPanel, opensTable, variablePanel, type SourceRef } from '@/lib/calculators/input-source';

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
  it('lists the domain\'s variables (not its lookup tables, operations or wage grades) with the variable outlined and its value last', () => {
    const p = variablePanel({ kind: 'variable', domain: 'sand_casting', name: 'ambientTemp' }, [
      { key: 'ambientTemp', category: 'variable', value: '21', unitType: 'Temperature', notes: null },
      { key: 'lookupTables_Component_tblX', category: 'lookup_table', value: null, unitType: null, notes: null },
      { key: 'Core Making', category: 'operation', value: null, unitType: null, notes: null },
      { key: 'Moulder', category: 'wage_grade', value: '18', unitType: null, notes: null },
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
