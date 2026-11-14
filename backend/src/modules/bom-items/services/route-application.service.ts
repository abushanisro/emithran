import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { DatabaseService } from '../../../common/database/database.service';
import { ExchangeRateService } from '../../../common/exchange-rate/exchange-rate.service';
import { BOMItemsService } from '../bom-items.service';
import { AnalysisStatusService } from './analysis-status.service';

interface User {
  id: string;
  email?: string;
  [key: string]: any;
}

import { catalogRowForLine, identityRows, type CatalogRow } from '../process-catalog/catalog-row-for-line';
import { MISSING_ANALYSIS_TEXT } from '../analysis-status';
import { ApplyRouteDto, AUTO_ROUTE_ID, type ApplyRouteResult, ApplyCustomRouteDto, type ApplyCustomRouteResult } from '../dto/apply-route.dto';
import type { CalculationTraceStep, PhysicsGap } from '../dto/cost-breakdown.dto';
import { cyclePhasesOf } from '../costing/shared/cycle-phases';
import { LOCATION_INFO } from '../costing/shared/core/default-rates.constants';
import { RateSnapshot } from '../../../common/exchange-rate/exchange-rate.service';
import { findRouteDataGaps, formatNearestRowsDisclosure, isPerPartCharge, persistableCycleSec } from '../costing/shared/core/engine-kernel';
import { RouteResultDto } from '../dto/route-comparison.dto';
import { PersistedLineCurrency, resolvePersistedCostCurrencyBasis } from '../costing/shared/core/persisted-currency-contract';
import { COST_ENGINE_CONTRACT_VERSION } from '../costing/shared/core/persisted-process-cost';
import { PlasticReferenceService } from '../costing/plastic-molding/lookup/plastic-reference.service';

/**
 * Writes a route (the engine's recommendation, a chosen route, or a Workflow Builder route) as the part's process cost records. The one place that does
 * it: the route-application endpoints and Apply Scenario both call it. Moved out of the controller unchanged.
 */
@Injectable()
export class RouteApplicationService {
  private readonly logger = new Logger(RouteApplicationService.name);

  constructor(
    private readonly bomItemsService: BOMItemsService,
    private readonly databaseService: DatabaseService,
    private readonly exchangeRateService: ExchangeRateService,
    private readonly audit: AuditService,
    private readonly analysisStatusService: AnalysisStatusService,
    private readonly plasticReference: PlasticReferenceService,
  ) {}

  /**
   * An apply writes a route from the part's analysis: refuse it until every analysis the part needs is finished and current. A route
   * computed without the CAD features rests on a bounding box and a guess, and is not the part's.
   */
  async requireAnalysis(id: string, user: User, token: string): Promise<void> {
    const status = await this.analysisStatusService.forItem(await this.bomItemsService.findOne(id, user.id, token), token);
    if (status.ready) return;
    throw new ConflictException({
      code: 'analysis_not_ready',
      message: `This part is not analysed yet: ${status.missing.map((m) => MISSING_ANALYSIS_TEXT[m]).join(', then ')}.`,
      missing: status.missing,
    });
  }

