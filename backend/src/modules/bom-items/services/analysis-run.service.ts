import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { SandCastingService } from '../../sand-casting/sand-casting.service';
import type { AnalysisStatus } from '../analysis-status';
import { AnalysisStatusService } from './analysis-status.service';
import { BOMItemsService } from '../bom-items.service';
import { BomItemReanalysisService } from './bom-item-reanalysis.service';

export interface AnalysisRunInput {
  bomItemId: string;
  userId: string;
  organizationId: string;
  token: string;
}

export interface AnalysisRunResult {
  /** The analyses this call ran, in order. Empty when everything was already current. */
  ran: Array<'cad_features' | 'drawing' | 'casting_analysis'>;
  /** The status after the run: the same answer GET /analysis-status gives. */
  status: AnalysisStatus;
}

/**
 * Makes an item's analysis current: runs exactly what the analysis status says is missing, and nothing else. It is the first step of Apply
 * Scenario (the route and the material cost are computed from the part's analysis), so a user never has to start an analysis by hand.
 *
 * Idempotent: with every analysis current it does no work. Single flight per item: a second call while one is running waits for it and gets the
 * same result, so a double click or two tabs cannot run the CAD engine twice. (One process: with several API instances the engine's own
 * file-hash cache makes the repeat cheap, and the result is the same.)
 */
@Injectable()
export class AnalysisRunService {
  private readonly logger = new Logger(AnalysisRunService.name);
  private readonly inFlight = new Map<string, Promise<AnalysisRunResult>>();

  constructor(
    private readonly bomItems: BOMItemsService,
    private readonly statuses: AnalysisStatusService,
    private readonly reanalysis: BomItemReanalysisService,
    private readonly casting: SandCastingService,
  ) {}

  ensureCurrent(input: AnalysisRunInput): Promise<AnalysisRunResult> {
    // Resolved by OrganizationContextGuard on the route: the casting analysis the run may start is stored under it.
    if (!input.organizationId) return Promise.reject(new BadRequestException('No organization context: the analysis cannot be started for the part.'));
    const running = this.inFlight.get(input.bomItemId);
    if (running) return running;
    const run = this.run(input).finally(() => this.inFlight.delete(input.bomItemId));
    this.inFlight.set(input.bomItemId, run);
    return run;
  }

  private async run(input: AnalysisRunInput): Promise<AnalysisRunResult> {
    const { bomItemId, userId, token } = input;
    const ran: AnalysisRunResult['ran'] = [];
    let item = await this.bomItems.findOne(bomItemId, userId, token);
    let status = await this.statuses.forItem(item, token);

    // 1. The CAD features come first: they decide the part family, and the casting analysis depends on the family.
    if (status.missing.includes('cad_features')) {
      // A failure here is the run's failure: nothing after it means anything without the features, and the caller must see why (engine down, no file).
      await this.reanalysis.reanalyze(bomItemId, userId, token);
      ran.push('cad_features');
      item = await this.bomItems.findOne(bomItemId, userId, token);
      status = await this.statuses.forItem(item, token);
    }

    // 2. The drawing is read when there is a PDF that has not been read, or when the features were just redone. It is optional: a drawing that
    // cannot be read never undoes the geometry analysis.
    if (item.file2dPath?.toLowerCase().endsWith('.pdf') && (status.drawing === 'none' || ran.includes('cad_features'))) {
      try {
        await this.reanalysis.analyzeDrawing(bomItemId, userId, token);
        ran.push('drawing');
      } catch (e: unknown) {
        this.logger.warn(`Drawing analysis of ${bomItemId} failed and was skipped: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 3. Whether the part also needs its casting analysis is the family's call, now that the features have decided the family.
    if (status.missing.includes('casting_analysis') && (status.casting === 'none' || status.casting === 'failed')) {
      try {
        await this.casting.request(input);
        ran.push('casting_analysis');
      } catch (e: unknown) {
        // Refused (no worker, no file): the status below says it is still missing, and why is in the log; the geometry analysis stands.
        this.logger.warn(`Casting analysis of ${bomItemId} was not started: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return { ran, status: await this.statuses.forItem(await this.bomItems.findOne(bomItemId, userId, token), token) };
  }
}
