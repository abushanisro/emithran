import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';

import { AuditService } from '../../../common/audit/audit.service';
import { DatabaseService } from '../../../common/database/database.service';
import { currentFeatureGraphVersion, MISSING_ANALYSIS_TEXT } from '../analysis-status';
import { BOMItemsService } from '../bom-items.service';
import { AUTO_ROUTE_ID } from '../dto/apply-route.dto';
import type { AppliedScenarioState, ApplyScenarioDto, ScenarioApplicationResult } from '../dto/apply-scenario.dto';
import { AnalysisRunService } from './analysis-run.service';
import { MaterialCostSnapshotService } from './material-cost-snapshot.service';
import { ToolingCostSnapshotService } from './tooling-cost-snapshot.service';
import { RouteApplicationService } from './route-application.service';

export interface ScenarioApplicationInput {
  bomItemId: string;
  userId: string;
  organizationId: string;
  token: string;
  request: ApplyScenarioDto;
}

/** The state key on scenario_overrides. Only this service writes it. */
export const APPLIED_SCENARIO_KEY = 'appliedScenario';

const ERROR_MAX = 500;

/**
 * Apply Scenario as ONE backend operation, and the only owner of the applied scenario's state.
 *
 *   1. the analysis is made current (AnalysisRunService); an apply never runs on a part that is not analysed, and nothing is written if it cannot be;
 *   2. begin_scenario_application (migration 969): one apply at a time per item, against the revision the caller saw; the state becomes 'applying';
 *   3. the scenario fields: annual volume and material grade on the item, every scenario key in one atomic merge;
 *   4. the material cost record, a snapshot of the engine's own cost summary at this scenario (MaterialCostSnapshotService);
 *   5. the route (RouteApplicationService: the engine's recommendation, a chosen route, a Workflow Builder route, or the one already applied);
 *      and the tooling that route needs (ToolingCostSnapshotService: the mold the engine priced);
 *   6. the machines picked in the Workflow Builder;
 *   7. the state becomes 'applied' with revision + 1, or 'failed' with the reason and the revision unchanged.
 *
 * It is not one database transaction: the writes go through the services that own them, several tables. A failure midway keeps the earlier writes and
 * says so ('failed' + the reason); every step is idempotent, so applying again converges. What can no longer happen is the browser showing
 * "applied" over a refused route, two applies interleaving, or a retry duplicating a record.
 */
@Injectable()
export class ScenarioApplicationService {
  private readonly logger = new Logger(ScenarioApplicationService.name);

  constructor(
    private readonly bomItems: BOMItemsService,
    private readonly database: DatabaseService,
    private readonly analysisRuns: AnalysisRunService,
    private readonly materials: MaterialCostSnapshotService,
    private readonly toolingCosts: ToolingCostSnapshotService,
    private readonly routes: RouteApplicationService,
    private readonly audit: AuditService,
  ) {}

  async apply(input: ScenarioApplicationInput): Promise<ScenarioApplicationResult> {
    const { bomItemId: id, userId, organizationId, token, request } = input;
    if (request.scenarioPatch && APPLIED_SCENARIO_KEY in request.scenarioPatch) {
      throw new BadRequestException(`scenarioPatch cannot set ${APPLIED_SCENARIO_KEY}: the apply owns it`);
    }
    // Resolved by OrganizationContextGuard on the route. A record written without it is invisible to its own organization (row-level security).
    if (!organizationId) throw new BadRequestException('No organization context: the apply cannot write records for the part.');
    const user = { id: userId };

    // 1. The analysis first; nothing is written, and the state is untouched, if it cannot be made ready.
    const run = await this.analysisRuns.ensureCurrent({ bomItemId: id, userId, organizationId, token });
    if (!run.status.ready) {
      throw new ConflictException({
        code: 'analysis_not_ready',
        message: `This part is not analysed yet: ${run.status.missing.map((m) => MISSING_ANALYSIS_TEXT[m]).join(', then ')}.`,
        missing: run.status.missing,
      });
    }

    // 2. One apply at a time, against the revision the caller saw.
    const revision = await this.begin(id, request.expectedRevision, token);
    const startedAt = new Date().toISOString();
    const warnings: string[] = [];

    try {
      // 3. The scenario fields.
      const grade = request.materialGrade?.trim();
      const before = grade ? await this.bomItems.findOne(id, userId, token) : null;
      const itemPatch: Record<string, unknown> = {};
      if (request.annualVolume !== undefined) itemPatch['annualVolume'] = request.annualVolume;
      // A different grade is an explicit pick: costing trusts it as such. The grade the part is already costed as keeps its source (a grade
      // read from the drawing does not become "manual" because Apply was pressed).
      if (grade && grade !== (before?.materialGrade ?? before?.material ?? null)) {
        itemPatch['materialGrade'] = grade;
        itemPatch['materialSource'] = 'manual';
      }
      if (Object.keys(itemPatch).length > 0) await this.bomItems.update(id, itemPatch as never, userId, token);

      await this.bomItems.patchScenarioOverrides(
        id,
        {
          location: request.location,
          ...(request.batchSize === null ? { batchSize: null } : request.batchSize !== undefined ? { batchSize: request.batchSize } : {}),
          ...(request.productionLifeYears !== undefined ? { productionLifeYears: request.productionLifeYears } : {}),
          ...(request.scenarioPatch ?? {}),
        },
        token,
      );

      // 4. The material cost record, from the cost summary at this scenario.
      let material: ScenarioApplicationResult['material'] = null;
      if (grade) {
        const item = await this.bomItems.findOne(id, userId, token);
        const summary = await this.bomItems.getCostSummary(id, userId, token, undefined, request.location, request.productionLifeYears);
        const snapshot = await this.materials.ensure({ item, grade, location: request.location, summary, userId, organizationId, token });
        material = { grade, action: snapshot.action, recordId: snapshot.recordId };
      }

      // 5. The route.
      const route = await this.applyRoute(id, request, user, token, warnings);

      // 5b. The tooling the applied route needs (the mold), from the cost summary at this scenario.
      const afterRoute = await this.bomItems.getCostSummary(id, userId, token, undefined, request.location, request.productionLifeYears);
      const tooling = await this.toolingCosts.ensure({ bomItemId: id, summary: afterRoute, userId, organizationId, token });

      // 6. The machines picked in the Workflow Builder: a machine that cannot be saved is reported, and does not undo the route.
      const machineOverrides: ScenarioApplicationResult['machineOverrides'] = { saved: 0, failed: [] };
      for (const ov of request.machineOverrides ?? []) {
        try {
          await this.bomItems.setMachineOverride(id, userId, token, ov.processKey, ov.mhrRecordId ?? null, request.location);
          machineOverrides.saved += 1;
        } catch (e: unknown) {
          machineOverrides.failed.push({ processKey: ov.processKey, message: e instanceof Error ? e.message : String(e) });
        }
      }

      // 7. Applied: revision + 1.
      const scenario: AppliedScenarioState = {
        revision: revision + 1, status: 'applied', startedAt, appliedAt: new Date().toISOString(), analysisVersion: currentFeatureGraphVersion(),
      };
      await this.bomItems.patchScenarioOverrides(id, { [APPLIED_SCENARIO_KEY]: scenario }, token);
      await this.audit.recordBestEffort({
        action: 'scenario_application.applied',
        targetType: 'bom_item',
        targetId: id,
        organizationId,
        meta: { revision: scenario.revision, route: route.routeId ?? route.mode, material: grade ?? null },
      });
      return { scenario, analysis: { ran: run.ran }, material, tooling, route, machineOverrides, warnings };
    } catch (e: unknown) {
      await this.fail(id, revision, startedAt, e, token);
      throw e;
    }
  }

