import { join } from 'path';
import { CastingReferenceService } from '../../../../../modules/bom-items/costing/casting/casting-reference.service';
import {
  CASTING_REFERENCE_SOURCE_VERSION,
  SAND_CASTING_REFERENCE_SOURCE_VERSION,
  CASTING_LOOKUP_KEYS,
} from '../../../../../modules/bom-items/costing/casting/casting-reference';

/** A fake PostgREST client that records every filter and answers from `tables[table]`. */
function fakeClient(answer: (table: string, filters: Record<string, unknown>) => { data: unknown; error: null | { message: string } }) {
  const calls: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const client = {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const chain: any = {
        select: () => chain,
        eq: (c: string, v: unknown) => ((filters[c] = v), chain),
        in: (c: string, v: unknown) => ((filters[c] = v), chain),
        or: (_: string) => chain,
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

const sandRows = [
  { key: 'lookupTables_Component_tblMinHoleDiameter', raw: { rows: [{ 'Material Type': 'Aluminum', 'Min Hole Diameter (mm)': 4.8, 'Process Name': 'Sand Casting' }] } },
  { key: 'lookupTables_Component_tblWallThickness', raw: { rows: [{ 'Material Type': 'Aluminum', 'Maximum Wall Thickness (mm)': 1016, 'Minimum Wall Thickness (mm)': 3, 'Process Name': 'Sand Casting' }] } },
];

describe('CastingReferenceService castability by process', () => {
  it('reads sand-casting limits from the sand-casting source version, once', async () => {
    const { client, calls } = fakeClient(() => ({ data: sandRows, error: null }));
    const service = new CastingReferenceService({ getPrivilegedClient: () => client } as never);
    const first = await service.getCastabilityReference('sand_casting');
    await service.getCastabilityReference('sand_casting');
    expect(first.reference?.minHoleDiameter).toEqual([{ materialType: 'Aluminum', process: 'Sand Casting', diameterMm: 4.8 }]);
    expect(calls).toHaveLength(1); // cached after the first successful read
    expect(calls[0]!.filters['source_version']).toBe(SAND_CASTING_REFERENCE_SOURCE_VERSION);
    expect(SAND_CASTING_REFERENCE_SOURCE_VERSION).not.toBe(CASTING_REFERENCE_SOURCE_VERSION);
  });

  it('does not cache a failed read, and names what is missing', async () => {
    let fail = true;
    const { client } = fakeClient(() => (fail ? { data: null, error: { message: 'down' } } : { data: [], error: null }));
    const service = new CastingReferenceService({ getPrivilegedClient: () => client } as never);
    expect((await service.getCastabilityReference('sand_casting')).missing[0]).toMatch(/down/);
    fail = false;
    const empty = await service.getCastabilityReference('sand_casting');
    expect(empty.reference).toBeNull();
    expect(empty.missing.join(' ')).toMatch(/not staged/);
  });

  it('looks a material up in the group of its own process', async () => {
    for (const [process, group] of [['sand_casting', 'Sand Casting'], ['die_casting', 'Die Casting']] as const) {
      const { client, calls } = fakeClient(() => ({ data: [], error: null }));
      await new CastingReferenceService({} as never).getMaterial(client as never, 'AA 356', process);
      expect(calls[0]!.filters['material_group']).toBe(group);
    }
  });

  it('judges a material by die casting unless told otherwise', async () => {
    const { client, calls } = fakeClient(() => ({ data: [], error: null }));
    await new CastingReferenceService({} as never).getMaterial(client as never, 'ZA-8');
    expect(calls[0]!.filters['material_group']).toBe('Die Casting');
  });
});

describe('CastingReferenceService die-casting reference caching', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
  const DIR = join(__dirname, '../../../../../../../memory/Die Casting');
  const csv = (rel: string): Array<Record<string, any>> => readCsv(join(DIR, rel)).rows;
  const staged = {
    variable: csv('Die casting_variables.csv').map((r) => ({ key: String(r['Variable Name']), value: r['String Value'] })),
    lookup_table: CASTING_LOOKUP_KEYS.map((k) => ({ key: k, raw: { rows: csv(`Lookup/${k}.csv`) } })),
  };

  it('a table not staged yet is not cached: staging it later takes effect without a restart', async () => {
    let isStaged = false;
    const { client } = fakeClient((_t, f) => ({
      data: isStaged ? staged[f['category'] as 'variable' | 'lookup_table'] : [],
      error: null,
    }));
    const service = new CastingReferenceService({ getPrivilegedClient: () => client } as never);
    const before = await service.getReference();
    expect(before.reference).toBeNull();
    expect(before.missing.length).toBeGreaterThan(0);
    isStaged = true;
    const after = await service.getReference();
    expect(after.missing).toEqual([]);
    expect(after.reference!.clampForceSafetyFactor).toBe(1.5);
  });

  it('a resolved reference is read once', async () => {
    const { client, calls } = fakeClient((_t, f) => ({ data: staged[f['category'] as 'variable' | 'lookup_table'], error: null }));
    const service = new CastingReferenceService({ getPrivilegedClient: () => client } as never);
    await service.getReference();
    await service.getReference();
    expect(calls).toHaveLength(2); // variables + lookups, once
  });
});
