import { buildCostTable, COST_COLUMNS, type CostTableInput } from '../../../modules/bom-items/costing/shared/cost-table';

// The sheet-metal part's stored rows, as read from the database.
const process = (over: Record<string, unknown>) => ({ id: 'p', operation: 'Laser Cutting', process_name: '', process_group: 'Sheet Metal', machine_name: null, cycle_time: '3.00', setup_cost_per_part: '0.023997', total_cost_per_part: '0.125418', op_nbr: null, created_at: '2026-11-05T10:00:00Z', ...over });
const input = (over: Partial<CostTableInput> = {}): CostTableInput => ({
  part: { id: 'i1', name: '830 001718 00', annualVolume: 1000 },
  processes: [
    process({ id: 'a' }),
    process({ id: 'b', operation: 'Press Brake', cycle_time: '15.30', setup_cost_per_part: '0.04', total_cost_per_part: '0.32', created_at: '2026-11-05T10:00:01Z' }),
    process({ id: 'c', operation: 'Inspection', process_group: 'Machining', cycle_time: '17.40', setup_cost_per_part: '0', total_cost_per_part: '0.21', created_at: '2026-11-05T10:00:02Z' }),
  ],
  materials: [{ id: 'm', material_name: 'SECC', unit_cost: '1.175', net_usage: '0.038', total_cost: '0.101168', material_utilization_rate: '46.34' }],
  logistics: [], procured: [], tooling: [],
  ...over,
});
const row = (t: ReturnType<typeof buildCostTable>, id: string) => t.rows.find((r) => r.id === id)!;

describe('buildCostTable — process source', () => {
  it('shows an operation\'s source exactly as its record states it, and leaves an unstated one empty', () => {
    const t = buildCostTable(input({
      processes: [process({ id: 'a', op_nbr: 10, machine_name: 'Salvagnini L3-30', parts_per_cycle: '1.00', scrap: '0.00', setup_time: '4.80', batch_size: '250',
        machine_rate: '38.69', labor_rate: '36.30', timing_source: null, setup_time_source: 'machine' }) as never],
    }));
    const v = row(t, 'process:a').values;
    expect(v).toMatchObject({ operationNumber: 10, machineName: 'Salvagnini L3-30', partsPerCycle: 1, setupTimeMin: 4.8, batchSize: 250, machineRate: 38.69, laborRate: 36.3, setupTimeSource: 'machine' });
    expect(v.timingSource).toBeNull();
  });
});

