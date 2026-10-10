import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { cachedRead } from '../costing/shared/core/request-cache';

/**
 * The 4 real, verified roles a Machining process_taxonomy row can carry —
 * see migration 780's header for the full rationale and per-role
 * verification basis. Not machine-class identifiers: a new real machine
 * class never needs a new value here, only a new process_taxonomy row
 * tagged with an existing one.
 */
type MachiningRouteRole = 'primary_milling' | 'primary_turning' | 'secondary_operation' | 'inspection';

/**
 * Discovers the real, DB-backed set of Machining machine classes eligible
 * for a given role and location — the literal replacement for every
 * hardcoded CNC machine-class array/union this service's callers used to
 * read from (Section G.1, C:\Users\singi\.claude\plans\
 * logical-noodling-lampson.md).
 *
 * Phase 0: built and unit-tested, not yet called from any production code
 * path. Phase 1 wires this into the requirement-builder, route builders,
 * and process registry, replacing the fixed-3 arrays/records those call
 * sites use today.
 *
 * Deliberately answers only "what classes exist and are priceable" — NOT
 * "what's physically feasible for this specific part" (that stays exactly
 * where it already lives: checkMachiningCapability/checkMachineCapability's
 * per-candidate envelope check, unchanged by this service).
 */
@Injectable()
export class MachineDiscoveryService {
  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Distinct, real mhr_records.machine_class values for Machining stations
   * tagged with `role`, that have a resolvable rate at `location`.
   *
   * Requires migration 780 (process_taxonomy.machining_route_role) and 781
   * (mhr_records.canonical_process_id backfill for Machining) to return
   * anything — before those migrations run, or for a role/location with no
   * real data yet, this correctly returns an empty array rather than
   * fabricating a class.
   */
  async getEligibleClasses(role: MachiningRouteRole, location: string, accessToken: string): Promise<string[]> {
    const client = this.supabaseService.getClient(accessToken);

    const rows = await cachedRead(`machining-eligible-classes:${role}:${location}`, async () => {
      const { data } = await client
        .from('mhr_records')
        .select('machine_class, process_taxonomy!inner(process_group, machining_route_role)')
        .eq('location', location)
        .eq('process_taxonomy.process_group', 'Machining')
        .eq('process_taxonomy.machining_route_role', role)
        .not('total_machine_hour_rate', 'is', null);
      return data;
    });

    const classes = new Set<string>();
    for (const row of rows ?? []) {
      const machineClass = (row as { machine_class?: string | null }).machine_class;
      if (machineClass) classes.add(machineClass);
    }
    return [...classes].sort();
  }
}