  private async applyRoute(
    id: string, request: ApplyScenarioDto, user: { id: string }, token: string, warnings: string[],
  ): Promise<ScenarioApplicationResult['route']> {
    const { route, location } = request;
    const batchSize = request.batchSize ?? undefined;
    let mode = route.mode;
    let routeId: string | undefined;
    if (mode === 'keep') {
      routeId = await this.currentRouteId(id, token);
      if (!routeId) {
        mode = 'auto';
        warnings.push('No route was applied yet, so the engine\'s recommendation was applied.');
      }
    }
    if (mode === 'custom') {
      const applied = await this.routes.applyCustomRoute(
        id, { baseCuttingRouteId: route.baseCuttingRouteId!, steps: route.steps!, location, ...(batchSize ? { batchSize } : {}) }, user as never, token,
      );
      if (applied.needsManualCycleTime.length > 0) warnings.push(`Set the cycle time of: ${applied.needsManualCycleTime.join(', ')}.`);
      return { mode, routeId: null, routeLabel: applied.routeLabel, created: applied.created, operations: applied.operations };
    }
    const wanted = mode === 'auto' ? AUTO_ROUTE_ID : (routeId ?? route.routeId!);
    const applied = await this.routes.applyRoute(id, { routeId: wanted, location, ...(batchSize ? { batchSize } : {}) }, user as never, token);
    return { mode, routeId: applied.routeId, routeLabel: applied.routeLabel, created: applied.created, operations: applied.operations };
  }

  /** The route id the active process records were written from (`auto_fill_from_route:<id>`), or null. */
  private async currentRouteId(id: string, token: string): Promise<string | undefined> {
    const { data, error } = await this.database.getUserClient(token).from('process_cost_records').select('notes').eq('bom_item_id', id).eq('is_active', true);
    if (error) throw new ConflictException(`Could not read the applied route: ${error.message}`);
    for (const row of (data ?? []) as Array<{ notes: string | null }>) {
      const m = /^auto_fill_from_route:(.+)$/.exec(row.notes ?? '');
      if (m) return m[1];
    }
    return undefined;
  }

  /** begin_scenario_application, with its refusals as 409s the caller can act on. */
  private async begin(id: string, expectedRevision: number | undefined, token: string): Promise<number> {
    const { data, error } = await this.database.getUserClient(token).rpc('begin_scenario_application', {
      p_id: id,
      p_expected_revision: expectedRevision ?? null,
    });
    if (error) {
      const message = error.message ?? '';
      if (message.includes('scenario_revision_conflict')) throw new ConflictException({ code: 'scenario_revision_conflict', message: message.replace(/^.*?scenario_revision_conflict: /, '') });
      if (message.includes('scenario_apply_in_progress')) throw new ConflictException({ code: 'scenario_apply_in_progress', message: message.replace(/^.*?scenario_apply_in_progress: /, '') });
      throw new ConflictException(`Could not start the apply: ${message}`);
    }
    return Number(data ?? 0);
  }

  /** Records the failure on the item: the revision is unchanged and the earlier writes stay (see the class comment). Never throws: the original error matters. */
  private async fail(id: string, revision: number, startedAt: string, cause: unknown, token: string): Promise<void> {
    const raw = cause instanceof Error ? cause.message : String(cause);
    const state: AppliedScenarioState = { revision, status: 'failed', startedAt, failedAt: new Date().toISOString(), error: raw.slice(0, ERROR_MAX) };
    try {
      await this.bomItems.patchScenarioOverrides(id, { [APPLIED_SCENARIO_KEY]: state }, token);
    } catch (e: unknown) {
      this.logger.error(`Could not record the failed apply of ${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