describe('buildCostTable', () => {
  it('lays the part out as part > material and process groups > processes, in operation order', () => {
    const t = buildCostTable(input());
    expect(t.rows.map((r) => `${r.kind}:${r.name}`)).toEqual([
      'part:830 001718 00', 'material:SECC', 'group:Sheet Metal', 'process:Laser Cutting', 'process:Press Brake', 'group:Machining', 'process:Inspection',
    ]);
    expect(row(t, 'process:b').parentId).toBe('group:Sheet Metal');
    expect(row(t, 'group:Sheet Metal').parentId).toBe('part:i1');
  });

  it('an operation shows the engine\'s total as its setup plus its process cost, so nothing is dropped or invented', () => {
    const p = row(buildCostTable(input()), 'process:a').values;
    expect(p.amortizedBatchSetup).toBeCloseTo(0.023997, 6);
    expect(p.processCost).toBeCloseTo(0.125418 - 0.023997, 6);
    expect(p.totalVariable).toBeCloseTo(0.125418, 6);
    expect(p.laborTimeSec).toBe(3);
  });

  it('groups and the part add up their children; the part adds up the leaves once', () => {
    const t = buildCostTable(input());
    expect(row(t, 'group:Sheet Metal').values.totalVariable).toBeCloseTo(0.125418 + 0.32, 6);
    const part = row(t, 'part:i1').values;
    expect(part.totalVariable).toBeCloseTo(0.101168 + 0.125418 + 0.32 + 0.21, 6);
    expect(part.materialCost).toBeCloseTo(0.101168, 6);
    expect(part.pieceCost).toBe(part.totalVariable);
  });

  it('the part row carries the material info and the annual volume', () => {
    expect(row(buildCostTable(input()), 'part:i1').values).toMatchObject({
      annualVolume: 1000, finishMassKg: 0.038, materialComposition: 'SECC', utilizationPct: 46.34, materialUnitCost: 1.175,
    });
  });

  it('adds logistics, procured parts and tooling, with the tooling investment as capital', () => {
    const t = buildCostTable(input({
      logistics: [{ id: 'l', cost_name: 'Crate', total_cost: '0.05' }],
      procured: [{ id: 'q', part_name: 'Hinge', total_cost: '0.4' }],
      tooling: [{ id: 't', tooling_type: 'die', description: 'Blanking die', unit_cost: '5000', quantity: '1', total_cost: '0.02', total_tooling_investment: '5000' }],
    }));
    const part = row(t, 'part:i1').values;
    expect(part).toMatchObject({ logistics: 0.05, otherDirect: 0.4, tooling: 0.02, capitalInvestment: 5000 });
    expect(part.totalVariable).toBeCloseTo(0.101168 + 0.125418 + 0.32 + 0.21 + 0.05 + 0.4 + 0.02, 6);
  });

  it('the capital investment falls back to unit cost x quantity when no total is stored', () => {
    const t = buildCostTable(input({ tooling: [{ id: 't', tooling_type: null, description: null, unit_cost: '300', quantity: '2', total_cost: '0.01', total_tooling_investment: null }] }));
    expect(row(t, 'tooling:t').values.capitalInvestment).toBe(600);
  });

  it('says where a tooling row was priced from: its catalog row, a custom item, or nothing for a row saved before (no note invented)', () => {
    const base = { tooling_type: 'Mold component', description: 'Air Poppet', unit_cost: '25', quantity: '30', total_cost: '0.03', total_tooling_investment: '750' };
    const t = buildCostTable(input({ tooling: [
      { id: 'c', ...base, is_custom: false, catalog_source: '2026-Plastic:cmStandardToolingComponents:0' },
      { id: 'u', ...base, is_custom: true, catalog_source: null },
      { id: 'o', ...base, is_custom: false, catalog_source: null },
    ] }));
    expect(row(t, 'tooling:c').note).toBe('Priced from cmStandardToolingComponents row 1 (2026-Plastic)');
    expect(row(t, 'tooling:u').note).toBe('Custom item, not from the catalog');
    expect(row(t, 'tooling:o').note).toBeUndefined();
  });

  it('flags a cost object with no cost, and a part with nothing applied', () => {
    const t = buildCostTable(input({ processes: [process({ id: 'z', total_cost_per_part: '0', setup_cost_per_part: '0' })] }));
    expect(row(t, 'process:z')).toMatchObject({ status: 'attention', statusNote: 'This operation carries no cost.' });
    expect(row(t, 'group:Sheet Metal').status).toBe('attention');
    const empty = buildCostTable(input({ processes: [], materials: [] }));
    expect(empty.rows).toHaveLength(1);
    expect(empty.rows[0]).toMatchObject({ status: 'attention', statusNote: 'No cost has been applied yet.' });
  });

  it('a process with no group goes under "Other", and a missing name falls back', () => {
    const t = buildCostTable(input({ processes: [process({ id: 'n', process_group: null, operation: null, process_name: 'Painting' })] }));
    expect(t.rows.map((r) => r.name)).toContain('Other');
    expect(t.rows.map((r) => r.name)).toContain('Painting');
  });

  it('declares the columns the model has no data for, with the reason, and puts no number in them', () => {
    const t = buildCostTable(input());
    const unmodelled = COST_COLUMNS.filter((c) => !c.modelled).map((c) => c.key);
    expect(unmodelled).toEqual(['indirectOverhead', 'sga', 'margin', 'targetCost']);
    for (const c of COST_COLUMNS.filter((c) => !c.modelled)) {
      expect(c.note).toMatch(/Not modelled/);
      for (const r of t.rows) expect(r.values[c.key]).toBeUndefined();
    }
  });

  it('the basic columns are the ones that add up to the piece part cost (the total variable cost is the same number, so only the dialog shows both)', () => {
    expect(COST_COLUMNS.filter((c) => c.basic).map((c) => c.key)).toEqual(['materialCost', 'processCost', 'amortizedBatchSetup', 'pieceCost']);
  });

  it('is in USD, the currency every persisted cost table is native to', () => {
    expect(buildCostTable(input()).currency).toBe('USD');
  });
});

