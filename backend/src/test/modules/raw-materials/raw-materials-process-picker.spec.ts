import { RawMaterialsService } from '../../../modules/raw-materials/raw-materials.service';
import { moldingFeedstockFilter } from '../../../modules/raw-materials/material-moldability';

// A recording stand-in for the PostgREST query builder: every call is kept, and awaiting it answers with `rows`.
function recordingClient(rows: unknown[], links: Record<string, string[]>) {
  const calls: Array<[string, unknown[]]> = [];
  const builder: any = new Proxy({}, {
    get(_t, name: string) {
      if (name === 'then') return (resolve: (v: unknown) => void) => resolve({ data: rows, error: null, count: rows.length });
      return (...args: unknown[]) => { calls.push([name, args]); return builder; };
    },
  });
  const linkBuilder: any = {
    select: () => linkBuilder,
    eq: async (_column: string, processGroup: string) => ({ data: (links[processGroup] ?? []).map((material_group) => ({ material_group })), error: null }),
  };
  const client = { from: (table: string) => (table === 'process_material_groups' ? linkBuilder : { select: (...a: unknown[]) => { calls.push(['select', a]); return builder; } }) };
  return { client, calls };
}

function serviceOver(client: unknown) {
  const database = { getUserClient: () => client } as never;
  const logger = { log: () => undefined, error: () => undefined, warn: () => undefined } as never;
  return new RawMaterialsService(database, logger);
}

describe('the material picker for a process group', () => {
  const links = { 'Plastic Molding': ['Plastic & Rubber'], Machining: ['Steel'] };

  it('offers a molding process only molding feedstock: the printing resins in its material group are filtered out in the database', async () => {
    const { client, calls } = recordingClient([], links);
    await serviceOver(client).findAll({ processGroup: 'Plastic Molding' } as never);
    expect(calls).toContainEqual(['in', ['material_group', ['Plastic & Rubber']]]);
    expect(calls).toContainEqual(['or', [moldingFeedstockFilter()]]);
  });

  it('does not filter any other process by form', async () => {
    const { client, calls } = recordingClient([], links);
    await serviceOver(client).findAll({ processGroup: 'Machining' } as never);
    expect(calls.filter(([name]) => name === 'or')).toEqual([]);
  });

  it('does not filter a list that names no process', async () => {
    const { client, calls } = recordingClient([], links);
    await serviceOver(client).findAll({} as never);
    expect(calls.filter(([name]) => name === 'or')).toEqual([]);
  });
});
