import { csv, defined, loadReference, referenceRows } from './forging-fixtures';
import { FORGING_STEPS } from '../../../../../modules/bom-items/costing/forging/forging-line';
import { FORGING_REFERENCE_SOURCE_VERSION } from '../../../../../modules/bom-items/costing/forging/forging-reference';
import { ForgingReferenceService } from '../../../../../modules/bom-items/costing/forging/forging-reference.service';

interface Answer { data: unknown; error: null | { message: string } }

/** A fake PostgREST client that records every filter and answers from `answer(table, filters)`. */
function fakeClient(answer: (table: string, filters: Record<string, unknown>) => Answer) {
  const calls: { table: string; filters: Record<string, unknown> }[] = [];
  const client = {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (c: string, v: unknown) => ((filters[c] = v), chain),
        in: (c: string, v: unknown) => ((filters[c] = v), chain),
        or: (v: string) => ((filters.or = v), chain),
        order: () => chain,
        limit: () => chain,
        then: (resolve: (r: unknown) => unknown) => {
          calls.push({ table, filters });
          return Promise.resolve(answer(table, filters)).then(resolve);
        },
      };
      return chain;
    },
  };
  return { client, calls };
}

/** The staged rows as machining_reference_data returns them (value as text, lookups as raw.rows). */
function stagedAnswer(table: string, filters: Record<string, unknown>): Answer {
  if (table !== 'machining_reference_data') return { data: [], error: null };
  const rows = referenceRows();
  if (filters.category === 'variable') {
    return { data: rows.variables.map((v) => ({ key: v.key, value: v.value == null ? null : String(v.value) })), error: null };
  }
  return { data: Object.entries(rows.lookups).map(([key, r]) => ({ key, raw: { rows: r } })), error: null };
}

describe('ForgingReferenceService.getReference', () => {
  it('reads the forging source version only and resolves to the same reference the engine tests use', async () => {
    const { client, calls } = fakeClient(stagedAnswer);
    const service = new ForgingReferenceService({ getPrivilegedClient: () => client } as never);
    const { reference, missing } = await service.getReference();
    expect(missing).toEqual([]);
    const expected = loadReference();
    expect(reference?.variables).toEqual(expected.variables);
    expect(reference?.switches).toEqual(expected.switches);
    expect(reference?.flashPctByComplexity).toEqual(expected.flashPctByComplexity);
    expect(reference?.roundBarSizesMm).toEqual(expected.roundBarSizesMm);
    expect(reference?.toolCoatingFactor).toEqual(expected.toolCoatingFactor);
    expect(calls.map((c) => c.filters.source_version)).toEqual([FORGING_REFERENCE_SOURCE_VERSION, FORGING_REFERENCE_SOURCE_VERSION]);
  });

  it('caches a complete read', async () => {
    const { client, calls } = fakeClient(stagedAnswer);
    const service = new ForgingReferenceService({ getPrivilegedClient: () => client } as never);
    await service.getReference();
    await service.getReference();
    expect(calls).toHaveLength(2); // one variables read and one lookups read, not four
  });

  it('does not cache a failed read, and names the error', async () => {
    let fail = true;
    const { client } = fakeClient((t, f) => (fail ? { data: null, error: { message: 'down' } } : stagedAnswer(t, f)));
    const service = new ForgingReferenceService({ getPrivilegedClient: () => client } as never);
    const first = await service.getReference();
    expect(first.reference).toBeNull();
    expect(first.missing[0]).toMatch(/down/);
    fail = false;
    expect((await service.getReference()).reference).not.toBeNull();
  });

  it('does not cache and does not guess when nothing is staged: it names each missing table and variable', async () => {
    const { client } = fakeClient(() => ({ data: [], error: null }));
    const service = new ForgingReferenceService({ getPrivilegedClient: () => client } as never);
    const { reference, missing } = await service.getReference();
    expect(reference).toBeNull();
    expect(missing).toEqual(expect.arrayContaining(['variables bandSawKerfWidth', 'forging_roundBarSizes', 'forging_partComplexityBasedData']));
  });
});

