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
    const read = await readStagedReference(this.database, SAND_CASTING_SOURCE_VERSION, 'Sand casting', 853);
    if (read.reference) this.cached = read.reference;
    return read;
  }
}

/**
 * The staged variables and lookup tables of one reference-data source version, resolved (sand-reference.ts): the read every casting route that
 * keeps its reference this way shares. A read error or an unstaged version is reported by name, never an empty reference.
 */
export async function readStagedReference(database: DatabaseService, sourceVersion: string, label: string, stagedBy: number): Promise<{ reference: SandReference | null; missing: string[] }> {
  // Public-read reference data with no user context.
  const db = database.getPrivilegedClient('reference-data: machining_reference_data, public-read');
  const [variables, lookups] = await Promise.all([
    db.from('machining_reference_data').select('key, value, unit_type')
      .eq('category', 'variable').eq('source_version', sourceVersion),
    db.from('machining_reference_data').select('key, raw')
      .eq('category', 'lookup_table').eq('source_version', sourceVersion),
  ]);
  const error = variables.error ?? lookups.error;
  if (error) return { reference: null, missing: [`${label} reference data (${error.message})`] };
  if (!(variables.data ?? []).length && !(lookups.data ?? []).length) {
    return { reference: null, missing: [`${label} reference data is not staged (source version ${sourceVersion}, migration ${stagedBy})`] };
  }
  return { reference: resolveSandReference({ variables: variables.data ?? [], lookups: lookups.data ?? [] }), missing: [] };
}
