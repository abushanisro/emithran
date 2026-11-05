import type { DatabaseService } from '../../../../common/database/database.service';
import { readAllRows, type RowPage } from '../../../../common/database/read-all-rows';
import { cachedBatch } from './core/request-cache';

type Client = ReturnType<DatabaseService['getClient']>;

/**
 * The catalog operation strings (process_taxonomy_operations.raw_compound_string) of each process, read once per process per request
 * (a route comparison attaches every route and the routes share most processes). Organization-scoped under RLS, so it stays in the
 * request-scoped cache, never in a cross-request one. Shared by the sheet-metal and plastic-molding catalog-operation services.
 */
export async function catalogRowsByProcess(client: Client, canonicalIds: readonly string[]): Promise<Map<string, string[]> | { error: string }> {
  try {
    return await cachedBatch<string[]>('catalog-operations', canonicalIds, async (missing) => {
      const res = await readAllRows<{ canonical_process_id: string; raw_compound_string: string }>((from, to) =>
        client.from('process_taxonomy_operations')
          .select('canonical_process_id, raw_compound_string')
          .in('canonical_process_id', missing)
          .order('id')
          .range(from, to) as unknown as PromiseLike<RowPage<{ canonical_process_id: string; raw_compound_string: string }>>);
      if (res.error) throw new Error(res.error.message);
      // a process with no catalog rows is a real answer too: remember it as empty, not as unasked
      const byProcess = new Map<string, string[]>(missing.map((id) => [id, []]));
      for (const r of res.data) byProcess.get(r.canonical_process_id)?.push(r.raw_compound_string);
      return byProcess;
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
