import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../../../common/supabase/supabase.service';
import MANIFEST from '../../../../processes/memory-reference-domains.json';
import { MACHINING_REFERENCE_SOURCE_VERSION } from '../../machining/lookup/machining-lookup-tables';
import { resolveOperationLinks, type OperationLink } from './machining-need';
import { resolveCapabilityTable, resolveIsoTable, type CapabilityRow, type IsoToleranceRow } from './process-capability';

const STANDARDS_SOURCE_VERSION: string = MANIFEST.domains.find((d) => d.key === 'standards')!.sourceVersion;

export interface ToleranceReference {
  capability: CapabilityRow[];
  iso: IsoToleranceRow[];
  links: OperationLink[];
}

/**
 * The three staged tables tolerance decisions read:
 *   tblGtolProcessCapabilities     memory/Machining/lookup (migration 747)
 *   operation_capability_process   memory/Machining/lookup (migration 882)
 *   iso286_standard_tolerances     memory/Standards/lookup (migration 880)
 * Cached per process; a read error or a missing table is not cached.
 */
@Injectable()
export class ToleranceReferenceService {
  constructor(private readonly supabase: SupabaseService) {}

  private cached: { reference: ToleranceReference | null; missing: string[] } | null = null;

  async get(): Promise<{ reference: ToleranceReference | null; missing: string[] }> {
    if (this.cached) return this.cached;
    const db = this.supabase.getPrivilegedClient('reference-data: machining_reference_data, public-read');
    const table = async (sourceVersion: string, key: string) => {
      const { data, error } = await db.from('machining_reference_data').select('raw')
        .eq('category', 'lookup_table').eq('source_version', sourceVersion).eq('key', key).maybeSingle();
      // Staged either as a bare row array (migrations 739-751, e.g.
      // tblGtolProcessCapabilities) or as { rows } (809 onward, 823 onward),
      // the same two shapes MachiningLookupService.loadTable reads.
      const raw = (data as { raw?: unknown } | null)?.raw as { rows?: unknown } | unknown[] | undefined;
      const rows = Array.isArray(raw) ? raw : Array.isArray((raw as { rows?: unknown })?.rows) ? (raw as { rows: unknown[] }).rows : null;
      const why = error?.message ?? (data ? 'staged, but not in a row-table shape' : null);
      return { rows: rows as Array<Record<string, unknown>> | null, error: why };
    };
    const [cap, links, iso] = await Promise.all([
      table(MACHINING_REFERENCE_SOURCE_VERSION, 'tblGtolProcessCapabilities'),
      table(MACHINING_REFERENCE_SOURCE_VERSION, 'operation_capability_process'),
      table(STANDARDS_SOURCE_VERSION, 'iso286_standard_tolerances'),
    ]);
    const missing = [
      ...(cap.rows ? [] : [`tblGtolProcessCapabilities (${cap.error ?? 'not staged, migration 747'})`]),
      ...(links.rows ? [] : [`operation_capability_process (${links.error ?? 'not staged, migration 882'})`]),
      ...(iso.rows ? [] : [`iso286_standard_tolerances (${iso.error ?? 'not staged, migration 880'})`]),
    ];
    const result = missing.length
      ? { reference: null, missing }
      : {
          reference: {
            capability: resolveCapabilityTable(cap.rows!),
            iso: resolveIsoTable(iso.rows!),
            links: resolveOperationLinks(links.rows!),
          },
          missing,
        };
    if (result.reference) this.cached = result;
    return result;
  }
}
