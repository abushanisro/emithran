/**
 * An in-memory stand-in for the PostgREST client surface the services use (`from(...).select/insert/update/delete/eq/in/...`,
 * `rpc`). Tests answer each request from a handler and assert on the recorded calls; nothing goes over the network.
 */
export type Op = 'select' | 'insert' | 'update' | 'delete';
export interface Call { table: string; op: Op; filters: Array<[string, unknown]>; payload?: unknown }
export type Result = { data: unknown; error: unknown };
export type Handler = (call: Call) => Result;

/** Every request is recorded, and `handler` answers it once the query is awaited. */
export function fakeClient(handler: Handler, rpc: (fn: string, args: unknown) => Result = () => ({ data: null, error: null })) {
  const calls: Call[] = [];
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];
  const client = {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] };
      const run = async () => { calls.push(call); return handler(call); };
      const q: any = {
        select: () => q,
        insert: (payload: unknown) => { call.op = 'insert'; call.payload = payload; return q; },
        update: (payload: unknown) => { call.op = 'update'; call.payload = payload; return q; },
        delete: () => { call.op = 'delete'; return q; },
        eq: (column: string, value: unknown) => { call.filters.push([column, value]); return q; },
        in: (column: string, value: unknown) => { call.filters.push([column, value]); return q; },
        order: () => q,
        limit: () => q,
        single: run,
        maybeSingle: run,
        then: (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => run().then(resolve, reject),
      };
      return q;
    },
    rpc(fn: string, args: unknown) {
      const run = async () => { rpcCalls.push({ fn, args }); return rpc(fn, args); };
      return {
        single: run,
        maybeSingle: run,
        then: (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => run().then(resolve, reject),
      };
    },
  };
  return { client, calls, rpcCalls };
}

