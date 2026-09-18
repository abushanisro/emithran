import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { cachedRead } from '../costing/shared/core/request-cache';

@Injectable()
export class CalculatorCatalogService {
  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * The calculator catalog for one request, in three queries instead of N.
   *
   * Root cause this removes (measured 2026-09-09): getCostSummary spent
   * essentially all of its 11-12s in PostgREST round trips -- 61 calls at
   * 250-500ms each against the hosted database, no CPU hot spot. 19 of those
   * were catalog reads issued one operation at a time by resolvePhysicsQuantity:
   * per operation a mapping lookup, then that calculator version, then that
   * calculator definition. A route with seven costed operations paid for
   * twenty-one sequential round trips to read a catalog of 18 rows.
   *
   * Memoising them was tried first and did nothing: every key is distinct
   * (verified -- 19 invocations, 19 distinct keys, 0 repeats), because each
   * lookup asks about a different machine class. The problem was never a
   * repeated read, it was N+1.
   *
   * So the whole working set is fetched once: 18 active mappings, the 14
   * calculators they reference, and the 241 field rows for those calculators.
   * Every per-operation lookup then resolves in memory. Sizes are from the live
   * database, not assumed, and the mapping filter is the same one the callers
   * applied per class -- only the round trip is gone.
   *
   * Cached per request (request-cache.ts), so a catalog migration is visible on
   * the next request and every consumer in one request shares one fetch.
   */
  loadCalculatorCatalog(accessToken: string): Promise<{
    mappings: any[];
    mappingsError: { message: string } | null;
    calculators: any[];
    fields: any[];
  }> {
    return cachedRead('calculator-catalog', async () => {
      const client = this.supabaseService.getClient(accessToken);
      const { data: mappings, error } = await client
        .from('process_calculator_mappings')
        .select('machine_class, operation, calculator_id, display_order, process_group, process_route, lhr_process_group, applicable_families, canonical_process_id')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      const ids = [...new Set((mappings ?? []).map((m: any) => m.calculator_id).filter(Boolean))];
      if (ids.length === 0) {
        return { mappings: mappings ?? [], mappingsError: error ?? null, calculators: [], fields: [] };
      }

      const [{ data: calculators }, { data: fields }] = await Promise.all([
        client.from('calculators').select('id, version, physics_key').in('id', ids),
        client
          .from('calculator_fields')
          .select('id, calculator_id, field_name, display_label, field_type, unit, default_value, display_order')
          .in('calculator_id', ids)
          .order('display_order'),
      ]);

      return {
        mappings: mappings ?? [],
        mappingsError: error ?? null,
        calculators: calculators ?? [],
        fields: fields ?? [],
      };
    });
  }
}
