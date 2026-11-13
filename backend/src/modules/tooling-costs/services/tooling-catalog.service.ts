import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { flattenMachiningLookupTable, MACHINING_REFERENCE_SOURCE_VERSION } from '../../bom-items/costing/machining/lookup/machining-lookup-tables';
import {
  TOOLING_CATALOGS,
  SHEET_METAL_COMPONENT_TABLE,
  catalogDomains,
  catalogItems,
  memorySourceVersion,
  type CatalogTableDef,
  type ToolingCatalogItem,
} from '../catalog/tooling-catalog';

export interface ToolingCatalog {
  domain: string;
  label: string;
  items: ToolingCatalogItem[];
  /** Rows of a catalog table with no name or price: shown so a gap is visible, never costed at zero. */
  unpriced: Array<{ table: string; name: string }>;
  /** Catalog tables not found in the staged data. */
  missingTables: string[];
}

/** The priced tooling items of a domain, read from its staged reference tables (both are public-read, so the caller's own client is used). */
@Injectable()
export class ToolingCatalogService {
  constructor(private readonly databaseService: DatabaseService) {}

  domains() {
    return catalogDomains();
  }

  async catalog(domain: string, accessToken: string): Promise<ToolingCatalog> {
    const defs = TOOLING_CATALOGS[domain];
    const known = catalogDomains();
    if (!defs) {
      throw new BadRequestException(`"${domain}" has no tooling catalog; one of: ${known.map((d) => d.key).join(', ')}`);
    }
    const db = this.databaseService.getClient(accessToken);
    const result: ToolingCatalog = { domain, label: known.find((d) => d.key === domain)!.label, items: [], unpriced: [], missingTables: [] };
    for (const def of defs) {
      const loaded = await this.rows(db, domain, def);
      if (!loaded) {
        result.missingTables.push(def.table);
        continue;
      }
      const { items, unpriced } = catalogItems(def, loaded.dataset, loaded.rows);
      result.items.push(...items);
      result.unpriced.push(...unpriced.map((name) => ({ table: def.table, name })));
    }
    return result;
  }

  private async rows(db: ReturnType<DatabaseService['getClient']>, domain: string, def: CatalogTableDef) {
    if (def.table === SHEET_METAL_COMPONENT_TABLE) {
      const { data, error } = await db.from(SHEET_METAL_COMPONENT_TABLE).select('*').order('id');
      if (error) throw new InternalServerErrorException(`Failed to read ${def.table}: ${error.message}`);
      return data?.length ? { dataset: SHEET_METAL_COMPONENT_TABLE, rows: data as Record<string, unknown>[] } : null;
    }
    const dataset = memorySourceVersion(domain) ?? MACHINING_REFERENCE_SOURCE_VERSION;
    const { data, error } = await db
      .from('machining_reference_data')
      .select('raw')
      .eq('category', 'lookup_table')
      .eq('source_version', dataset)
      .eq('key', def.table)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(`Failed to read ${def.table}: ${error.message}`);
    if (!data?.raw) return null;
    return { dataset, rows: flattenMachiningLookupTable(def.table, data.raw).rows as Record<string, unknown>[] };
  }
}