  // ── Apply a selected manufacturing route → write process_cost_records ─────────
  async applyRoute(
    id: string,
    dto: ApplyRouteDto,
    user: User,
    token: string,
    /** Apply the recommended route instead when the asked one is no longer one of the part's routes (its process changed). Off for a route chosen by id. */
    options: { fallbackToRecommended?: boolean } = {},
  ): Promise<ApplyRouteResult> {
    return this.audit.auditedRowChange('bom_items', id, 'cost.applied', async () => {
    await this.requireAnalysis(id, user, token);
    // Required and validated by the DTO — no substitution here. This was
    // `dto.location ?? 'USA'`, which priced and PERSISTED an apply at USA
    // rates whenever the caller stated no location.
    const location  = dto.location;

    // 1. Fetch the authoritative route comparison from the engine.
    // batchSize is passed through UNRESOLVED (undefined when the caller states
    // none) so getRouteComparison resolves it canonically: request -> the item's
    // persisted scenario override -> the one default in COSTING_INPUT_DEFAULTS.
    // A `?? 1` here was a second, competing default: applying a route without an
    // explicit batch persisted records at batch 1 while the item's own scenario
    // said 100,000, so every freshly applied row was immediately stale against
    // the scenario that produced it.
    // localOut receives the routes in factory-local currency, captured inside
    // getRouteComparison just before its single conversion to display currency
    // (P1b-iv-c). The response itself is unchanged.
    const localOut: { routes?: RouteResultDto[]; localCurrency?: string } = {};
    const comparison = await this.bomItemsService.getRouteComparison(
      id, user.id, token, dto.batchSize, location, undefined, localOut,
    );
    // The batch the route was ACTUALLY costed at — persist that, not the request.
    const batchSize = comparison.resolvedInputs.batchSize;

    // 2. Resolve 'auto' to the engine's own recommendation, from THIS comparison.
    const askedFor = dto.routeId === AUTO_ROUTE_ID ? comparison.recommendedRouteId : dto.routeId;
    const replaced = !!askedFor && options.fallbackToRecommended === true && !comparison.routes.some((r) => r.routeId === askedFor);
    const routeId = replaced ? comparison.recommendedRouteId : askedFor;
    if (!routeId && comparison.noCompatibleProcessMessage) {
      // Every route is ruled out by a feature its process cannot make: say so, with each route's reason, and choose nothing.
      const reasons = comparison.routes.flatMap((r) => (r.compatibility?.incompatibilities ?? []).map((i) => `${r.routeLabel}: ${i.count} x ${i.featureType} (${i.reason})`));
      throw new BadRequestException(`${comparison.noCompatibleProcessMessage} ${reasons.join(' ')}`.trim());
    }
    if (!routeId) {
      throw new BadRequestException(
        'No route is both feasible and fully costed for this part, so none can be applied automatically. ' +
        'Choose a route manually; the route comparison lists what each one is missing.',
      );
    }

    // 3. Find the route
    const route = comparison.routes.find((r) => r.routeId === routeId);
    if (!route) {
      throw new NotFoundException(
        `Route '${routeId}' not available for this part. ` +
        `Available: ${comparison.routes.map((r) => r.routeId).join(', ')}`,
      );
    }

    // 4. Reject infeasible routes — the engine already did the capability check
    if (!route.isFeasible) {
      const reason = route.warnings?.[0] ?? 'machine capability constraints not met';
      throw new BadRequestException(
        `Route '${routeId}' (${route.routeLabel}) is not feasible for this part: ${reason}`,
      );
    }

    if (!route.processLines?.length) {
      throw new BadRequestException(
        `Route '${routeId}' returned no process lines — cannot create cost records`,
      );
    }

    // P1b-iv-c: persist what the ENGINES charged, in the factory local
    // currency, not what the response was converted to for display.
    //
    // localRoutes is the pre-conversion snapshot getRouteComparison filled in
    // (see its localCurrencyOut parameter). The response is still used for
    // everything else -- feasibility, warnings, the route the user picked --
    // because only the money differs between the two.
    const localRoute = localOut.routes?.find((r) => r.routeId === routeId);
    if (!localRoute?.processLines?.length) {
      // Never fall back to the display-currency lines: that is precisely the
      // mislabelled money this phase removes. Fail loudly instead.
      throw new BadRequestException(
        `Route '${routeId}' produced no pre-conversion process lines — cannot persist ` +
        `local-currency costs. No records were written.`,
      );
    }

    const insertedOps = await this.writeProcessLinesAsRecords(
      id, localRoute.processLines, batchSize, location, user, token, `auto_fill_from_route:${routeId}`,
      {
        // The engines compute in the factory local currency, and these lines
        // were captured before the single conversion point, so the money is
        // local by construction -- no conversion was applied to reach it.
        lineCurrency:  localOut.localCurrency ?? LOCATION_INFO[location]?.code ?? 'USD',
        localCurrency: localOut.localCurrency ?? LOCATION_INFO[location]?.code ?? null,
        // Nothing converted these values, so there is no rate to record. A
        // 'local' row asserts currency === cost_currency_local, which the
        // database enforces via ck_process_cost_records_local_agrees.
        rateFromLocal: null,
      },
    );

    this.logger.log(`[apply-route] partId=${id} route=${routeId} wrote ${insertedOps.length} ops`);

    return {
      created:    insertedOps.length,
      operations: insertedOps,
      routeLabel: route.routeLabel,
      routeId:    routeId,
      ...(replaced ? { replacedRouteId: askedFor } : {}),
    };
  }, { route: dto.routeId, custom: false });
  }

