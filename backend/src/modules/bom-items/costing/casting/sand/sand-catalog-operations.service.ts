import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../../common/database/database.service';
import type { ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import { catalogRowsByProcess } from '../../shared/catalog-rows-by-process';
import { resolveSandCatalogOperations, type SandFeature } from './sand-catalog-operations';
import { CORE_PROCESSES } from './sand-cores';
import { MOULDING_PROCESSES } from './sand-route';

const SAND_CASTING = 'Sand Casting';
const processOfClass = (table: ReadonlyArray<{ process: string; machineClass: string }>, cls: string | undefined) =>
  table.find((p) => p.machineClass === cls)?.process;

/**
 * Attaches the sand-casting report to the route's lines (sand-catalog-operations.ts): the moulding line gets the operations that make the
 * part's features in the mould, the first coremaking line those its cores make. Display and trace only: no cost is changed. When the route
 * uses more than one coring process, every cored feature is shown under the first one (the analysis links a feature to a core, not to the
 * coring process that core is costed on). Returns warnings for what could not be shown.
 */
@Injectable()
export class SandCatalogOperationsService {
  constructor(private readonly databaseService: DatabaseService) {}

  async attach(input: { lines: ProcessLineCost[]; features: readonly SandFeature[]; coresLinked: boolean; accessToken: string }): Promise<string[]> {
    const { lines, features, coresLinked, accessToken } = input;
    if (features.length === 0) return [];
    const mouldingLine = lines.find((l) => processOfClass(MOULDING_PROCESSES, l.machineClass));
    if (!mouldingLine) return [];
    const mouldingProcess = processOfClass(MOULDING_PROCESSES, mouldingLine.machineClass)!;
    const coreLine = lines.find((l) => processOfClass(CORE_PROCESSES, l.machineClass));
    const coreProcess = coreLine ? processOfClass(CORE_PROCESSES, coreLine.machineClass) : undefined;

    const client = this.databaseService.getClient(accessToken);
    const names = [mouldingProcess, ...(coreProcess ? [coreProcess] : [])];
    const ids = await client.from('process_taxonomy').select('id, process_name').eq('process_group', SAND_CASTING).in('process_name', names);
    if (ids.error) return [`Sand-casting operations not shown: process_taxonomy could not be read (${ids.error.message}).`];
    const idOf = new Map(((ids.data ?? []) as Array<{ id: string; process_name: string }>).map((r) => [r.process_name, r.id]));
    const catalog = await catalogRowsByProcess(client, [...idOf.values()]);
    if ('error' in catalog) return [`Sand-casting operations not shown: process_taxonomy_operations could not be read (${catalog.error}).`];
    const rowsOf = (name: string | undefined) => (name && idOf.has(name) ? catalog.get(idOf.get(name)!) ?? [] : []);

    const { moulding, coring } = resolveSandCatalogOperations({
      mouldingCatalog: rowsOf(mouldingProcess), coringCatalog: rowsOf(coreProcess), features, coresLinked,
    });
    if (moulding.length > 0) mouldingLine.catalogOperations = moulding;
    if (coreLine && coring.length > 0) coreLine.catalogOperations = coring;
    return coresLinked ? [] : ['Which features the cores form is known only from the casting analysis: those holes are shown undecided between the mould and a core.'];
  }
}