describe('ForgingReferenceService.getMaterial', () => {
  const material = defined(csv('forging_materials.csv').find((m) => m.Name === 'Steel, Hot Worked, AISI 1045'), 'Steel, Hot Worked, AISI 1045');
  const answer = (table: string): Answer =>
    table === 'raw_materials'
      ? { data: [{ id: 'm1', name: 'Steel, Hot Worked, AISI 1045', material_type: material['Material Type'], density_kg_m3: material['Density (kg / m^3)'], cost_usa: material['Round Bar Unit Cost (USD / kg)'], cut_code: material['Cut Code'] }], error: null }
      : { data: [{ property_key: 'forging_temperature', value_num: material['Forging Temperature (C)'] }], error: null };

  it('looks the grade up in the Forging group only, and resolves the row with its properties', async () => {
    const { client, calls } = fakeClient(answer);
    const service = new ForgingReferenceService({ getPrivilegedClient: () => client } as never);
    const found = await service.getMaterial(client as never, 'steel, hot worked, aisi 1045');
    expect(found?.name).toBe('Steel, Hot Worked, AISI 1045');
    expect(found?.densityKgM3).toBe(material['Density (kg / m^3)']);
    expect(found?.roundBarUsdPerKg).toBe(material['Round Bar Unit Cost (USD / kg)']);
    expect(found?.forgingTempC).toBe(material['Forging Temperature (C)']);
    expect(calls[0]?.filters.material_group).toBe('Forging');
  });

  it('is null for an empty grade, a failed read, no match, or an ambiguous match', async () => {
    const service = new ForgingReferenceService({ getPrivilegedClient: () => undefined } as never);
    expect(await service.getMaterial(fakeClient(answer).client as never, ' ')).toBeNull();
    expect(await service.getMaterial(fakeClient(() => ({ data: null, error: { message: 'x' } })).client as never, 'Steel, Hot Worked, AISI 1045')).toBeNull();
    expect(await service.getMaterial(fakeClient(() => ({ data: [], error: null })).client as never, 'Steel, Hot Worked, AISI 1045')).toBeNull();
    expect(await service.getMaterial(fakeClient(() => ({ data: [{ id: 1 }, { id: 2 }], error: null })).client as never, 'Steel, Hot Worked, AISI 1045')).toBeNull();
  });
});

describe('ForgingReferenceService.getForgingMachines', () => {
  it('reads one HR Rates class and location, and maps the staged columns', async () => {
    const { client, calls } = fakeClient(() => ({
      data: [{ id: 7, machine_name: 'Lasco KFP 1000', mhr_usd_per_hour: '120.5', usd_labor_rate_per_hr: 40, operators: 2, setup_time_hr: '0.5', specs: { press_force_kn: 10000 } }],
      error: null,
    }));
    const service = new ForgingReferenceService({ getPrivilegedClient: () => client } as never);
    const [m] = await service.getForgingMachines(client as never, FORGING_STEPS.press.machineClass, 'USA');
    expect(calls[0]?.filters).toMatchObject({ machine_class: 'forging_press', location: 'USA' });
    expect(m).toEqual({
      id: '7', name: 'Lasco KFP 1000', machineClass: 'forging_press',
      machineRatePerHr: 120.5, labourRatePerHr: 40, operators: 2, setupTimeHr: 0.5, specs: { press_force_kn: 10000 },
    });
  });

  it('keeps a missing rate as null rather than zero, and returns nothing on a read error', async () => {
    const service = new ForgingReferenceService({ getPrivilegedClient: () => undefined } as never);
    const noRate = fakeClient(() => ({ data: [{ id: 1, machine_name: 'X', mhr_usd_per_hour: null, usd_labor_rate_per_hr: '', operators: null, setup_time_hr: null, specs: null }], error: null }));
    const [m] = await service.getForgingMachines(noRate.client as never, 'forging_trim', 'USA');
    expect(m).toMatchObject({ machineRatePerHr: null, labourRatePerHr: null, operators: null, specs: {} });
    expect(await service.getForgingMachines(fakeClient(() => ({ data: null, error: { message: 'x' } })).client as never, 'forging_trim', 'USA')).toEqual([]);
  });
});