  // ── Apply a dynamically-assembled Workflow Builder route → write real process_cost_records ─
  // Deliberately NOT a free-form cost-line author: baseCuttingRouteId still picks one of the
  // 3 real engine-computed routes (its cutting line + its full processLines set — every other
  // real operation is identical across all 3, since they're gated purely by this part's real
  // geometry, not by cutting method — see getRouteComparison's "shared process lines" comment).
  // includedProcesses is a subset + custom order of THAT real, already-computed set — filtering
  // and reordering, never inventing a cost line the engine didn't already derive from real
  // geometry. Reuses the exact same insert logic as applyRoute (writeProcessLinesAsRecords) —
  // no new cost formulas anywhere in this endpoint.
  async applyCustomRoute(
    id: string,
    dto: ApplyCustomRouteDto,
    user: User,
    token: string,
  ): Promise<ApplyCustomRouteResult> {
    return this.audit.auditedRowChange('bom_items', id, 'cost.applied', async () => {
    await this.requireAnalysis(id, user, token);
    // Required and validated by the DTO — no substitution here. This was
    // `dto.location ?? 'USA'`, which priced and PERSISTED an apply at USA
    // rates whenever the caller stated no location.
    const location  = dto.location;

    // Same canonical resolution as applyRoute above — see its comment.
    const comparison = await this.bomItemsService.getRouteComparison(
      id, user.id, token, dto.batchSize, location,
    );
    const batchSize = comparison.resolvedInputs.batchSize;
    // Own snapshot for resolveRealMachineRate below — getRouteComparison already
    // took its own internally; both read the same short-TTL cache in practice.
    const rates = await this.exchangeRateService.getSnapshot(token, await this.bomItemsService.organizationOfItem(id, token));
    const baseRoute = comparison.routes.find((r) => r.routeId === dto.baseCuttingRouteId);
    if (!baseRoute) {
      throw new NotFoundException(
        `Base cutting route '${dto.baseCuttingRouteId}' not available for this part. ` +
        `Available: ${comparison.routes.map((r) => r.routeId).join(', ')}`,
      );
    }
    if (!baseRoute.processLines?.length) {
      throw new BadRequestException(
        `Base cutting route '${dto.baseCuttingRouteId}' returned no process lines — cannot build a custom route from it`,
      );
    }

    // Two kinds of step, resolved in order:
    //   1. A real, already-engine-computed operation for this part — reuse its
    //      real cycleTimeMin/hourlyRate verbatim, exactly as before.
    //   2. A real catalog operation with no geometric trigger on this part yet
    //      — validated against process_calculator_mappings (never an arbitrary
    //      string), a REAL machine rate resolved for its machineClass, but
    //      cycleTimeMin honestly 0 — no real geometry to derive it from, and
    //      this endpoint never fabricates one.
    const availableByName = new Map(baseRoute.processLines.map((l) => [l.process, l]));
    const db = this.databaseService.getClient(token);
    const orderedLines: Array<{
      process: string; machineClass: string; machineName: string | null; hourlyRate: number;
      labourRate?: number | null;
      cycleTimeMin: number; machineSelection?: { balanced?: { candidate?: { machineId?: string | null; processGroup?: string | null } } };
    }> = [];
    const needsManualCycleTime: string[] = [];

    for (const step of dto.steps) {
      const real = availableByName.get(step.process);
      if (real) {
        orderedLines.push(real);
        continue;
      }
      if (!step.processGroup || !step.processRoute || !step.machineClass) {
        throw new BadRequestException(
          `'${step.process}' is not a real, geometry-computed operation for this part, and no real ` +
          `process identity (processGroup/processRoute/machineClass) was supplied to resolve it from the catalog. ` +
          `Geometry-computed operations available: ${[...availableByName.keys()].join(', ')}`,
        );
      }
      // Validate it's a REAL, active row in the catalog — not an arbitrary string.
      const { data: mappingRows } = await db
        .from('process_calculator_mappings')
        .select('id')
        .eq('process_group', step.processGroup)
        .eq('process_route', step.processRoute)
        .eq('operation', step.process)
        .eq('machine_class', step.machineClass)
        .eq('is_active', true)
        .limit(1);
      if (!mappingRows?.length) {
        throw new BadRequestException(
          `'${step.process}' (${step.processGroup} / ${step.processRoute} / ${step.machineClass}) is not a ` +
          `real, active operation in process_calculator_mappings.`,
        );
      }
      const rate = await this.resolveRealMachineRate(step.machineClass, location, token, rates);
      orderedLines.push({
        process: step.process,
        machineClass: step.machineClass,
        machineName: rate?.machineName ?? null,
        hourlyRate: rate?.rate ?? 0,
        labourRate: rate?.labourRate ?? null,
        cycleTimeMin: 0,
      });
      needsManualCycleTime.push(step.process);
    }

    const routeLabel = `Custom: ${dto.steps.map((s) => s.process).join(' + ')}`;
    const insertedOps = await this.writeProcessLinesAsRecords(
      id, orderedLines, batchSize, location, user, token, `auto_fill_from_custom_route:${id}`,
      {
        // resolveRealMachineRate puts every rate through rates.toUsd() before
        // returning it, so these lines are USD whatever the factory currency
        // is. This caller was always honest about its denomination -- only
        // applyRoute above was not.
        lineCurrency:  'USD',
        localCurrency: LOCATION_INFO[location]?.code ?? null,
        // The real local-to-USD factor from the same snapshot those rates were
        // converted with: one unit of local currency expressed in USD. Exact,
        // not a stand-in -- and 1 for a USA factory because no conversion
        // happened there.
        rateFromLocal: rates.toUsd(1, LOCATION_INFO[location]?.code ?? 'USD'),
      },
    );

    this.logger.log(`[apply-custom-route] partId=${id} wrote ${insertedOps.length} ops: ${insertedOps.join(', ')}` +
      (needsManualCycleTime.length ? ` (needs manual cycle time: ${needsManualCycleTime.join(', ')})` : ''));

    return {
      created:    insertedOps.length,
      operations: insertedOps,
      routeLabel,
      needsManualCycleTime,
    };
  }, { custom: true });
  }

