import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../../common/database/database.service';
import { RateResolutionService } from '../../../services/rate-resolution.service';
import { catalogRowsByProcess } from '../../shared/catalog-rows-by-process';
import type { ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { FeatureRules } from '../plastic-reference';
import { resolvePlasticCatalogOperations, type PlasticFeature } from './plastic-catalog-operation-resolver';

/** The CAD engine's plastic feature graph (cad-engine injection_molding/recognition/feature_graph.py). */
export interface PlasticFeatureGraph {
  schema: string;
  items: PlasticFeature[];
  /** Feature types the engine does not recognise yet: absent from `items` does not mean the part has none. */
  not_yet_recognized: string[];
  unclassified_faces: number;
}

const SCHEMA = 'plastic_feature_graph_v1';

/**
 * Attaches to each molding process line the catalog operations it performs on this part's recognised features
 * (see plastic-catalog-operation-resolver.ts). Display and trace only: no cost is changed. Missing data leaves a line without
 * catalogOperations and says why in the returned warnings; a feature type the engine cannot recognise yet is named, never read as absent.
 */
@Injectable()
export class PlasticCatalogOperationsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly rateResolutionService: RateResolutionService,
  ) {}

  async attach(input: {
    lines: ProcessLineCost[];
    graph: PlasticFeatureGraph | null | undefined;
    rules: FeatureRules | null;
    family: string;
    accessToken: string;
  }): Promise<string[]> {
    const { lines, graph, rules, family, accessToken } = input;
    if (!graph || graph.schema !== SCHEMA || lines.length === 0) return [];
    const warnings: string[] = [];
    if (graph.not_yet_recognized.length > 0) {
      warnings.push(`Not assessed from the CAD yet: ${graph.not_yet_recognized.join(', ')}. Their operations (cores, lifters, slides, trimming) are not in the catalog operations shown.`);
    }
    if (graph.items.length === 0) return warnings;

    const client = this.databaseService.getClient(accessToken);
    const classOf = (l: ProcessLineCost) => l.hostMachineClass ?? l.machineClass;
    const identities = await this.rateResolutionService.resolveProcessIdentities(accessToken, [...new Set(lines.map(classOf))], family);
    const canonicalIds = [...new Set(Object.values(identities).map((i) => i.canonicalProcessId).filter((id): id is string => !!id))].sort();
    if (canonicalIds.length === 0) return warnings;

    const catalog = await catalogRowsByProcess(client, canonicalIds);
    if ('error' in catalog) return [...warnings, `Catalog operations not shown: process_taxonomy_operations could not be read (${catalog.error}).`];

    for (const line of lines) {
      const canonicalId = identities[classOf(line)]?.canonicalProcessId;
      const catalogRaw = canonicalId ? catalog.get(canonicalId) : undefined;
      if (!catalogRaw?.length) continue;
      const operations = resolvePlasticCatalogOperations({ catalogRaw, features: graph.items, rules });
      if (operations.length > 0) line.catalogOperations = operations;
    }
    return warnings;
  }
}
