import { AuditController } from './audit.controller';

/** A user-scoped client that records the filters it was given and answers with `rows`. */
function setup(rows: { id: number }[]) {
  const calls: [string, ...unknown[]][] = [];
  const chain: any = new Proxy({}, {
    get: (_t, name: string) => name === 'then'
      ? (resolve: (v: unknown) => void) => resolve({ data: rows, error: null })
      : (...args: unknown[]) => { calls.push([name, ...args]); return chain; },
  });
  const controller = new AuditController({ getUserClient: () => ({ from: (t: string) => { calls.push(['from', t]); return chain; } }) } as never);
  return { controller, calls };
}

describe('AuditController', () => {
  it('reads as the signed-in user, newest first, one more row than asked for', async () => {
    const { controller, calls } = setup([{ id: 3 }, { id: 2 }]);
    await controller.list({}, 'token');
    expect(calls).toContainEqual(['from', 'audit_events']);
    expect(calls).toContainEqual(['order', 'id', { ascending: false }]);
    expect(calls).toContainEqual(['limit', 51]);
  });

  it('applies each filter it was given and none it was not', async () => {
    const { controller, calls } = setup([]);
    await controller.list({ action: 'bom.deleted', actorId: 'a', organizationId: 'o', from: '2026-01-01', to: '2026-02-01', before: 90 }, 't');
    expect(calls.filter(([name]) => ['eq', 'gte', 'lte', 'lt'].includes(name))).toEqual([
      ['eq', 'action', 'bom.deleted'], ['eq', 'actor_id', 'a'], ['eq', 'org_id', 'o'], ['gte', 'at', '2026-01-01'], ['lte', 'at', '2026-02-01'], ['lt', 'id', 90],
    ]);
    const bare = setup([]);
    await bare.controller.list({}, 't');
    expect(bare.calls.filter(([name]) => ['eq', 'gte', 'lte', 'lt'].includes(name))).toEqual([]);
  });

  it('pages with a cursor: a full page gives the id to continue from, the last page gives null', async () => {
    const full = await setup([{ id: 9 }, { id: 8 }, { id: 7 }]).controller.list({ limit: 2 }, 't');
    expect(full).toEqual({ items: [{ id: 9 }, { id: 8 }], nextCursor: 8 });
    const last = await setup([{ id: 2 }, { id: 1 }]).controller.list({ limit: 2 }, 't');
    expect(last).toEqual({ items: [{ id: 2 }, { id: 1 }], nextCursor: null });
  });
});