  // Real machine rate for a machine class with no geometric trigger on this
  // part yet — used only by applyCustomRoute's catalog-operation path: the
  // cheapest real mhr_records row for this location, with that machine's own
  // labour rate, or null when HR Rates has no machine of the class here. No
  // benchmark or other-location substitute.
  // Returns rate in USD, via rates.toUsd() regardless of factory currency —
  // which is why applyCustomRoute declares lineCurrency 'USD' when it calls
  // writeProcessLinesAsRecords (see PersistedLineCurrency).
  //
  // NOTE: this does NOT match getRouteComparison's processLines in general.
  // Those are converted to the DISPLAY currency by
  // normalizeRouteComparisonToCurrency, which is USD only when no scenario
  // currency override is in play. The two producers are denominated
  // differently on purpose, and each states its own currency rather than
  // sharing an assumption.
  private async resolveRealMachineRate(
    machineClass: string,
    location: string,
    token: string,
    rates: RateSnapshot,
  ): Promise<{ machineName: string | null; rate: number; labourRate: number | null } | null> {
    const locInfo = LOCATION_INFO[location];
    if (!locInfo) {
      throw new BadRequestException(`Unknown Digital Factory location '${location}' — cannot resolve its machine rates.`);
    }
    const db = this.databaseService.getClient(token);
    const { data: ownRows } = await db
      .from('mhr_records')
      .select('machine_name, total_machine_hour_rate, usd_lhr_total')
      .eq('machine_class', machineClass)
      .eq('location', location)
      .order('total_machine_hour_rate', { ascending: true })
      .limit(1);
    if (!ownRows?.length) return null;
    // Labour is this machine's own usd_lhr_total (already USD, the currency
    // these lines are written in). No benchmark or process-group substitute.
    const lhrUsd = Number(ownRows[0].usd_lhr_total ?? 0);
    return {
      machineName: ownRows[0].machine_name ?? null,
      rate: rates.toUsd(Number(ownRows[0].total_machine_hour_rate ?? 0), locInfo.code),
      labourRate: lhrUsd > 0 ? lhrUsd : null,
    };
  }

