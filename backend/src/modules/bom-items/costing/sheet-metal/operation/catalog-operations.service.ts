import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../../../../common/database/database.service';
import { readAllRows, type RowPage } from '../../../../../common/database/read-all-rows';
import { RateResolutionService } from '../../../services/rate-resolution.service';
import { SheetMetalLookupService } from '../lookup/sheet-metal-lookup.service';
import { cachedBatch, cachedRead } from '../../shared/core/request-cache';
import { ReferenceMemo } from '../../../../../common/cache/reference-memo';
import type { ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import { resolveCatalogOperations, type SheetMetalFeature } from './catalog-operation-resolver';

/**
 * Attaches to each sheet-metal process line the reference-catalog operations it
 * performs on this part's CAD features (see catalog-operation-resolver.ts).
 *
 * Reads, all from the database:
 *  - the line's catalog process: its machine class -> process_calculator_mappings
 *    canonical_process_id (the same identity resolveProcessIdentities gives the
 *    line) -> process_taxonomy_operations
 *  - sm_operation_kinds / sm_feature_variant_kinds (migration 842)
 *  - minPunchingThicknessFactor, turretMaxPercentNibbledPeriemter (sm_reference_data)
 *  - the selected machine own max_punch_size_mm (mhr_records.specs)
 *
 * Display and trace only: no cost is changed. Missing data leaves a line
 * without catalogOperations and says why in the returned warnings.
 */
@Injectable()
export class SheetMetalCatalogOperationsService {
  private readonly logger = new Logger(SheetMetalCatalogOperationsService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly rateResolutionService: RateResolutionService,
    private readonly smLookup: SheetMetalLookupService,
  ) {}

  async attach(input: {
    lines: ProcessLineCost[];
    features: readonly SheetMetalFeature[];
    /** Tapped holes the drawing calls out (size + count); CAD does not detect threads. */
    threads: ReadonlyArray<{ size: string; count: number }>;
    thicknessMm: number;
    family: string;
    accessToken: string;
  }): Promise<string[]> {
    const { lines, thicknessMm, family, accessToken } = input;
    // A tapped hole is a drawing fact (CAD sees only its pilot hole): one
    // SimpleHole/tapped entry per called-out thread size. The pilot stays a
    // hole of its own — it is still punched or cut before it is tapped.
    const features: SheetMetalFeature[] = [
      ...input.features,
      ...input.threads.filter((t) => t.size && t.count > 0).map((t) => ({
        id: `thread_${t.size}`,
        feature_type: 'SimpleHole',
        variant: 'tapped',
        occurrences: Array.from({ length: t.count }, () => ({ face_ids: [] as number[] })),
      })),
    ];
    if (features.length === 0 || lines.length === 0) return [];
    const client = this.databaseService.getClient(accessToken);
    const classOf = (l: ProcessLineCost) => l.hostMachineClass ?? l.machineClass;

    const identities = await this.rateResolutionService.resolveProcessIdentities(
      accessToken, [...new Set(lines.map(classOf))], family,
    );
    const canonicalIds = [...new Set(Object.values(identities).map((i) => i.canonicalProcessId).filter((id): id is string => !!id))].sort();
    if (canonicalIds.length === 0) return [];

    const [catalog, kinds, variables] = await Promise.all([
      this.catalogRowsByProcess(client, canonicalIds),
      this.loadKinds(),
      this.smLookup.getNumericVariables(['minPunchingThicknessFactor', 'turretMaxPercentNibbledPeriemter']),
    ]);
    if ('error' in catalog) return [`Catalog operations not shown: process_taxonomy_operations could not be read (${catalog.error}).`];
    if ('error' in kinds) return [`Catalog operations not shown: ${kinds.error} (migration 842).`];

    const rawByProcess = catalog;

    const maxPunchByMachine = await this.maxPunchSizes(client, lines);
    const punchFactor = variables.get('minPunchingThicknessFactor');
    const minPunch = punchFactor != null && thicknessMm > 0 ? punchFactor * thicknessMm : null;
    const nibbleCap = variables.get('turretMaxPercentNibbledPeriemter') ?? null;

    for (const line of lines) {
      const canonicalId = identities[classOf(line)]?.canonicalProcessId;
      const catalogRaw = canonicalId ? rawByProcess.get(canonicalId) : undefined;
      if (!catalogRaw?.length) continue;
      const machineId = line.machineSelection?.balanced?.candidate?.machineId ?? line.mhrId ?? null;
      const operations = resolveCatalogOperations({
        catalogRaw,
        features,
        operationKinds: kinds.operationKinds,
        variantKinds: kinds.variantKinds,
        punchLimits: {
          minPunchDiameterMm: minPunch,
          maxPunchSizeMm: machineId ? maxPunchByMachine.get(machineId) ?? null : null,
          maxNibbledPerimeterFraction: nibbleCap,
        },
      });
      if (operations.length > 0) line.catalogOperations = operations;
    }
    return [];
  }

  /**
   * The catalog operation strings of each process, read once per process per request (a route comparison
   * attaches every route and the routes share most processes). Organization-scoped under RLS, so it stays
   * in the request-scoped cache, never in a cross-request one.
   */
  private async catalogRowsByProcess(
    client: ReturnType<DatabaseService['getClient']>,
    canonicalIds: readonly string[],
  ): Promise<Map<string, string[]> | { error: string }> {
    try {
      const rows = await cachedBatch<string[]>('sm-catalog-operations', canonicalIds, async (missing) => {
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
      return rows;
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Global reference tables (read policy USING (true), migration 842): the same rows for everyone, changed only
   * by migration, so one short-lived copy serves every request. An error is never remembered.
   */
  @ReferenceMemo({ cacheable: (v) => !!v && !('error' in (v as object)) })
  private async loadKinds(): Promise<
    { operationKinds: Map<string, string>; variantKinds: Map<string, Set<string>> } | { error: string }
  > {
    const client = this.databaseService.getPrivilegedClient('reference-data: sm_operation_kinds and sm_feature_variant_kinds, global shared (migration 842)');
    const [ops, variants] = await Promise.all([
      client.from('sm_operation_kinds').select('operation_category, kind'),
      client.from('sm_feature_variant_kinds').select('feature_type, variant, kind'),
    ]);
    if (ops.error || variants.error) {
      const message = (ops.error ?? variants.error)!.message;
      this.logger.warn(`sm operation kinds not loaded: ${message}`);
      return { error: `operation kinds could not be read (${message})` };
    }
    const operationKinds = new Map((ops.data ?? []).map((r: any) => [r.operation_category as string, r.kind as string]));
    const variantKinds = new Map<string, Set<string>>();
    for (const r of (variants.data ?? []) as any[]) {
      const key = `${r.feature_type}:${r.variant}`;
      variantKinds.set(key, (variantKinds.get(key) ?? new Set<string>()).add(r.kind));
    }
    return { operationKinds, variantKinds };
  }

  /** The selected machine own largest punch tool, where its specs carry one. */
  private async maxPunchSizes(
    client: ReturnType<DatabaseService['getClient']>,
    lines: readonly ProcessLineCost[],
  ): Promise<Map<string, number>> {
    const ids = [...new Set(lines
      .map((l) => l.machineSelection?.balanced?.candidate?.machineId ?? l.mhrId ?? null)
      .filter((id): id is string => !!id))].sort();
    const result = new Map<string, number>();
    if (ids.length === 0) return result;
    // One request attaches every route and the routes share most machines: each machine is read once.
    const specs = await cachedBatch<Record<string, unknown> | null>('sm-max-punch-specs', ids, async (missing) => {
      const { data } = await client.from('mhr_records').select('id, specs').in('id', missing);
      return new Map(((data ?? []) as Array<{ id: string; specs: Record<string, unknown> | null }>).map((r) => [r.id, r.specs]));
    });
    for (const [id, s] of specs) {
      const v = Number(s?.max_punch_size_mm);
      if (Number.isFinite(v) && v > 0) result.set(id, v);
    }
    return result;
  }
}
