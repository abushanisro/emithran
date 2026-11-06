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