  // Shared by applyRoute and applyCustomRoute — writes one process_cost_records row per
  // process line, in array order (op_nbr 10, 20, 30...). Idempotent: replaces the part's
  // ENTIRE active process routing, not just previously-auto-filled rows (re-applying a
  // route must not duplicate op_nbr 10/20/30/40 rows alongside the old ones).
  private async writeProcessLinesAsRecords(
    id: string,
    lines: Array<{
      process: string; machineClass: string; hostMachineClass?: string; machineName?: string | null; hourlyRate: number;
      /** ProcessLineCost.rateSource: a per-part charge (isPerPartCharge) is persisted with no cycle time. */
      rateSource?: string;
      cycleTimeMin: number; machineSelection?: { balanced?: { candidate?: { machineId?: string | null; processGroup?: string | null } } };
      /** Real un-amortised setup minutes the engine charged for this line — see resolveSetupMinutes(). */
      setupTimeMin?: number;
      /** Real machine crew size from mhr_records, via the selected candidate. */
      operators?: number | null;
      physicsGap?: PhysicsGap | null;
      // Inspection (and any other class priced via a flat resolved resource
      // rate, not the CNC/laser-style machineSelection candidate list) has no
      // machineSelection candidate at all — finalizeInspectionLine() sets
      // these directly on the line instead (see inspection-engine.ts).
      mhrId?: string | null;
      benchmarkMhrId?: string | number | null;
      /**
       * The money eMithranTerms charged for this line. Persisted verbatim into
       * setup_cost_per_part / total_cycle_cost_per_part / total_cost_per_part,
       * which buildLineFromAppliedRecord reads straight back out — so an
       * applied line and the line it was built from are the same numbers.
       * Optional because apply-custom-route composes steps the engine has not
       * costed (they carry cycleTimeMin 0 and are listed in
       * needsManualCycleTime). Those persist as NULL -- genuinely unresolved --
       * rather than as a 0 that would read as a real, free operation.
       */
      setupCost?: number;
      runCost?: number;
      totalCost?: number;
      /**
       * The labour hour rate the engine actually costed this line at, and which
       * of the four real sources resolveSetupMinutes used for setupTimeMin.
       * Both are already on every engine line and neither was ever persisted,
       * so an applied quote could not say what labour rate produced it, nor
       * whether its setup came from the selected machine or a class default.
       * Persisted verbatim into line_labour_rate / setup_time_source
       * (migration 718). Optional: a producer that resolves neither writes
       * NULL rather than a stand-in.
       */
      labourRate?: number | null;
      setupTimeSource?: 'calculator' | 'machine' | 'operation_lookup' | 'none';
      /** The cycle's machine / labour split when the engine states it (ProcessLineCost); persisted into machine_cost_per_part / labor_cost_per_part (migration 970). */
      machineCostPerPart?: number;
      laborCostPerPart?: number;
      /** What the line charges beyond machine and crew time, USD (ProcessLineCost.otherCostPerPartUsd); persisted into other_cost_per_part (migration 1005). */
      otherCostPerPartUsd?: number;
      /** The versions the line was calculated with (ProcessLineCost.calculationSnapshot); persisted into calculation_breakdown (migration 972). */
      calculationSnapshot?: object;
      /** The stored calculator's run (ProcessLineCost.calculationTrace); its cycle phases are persisted into cycle_phases (migration 1009). */
      calculationTrace?: CalculationTraceStep[];
    }>,
    batchSize: number,
    location: string,
    user: User,
    token: string,
    notesTag: string,
    /**
     * What currency the `lines` money above is denominated in, and how it got
     * there. Never assumed -- each caller states it from a real resolved value:
     * applyRoute passes getRouteComparison's own `currency` (the display
     * currency normalizeRouteComparisonToCurrency converted those lines to),
     * applyCustomRoute passes USD because resolveRealMachineRate puts every
     * rate through rates.toUsd() regardless of factory.
     *
     * Before migration 707 this function stamped currency:'USD' on every row
     * unconditionally. That was true only on the default path --
     * resolveDisplayCurrency returns USD unless a scenario FX snapshot
     * overrides it -- and silently mislabelled real INR/CNY money as USD under
     * a scenario currency override.
     */
    currencyContext: PersistedLineCurrency,
  ): Promise<string[]> {
    // process_cost_records.cycle_time is NUMERIC(12,4) holding SECONDS (migration 1006). This
    // check used to justify itself by citing migration 034's
    // CHECK (cycle_time >= 1) and calling an unresolved cycle time
    // "schema-impossible to persist". It was not: 034 declares that constraint
    // inside CREATE TABLE IF NOT EXISTS over a table that already existed, so it
    // was never installed, and two live rows hold cycle_time = 0. This guard is
    // the ONLY thing that prevents it, which is why it rejects rather than
    // skips. Migration 717 finally puts CHECK (cycle_time > 0) on the table --
    // > 0, not >= 1, because a real press or roll operation genuinely cycles in
    // under a second (a live Roll Bending row is 0.60s).
    //
    // A line whose cycle time couldn't be resolved (physicsGap set, or
    // cycleTimeMin <=~0 for a process that was still included in the route) must
    // not reach the database. Reject the WHOLE apply-route request before
    // touching any existing data — previously an insert failure here was only logged and the loop moved
    // on, which (after the delete below already ran) silently dropped that one
    // process line from the part's active routing with no error surfaced to the
    // user and no way to recover the deleted prior rows.
    // findRouteDataGaps is this same rule, extracted so route RANKING uses it too
    // (engine-kernel.ts). Before that, a route whose data was missing was
    // ranked cheapest — because the missing operation cost $0 — and then failed
    // here when the user tried to apply it. Ranking and persistence now agree by
    // construction: any route offered as selectable is one this will accept.
    const dataGaps = findRouteDataGaps(lines);
    const firstGap = dataGaps[0];
    if (firstGap) {
      // Disclose what real data DOES exist near the failed query — never a
      // substitute for the missing row (this still rejects the apply), just
      // so the message isn't only "add a row" when the resolver already
      // found real nearby rows (e.g. the lookup table's real tonnage/
      // thickness buckets closest to the selected machine's real capacity).
      throw new BadRequestException(
        `Cannot apply this route — '${firstGap.process}' cycle time is unavailable: ${firstGap.reason}.` +
        `${formatNearestRowsDisclosure(firstGap.nearestRows)} No records were written.`,
      );
    }

    // P1a rollup gate (migration 707, constraint
    // ck_process_cost_records_rollup_usd_until_p1b).
    //
    // total_cost_per_part has a second consumer with the opposite currency
    // requirement to the cost summary overlay: sync_process_cost_to_bom_item
    // copies it into bom_item_costs.process_cost, an aggregate that sits beside
    // raw_material_cost, packaging, procured and tooling -- all USD-native --
    // and that has no currency column of its own. A BOM can span factories in
    // different countries, so that aggregate cannot be denominated in any one
    // factory local currency either.
    //
    // So until the rollup understands currency (P1b), persisting anything but
    // USD here would push that currency into every BOM and project total
    // through a currency-blind SQL trigger -- a strictly larger financial
    // defect than the double-conversion P1 exists to fix. Refuse loudly.
    //
    // This is reachable today only under a scenario currency override, where
    // the previous hardcoded currency:'USD' silently mislabelled the money
    // instead. An error is the honest form of the same situation.
    // The P1a rollup gate is gone as of P1b-iv-c.
    //
    // It existed because bom_item_costs was fed by currency-blind SQL triggers,
    // so a non-USD process row would have been summed into BOM and project
    // totals as though it were dollars. Both halves of that are now fixed:
    // migration 709 and 712 made every rollup trigger invalidate-only, and the
    // application rollup converts each declared input exactly once through a
    // single FX snapshot (bom-item-rollup.ts). A local-currency row is now the
    // intended state rather than a hazard, and the database agrees --
    // migration 712 dropped ck_process_cost_records_rollup_usd_until_p1b.

    const db = this.databaseService.getClient(token);

    // -- Atomicity ------------------------------------------------------------
    // The whole replacement happens inside one database transaction, in
    // replace_active_process_cost_records (migration 704). It cannot be done
    // from here: neither ordering of two separate statements is safe.
    //
    //   delete-then-insert  a failure after the delete leaves the item with
    //                       fewer operations, or none. Confirmed live: an
    //                       apply-route call rejected on a bad user id
    //                       destroyed all five of a parts operations.
    //   insert-then-delete  violates uq_process_cost_records_active_op (the
    //                       partial unique index on (bom_item_id, op_nbr)
    //                       WHERE is_active), because both generations use op
    //                       numbers 10, 20, 30... Confirmed live: re-apply
    //                       failed outright.
    //
    // Rows are still fully built first, so every lookup and validation happens
    // before the database is asked to change anything.

    // Currency is no longer assumed here. This block used to assert that
    // "every `lines` entry is already USD by the time it reaches here", naming
    // a function (normalizeRouteComparisonToUsd) that has since become
    // normalizeRouteComparisonToCurrency — and that is exactly the point: the
    // claim held only while conversion always targeted USD. Once a scenario
    // currency override could select something else, applyRoute began handing
    // this function real INR/CNY money that it stamped 'USD' anyway.
    //
    // The caller now states the denomination (currencyContext), the row records
    // it, and the rollup gate above rejects what the BOM aggregate cannot
    // accept. Migration 707.

    // HR Rates process group of every machine a line is linked to by id only
    // (lines without a machine-selection candidate, e.g. inspection).
    const machineGroupById = new Map<string, string>();
    {
      const ids = [...new Set(lines.map((l) => l.mhrId).filter((x): x is string => typeof x === 'string' && x.length > 0))];
      if (ids.length > 0) {
        const { data: machines } = await db.from('mhr_records').select('id, process_group, commodity_code').in('id', ids);
        for (const m of (machines ?? []) as Array<{ id: string; process_group: string | null; commodity_code: string | null }>) {
          const g = m.process_group || m.commodity_code;
          if (g) machineGroupById.set(m.id, g);
        }
      }
    }

    // A line that records how it was calculated is reproducible only if the reference rows it read are stored too (reference_data_snapshots, once per
    // fingerprint). Stored first, so no saved row ever names a fingerprint that has no stored rows; if they cannot be stored nothing is applied.
    for (const fingerprint of new Set(lines.map((l) => (l.calculationSnapshot as { referenceData?: { fingerprint?: string } } | undefined)?.referenceData?.fingerprint).filter((f): f is string => !!f))) {
      try {
        await this.plasticReference.persistSnapshot(fingerprint);
      } catch (e: unknown) {
        this.logger.error(`[apply-route] reference rows ${fingerprint} not stored for bom_item ${id}: ${e instanceof Error ? e.message : String(e)}`);
        throw new InternalServerErrorException(`Failed to apply the route: the reference data this calculation used could not be stored, so it could not be reproduced later. No changes were made.`);
      }
    }

    const insertedOps: string[] = [];
    /** Every row, fully built, before anything existing is touched. */
    const rowsToInsert: Record<string, unknown>[] = [];
    let opNbr = 10;

    for (const line of lines) {
      // process_route (and, for a line with no machine, the process group) is
      // read from this machine class's catalog rows in process_calculator_mappings
      // (migrations 368/369), lowest display_order first. An operation run on
      // another machine (hostMachineClass, e.g. rigid tapping on the lathe that
      // turned the part) is resolved against THAT machine's rows.
      const hierarchyClass = line.hostMachineClass ?? line.machineClass;
      const { data: hierarchyRows } = await db
        .from('process_calculator_mappings')
        .select('process_group, process_route, operation, display_order, is_active')
        .eq('machine_class', hierarchyClass)
        .order('display_order', { ascending: true });
      const classRows = identityRows((hierarchyRows ?? []) as CatalogRow[]);
      const hierarchyRow = catalogRowForLine(classRows, line.process);
      // The saved operation is the engine's own name for this line
      // (line.process) — the one identity every other writer (the dialog, the
      // custom route above, the frontend default-route path) saves and the Edit
      // Process Cost dialog matches against. Never the class's catalog row:
      // that identity is per machine class, so it named every line on one
      // machine the same ("CMM Inspection" for the "Inspection" line, one
      // label for a lathe's Rough Turning / Finish Turning / Boring), and a
      // reopened line then matched none of this part's live operations.
      const operation    = line.process;
      // The Process a saved line shows is the process group of the machine it
      // runs on, as HR Rates lists it (mhr_records.process_group, else its
      // commodity_code), so the Edit Process Cost picker always has it as an
      // option. The catalog row's group is used only for a line with no
      // machine. Neither = the line cannot be placed: no guessed group.
      const lineMhrId = line.machineSelection?.balanced?.candidate?.machineId ?? line.mhrId ?? null;
      const processGroup = line.machineSelection?.balanced?.candidate?.processGroup
        ?? (lineMhrId ? machineGroupById.get(lineMhrId) : undefined)
        ?? (hierarchyRow ?? classRows[0])?.process_group;
      if (!processGroup) {
        throw new InternalServerErrorException(
          `"${line.process}" (${hierarchyClass}) has no process group: its machine has none in HR Rates and the class has no process_calculator_mappings row.`,
        );
      }
      const processRoute = hierarchyRow?.process_route ?? null;
      // machine_rate is denominated in currencyContext.lineCurrency, like every
      // other money column on the row. It is line.hourlyRate verbatim — the
      // rate the engine actually charged this line at — and applyRoute now
      // supplies pre-conversion (factory-local) lines, so this is local there
      // and USD on the applyCustomRoute path. It was previously commented as
      // "USD always", which stopped being true at P1b-iv-c.
      const machineRate  = line.hourlyRate;
      // process_cost_records.cycle_time is NUMERIC(12,2) — round to 2dp, not
      // to a whole integer. Rounding to an integer here silently threw away
      // real precision the schema already supports on every applied route —
      // confirmed live: a genuine 19.2s Inspection line saved as 19s, then
      // visibly disagreed with its own calculator's exact recomputation.
      const cycleTimeSec = persistableCycleSec(line.cycleTimeMin);
      const perPart = isPerPartCharge(line);
      // Labour is the rate the engine costed this line with — the selected
      // machine's own memory/ LHR (line.labourRate). No lhr_benchmark_rates or
      // process-group substitute. labor_rate 0 is the column's own "none"
      // (column default 0); line_labour_rate below stays NULL for it.
      const labourRate = line.labourRate ?? 0;

      rowsToInsert.push({
        bom_item_id:    id,
        user_id:        user.id,
        op_nbr:         opNbr,
        operation,
        process_group:  processGroup,
        process_route:  processRoute,
        // Added by migration 343 specifically so the Edit Process Cost dialog
        // knows which Digital Factory location to filter its MHR/LHR dropdowns
        // by on reopen -- never wired up here despite `location` already being
        // computed above. Left NULL, every route-applied row's dialog defaulted
        // to "All locations" (no filter), which is why the Machine/Labour
        // dropdowns showed every country's rows mixed together (raw local-
        // currency figures under one flat "$" label, e.g. Vietnam's
        // 471560 VND showing as "$471560.00/hr") instead of just the applied
        // location's real rate.
        location,
        // machine_class was never persisted here despite line.machineClass
        // being available —
        // every route-applied row's machine_class came back NULL, so the frontend's
        // matchedEngineLine lookup (which requires proc.machineClass === l.machineClass)
        // always failed and every applied row silently lost the live MachineSelector
        // (alternatives, "Why" reasoning, capability checks), falling back to a
        // read-only display of whatever machine_name happened to be stored.
        machine_class:  line.machineClass ?? null,
        machine_name:   line.machineName ?? null,
        // The route engine already selected a real machine per line (see
        // attachMachineSelections() in bom-items.service.ts) — persist its
        // mhr_records id so the ProcessCostDialog's MHR dropdown can find and
        // pre-select it on the next load. Without this, only machine_name (a
        // display string) was stored and the dropdown always showed "no
        // machine selected" for a route-applied line.
        //
        // Inspection-class lines have no machineSelection candidate at all —
        // falling back to line.mhrId/benchmarkMhrId (set directly by
        // finalizeInspectionLine, see inspection-engine.ts) is required, or
        // this always wrote NULL for them. Confirmed live: an Inspect line's
        // real, resolved CMM/bench machine link was correctly written on the
        // FIRST apply (via autoAddProcessCosts, the frontend's own ad-hoc
        // default-route path, which already had this same fallback), then
        // silently dropped back to "Manual rate — not linked to a machine"
        // on every SUBSEQUENT apply, once an auto_fill_from_route note
        // existed and this endpoint (missing the fallback) took over.
        mhr_id:         line.machineSelection?.balanced?.candidate?.machineId ?? line.mhrId ?? null,
        benchmark_mhr_id: (!line.machineSelection?.balanced?.candidate?.machineId && !line.mhrId)
          ? (line.benchmarkMhrId ?? null)
          : null,
        machine_rate:   machineRate,
        labor_rate:     labourRate,
        lhr_id:         null,
        direct_rate:    machineRate + labourRate,
        // Real, per-machine values — never the literal 15 min / 1 operator this
        // wrote for every process on every machine regardless of what the cost
        // engine had actually charged. `line.setupTimeMin` is the un-amortised
        // setup resolveSetupMinutes() picked (this machine's own
        // mhr_records.setup_time_hr first, then the per-operation lookup, then
        // the cited class constant), so the persisted row and the engine's own
        // setupCost finally describe the same setup. `operators` is the real
        // machine crew size from mhr_records, already carried on the selected
        // candidate. Both fall back to the previous literals ONLY when the line
        // genuinely reports nothing, so a not-yet-migrated producer degrades to
        // exactly today's behaviour rather than writing a null into a column the
        // UI divides by.
        setup_manning:  line.operators ?? 1,
        // No fallback. findRouteDataGaps above rejects the whole apply when a
        // line has no resolved setup time, so by here one always exists.
        //
        // This read `line.setupTimeMin ?? 15`. PressStrokeEngine — Standard
        // Press, Tandem Press, Progressive Die and Shearing — was the one
        // sheet-metal engine that never put its setup on the line, so all four
        // persisted setup_time = 15 while having been COSTED from 30min
        // (the setup_time_hr shared by all 8 real press machines) or 22.8min
        // for shearing. The Cost Guide re-derives setup
        // cost from this column, so it showed roughly half the setup the quote
        // had charged. Fifteen minutes came from nowhere: no machine, no
        // lookup, no published figure.
        // A per-part charge (melting, nozzle wear) has no machine time: no
        // setup and no cycle, its money is total_cost_per_part (migration 890).
        setup_time:     perPart ? 0 : line.setupTimeMin!,
        batch_size:     batchSize,
        heads:          1,
        cycle_time:     perPart ? null : cycleTimeSec,
        charge_basis:   perPart ? 'per_part' : 'time',
        parts_per_cycle: 1,
        scrap:          0,
        // Was the literal 'USD'. Now the currency this money is actually in,
        // stated by the caller (see PersistedLineCurrency) -- with the local
        // currency and the rate that got it here recorded alongside, so the row
        // describes its own denomination instead of leaving every reader to
        // assume one. Migration 707.
        currency:       currencyContext.lineCurrency,
        // 'converted' when the caller supplied both the local currency and the
        // rate that reached `currency`, 'legacy_unverified' when it could not.
        // Becomes 'local' in P1b. See resolvePersistedCostCurrencyBasis for why
        // false traceability is worse than an admitted gap.
        cost_currency_basis:     resolvePersistedCostCurrencyBasis(currencyContext),
        cost_currency_local:     currencyContext.localCurrency,
        cost_fx_rate_from_local: currencyContext.rateFromLocal,
        is_active:      true,
        notes:          notesTag,
        // The engine line's own money, passed straight through. These three
        // columns exist on process_cost_records and were never written, so
        // buildLineFromAppliedRecord read them back as `?? 0` and the Cost
        // Guide showed every OVERLAID operation at zero once a route was
        // applied. Measured on a real part: Cost Guide 0.03988 vs the applied
        // route 0.04096, the difference being exactly Laser Cutting +
        // Press Brake, the two lines the overlay replaces.
        //
        // Nothing is computed here. `setupCost`, `runCost` and `totalCost` are
        // what eMithranTerms already charged for this line, and
        // buildLineFromAppliedRecord maps them back 1:1 in the other direction
        // (setup_cost_per_part -> setupCost, total_cycle_cost_per_part ->
        // runCost, total_cost_per_part -> totalCost), so a persisted line and
        // the line it came from are the same numbers.
        setup_cost_per_part:       line.setupCost ?? null,
        total_cycle_cost_per_part: line.runCost ?? null,
        total_cost_per_part:       line.totalCost ?? null,
        // The cycle's machine / labour split when the engine states it (migration 970); null when it does not, never a zero.
        // The dataset, engine and formula versions the line was calculated with (migration 972); null for a line whose engine does not record them.
        calculation_breakdown:     line.calculationSnapshot ?? null,
        machine_cost_per_part:     line.machineCostPerPart ?? null,
        labor_cost_per_part:       line.laborCostPerPart ?? null,
        // What the line charges beyond machine and crew time (energy, a consumable), USD like total_cost_per_part (migration 1005).
        other_cost_per_part:       line.otherCostPerPartUsd ?? null,
        // The phases of the cycle as the line's stored calculator gave them (migration 1009); null when the line has no calculator cycle.
        cycle_phases:              cyclePhasesOf(line.calculationTrace),
        // Costed-operation provenance (migration 718).
        //
        // line_hourly_rate is line.hourlyRate verbatim and UNROUNDED -- the
        // machine hour rate this line was costed at, which is what
        // ProcessLineCost.hourlyRate means everywhere else. It duplicates
        // machine_rate on rows this writer produces, and that is deliberate:
        // machine_rate has carried three different conventions across
        // historical producers, so it cannot be read as this without knowing
        // who wrote the row. engine_version is what says who wrote it.
        //
        // line_labour_rate is the rate the ENGINE costed with (the selected
        // machine's own LHR). Null when the producer resolved none.
        line_hourly_rate:  line.hourlyRate,
        line_labour_rate:  line.labourRate ?? null,
        engine_version:    COST_ENGINE_CONTRACT_VERSION,
        setup_time_source: line.setupTimeSource ?? null,
      });

      insertedOps.push(line.process);
      opNbr += 10;
    }

    // One transactional swap. `bom_item_id` and `is_active` are set by the
    // function, so a caller cannot write a row onto a different item or insert
    // an inactive generation by accident.
    const { error: replaceErr } = await db.rpc('replace_active_process_cost_records', {
      p_bom_item_id: id,
      p_rows: rowsToInsert.map(({ bom_item_id, is_active, ...row }) => row),
    });
    if (replaceErr) {
      this.logger.error(`[apply-route] transactional replace failed for bom_item ${id}: ${replaceErr.message}`);
      throw new InternalServerErrorException(
        `Failed to apply the route: ${replaceErr.message}. ` +
        `No changes were made - the previous routing is intact.`,
      );
    }

    return insertedOps;
  }

}
