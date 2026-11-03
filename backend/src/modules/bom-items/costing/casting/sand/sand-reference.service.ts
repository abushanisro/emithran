import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../../common/database/database.service';
import { resolveSandReference, SAND_CASTING_SOURCE_VERSION, type SandReference } from './sand-reference';

/**
 * Loads the staged memory/Sand casting rows (variables and lookup tables, source version 2026-SandCasting) and resolves them
 * (sand-reference.ts). One read per process: every sand step reads the same rows, and a successful read is cached; a read error
 * is reported and not cached. Machines and materials are editable rows and are read where they are used, not here.
 */
@Injectable()
export class SandReferenceService {
  constructor(private readonly database: DatabaseService) {}

  private cached: SandReference | null = null;

  async get(): Promise<{ reference: SandReference | null; missing: string[] }> {
    if (this.cached) return { reference: this.cached, missing: [] };
    // Public-read reference data with no user context.
    const db = this.database.getPrivilegedClient('reference-data: machining_reference_data, public-read');
    const [variables, lookups] = await Promise.all([
      db.from('machining_reference_data').select('key, value, unit_type')
        .eq('category', 'variable').eq('source_version', SAND_CASTING_SOURCE_VERSION),
      db.from('machining_reference_data').select('key, raw')
        .eq('category', 'lookup_table').eq('source_version', SAND_CASTING_SOURCE_VERSION),
    ]);
    const error = variables.error ?? lookups.error;
    if (error) return { reference: null, missing: [`Sand casting reference data (${error.message})`] };
    if (!(variables.data ?? []).length && !(lookups.data ?? []).length) {
      return { reference: null, missing: [`Sand casting reference data is not staged (source version ${SAND_CASTING_SOURCE_VERSION}, migration 853)`] };
    }
    this.cached = resolveSandReference({ variables: variables.data ?? [], lookups: lookups.data ?? [] });
    return { reference: this.cached, missing: [] };
  }
}