describe('buildCostTable — labor and direct overhead', () => {
  const molding = process({ id: 'm', operation: 'Injection Molding', process_group: 'Plastic Molding', cycle_time: '9.6', setup_cost_per_part: '0.4574', total_cost_per_part: '0.6099', machine_cost_per_part: '0.0605', labor_cost_per_part: '0.0920' });

  it('an operation whose engine states the split shows its labor and its machine (direct overhead) apart, and with its setup they are its cost', () => {
    const v = row(buildCostTable(input({ processes: [molding as never] })), 'process:m').values;
    expect(v).toMatchObject({ laborCost: 0.092, directOverhead: 0.0605, amortizedBatchSetup: 0.4574 });
    expect(Number(v.laborCost) + Number(v.directOverhead) + Number(v.amortizedBatchSetup)).toBeCloseTo(0.6099, 4);
  });

  it('an operation whose engine does not state it leaves both empty: no zero stands in for an unknown split', () => {
    const v = row(buildCostTable(input()), 'process:a').values;
    expect(v.laborCost).toBeNull();
    expect(v.directOverhead).toBeNull();
  });

  it('the group and the part add up the operations that have it', () => {
    const t = buildCostTable(input({ processes: [molding as never, process({ id: 'n', operation: 'Inspection', process_group: 'Plastic Molding', total_cost_per_part: '0.05', setup_cost_per_part: '0' }) as never] }));
    expect(row(t, 'group:Plastic Molding').values.laborCost).toBeCloseTo(0.092, 4);
    expect(row(t, 'part:i1').values.directOverhead).toBeCloseTo(0.0605, 4);
  });

  it('both are columns of the Variable Costs band', () => {
    expect(COST_COLUMNS.filter((c) => c.key === 'laborCost' || c.key === 'directOverhead').map((c) => c.group)).toEqual(['Variable Costs', 'Variable Costs']);
  });
});

// Migration 1009: an operation's cycle phases, as its stored calculator gave them, are its children, with their time and no money.
describe('buildCostTable — cycle phases', () => {
  const molding = process({
    id: 'im', operation: 'Injection Molding', process_group: 'Plastic Molding', cycle_time: '6.20', total_cost_per_part: '0.53', setup_cost_per_part: '0.295',
    cycle_phases: [{ name: 'Fill Time', seconds: 0.12 }, { name: 'Pack Time', seconds: 2 }, { name: 'Cooling Time', seconds: 2.9 }, { name: 'Press Dry Cycle Time', seconds: 1.18 }],
  });

  it('puts each phase under its operation, in order, with its time', () => {
    const t = buildCostTable(input({ processes: [molding as never] }));
    const phases = t.rows.filter((r) => r.parentId === 'process:im');
    expect(phases.map((r) => [r.kind, r.name, r.values.laborTimeSec])).toEqual([
      ['phase', 'Fill Time', 0.12], ['phase', 'Pack Time', 2], ['phase', 'Cooling Time', 2.9], ['phase', 'Press Dry Cycle Time', 1.18],
    ]);
    // a phase is a time, never money
    for (const r of phases) expect(Object.keys(r.values)).toEqual(['laborTimeSec']);
  });

  it('adds nothing to the group or the part: the operation is counted once', () => {
    const t = buildCostTable(input({ processes: [molding as never] }));
    expect(row(t, 'group:Plastic Molding').values.totalVariable).toBeCloseTo(0.53, 6);
    expect(row(t, 'part:i1').values.totalVariable).toBeCloseTo(0.101168 + 0.53, 6);
  });

  it('a record without phases (no calculator cycle, or applied before) has no children', () => {
    const t = buildCostTable(input());
    expect(t.rows.some((r) => r.kind === 'phase')).toBe(false);
    expect(buildCostTable(input({ processes: [process({ id: 'x', cycle_phases: 'not a list' }) as never] })).rows.some((r) => r.kind === 'phase')).toBe(false);
  });
});
