import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { ELECTRONICS_ENGINE_REGISTRY } from '../domain/engines/registry';
import { buildQuote } from '../domain/quote/build-quote';
import { scenarioRateEntries, validateScenario, type ElectronicsScenario } from '../domain/scenario/scenario';
import { ELECTRONICS_JOB_QUEUE, ELECTRONICS_QUEUES, type JobQueue } from '../infrastructure/queue/job-queue.port';
import { ElectronicsRateBookLoader } from '../infrastructure/repositories/electronics-rate-book.loader';
import { ElectronicsRepository } from '../infrastructure/repositories/electronics.repository';

export interface QuoteJobPayload {
  uploadId: string;
  organizationId: string;
  batchSize: number;
  /** The scenario the quote is priced with; validated when it was requested. */
  scenario?: ElectronicsScenario;
}

export interface RequestQuoteInput {
  uploadId: string;
  batchSize: number;
  /** Raw scenario from the request; validated here. */
  scenario?: unknown;
  organizationId: string;
  userId: string;
  token: string;
}

// Request side: checks the upload is visible to the caller and parsed, then queues the
// costing. The batch size is an explicit input, never defaulted.
@Injectable()
export class RequestQuoteUseCase {
  constructor(
    private readonly repository: ElectronicsRepository,
    @Inject(ELECTRONICS_JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  async execute(input: RequestQuoteInput): Promise<{ jobId: string }> {
    const upload = await this.repository.getUpload(input.uploadId, input.token);
    if (upload.status !== 'needs_review' && upload.status !== 'confirmed') {
      throw new BadRequestException(`Upload is ${upload.status}; a feature graph must be parsed before it can be quoted.`);
    }
    let scenario: ElectronicsScenario | undefined;
    if (input.scenario !== undefined) {
      const checked = validateScenario(input.scenario);
      if (!checked.ok) throw new BadRequestException({ code: 'invalid_scenario', message: checked.problems.map((p) => `${p.field}: ${p.reason}`).join('; ') });
      scenario = checked.scenario;
    }
    const payload: QuoteJobPayload = {
      uploadId: upload.id,
      organizationId: upload.organization_id,
      batchSize: input.batchSize,
      ...(scenario ? { scenario } : {}),
    };
    const queueJobId = await this.queue.enqueue(ELECTRONICS_QUEUES.quote, payload);
    const job = await this.repository.insertJob(
      {
        organization_id: upload.organization_id,
        upload_id: upload.id,
        job_type: 'quote',
        queue_job_id: queueJobId,
        batch_size: input.batchSize,
        created_by: input.userId,
      },
      input.token,
    );
    return { jobId: job.id };
  }
}

// Worker side: latest feature graph -> routed, costed, versioned result row.
@Injectable()
export class ProcessQuoteJob {
  constructor(
    private readonly repository: ElectronicsRepository,
    private readonly rateBooks: ElectronicsRateBookLoader,
  ) {}

  async run({ uploadId, organizationId, batchSize, scenario }: QuoteJobPayload): Promise<Record<string, unknown>> {
    const graphRow = await this.repository.workerGetLatestFeatureGraph(uploadId, organizationId);
    const upload = await this.repository.workerGetUpload(uploadId, organizationId);
    // Confirmed reference rows, the HR Rates machines the scenario chose, and the scenario's stated inputs. Nothing else
    // is loaded and nothing is defaulted: a step without its machine or inputs reports the gap.
    const [reference, machines] = await Promise.all([
      this.rateBooks.load(organizationId),
      this.rateBooks.machinesById(organizationId, [...new Set(Object.values(scenario?.machines ?? {}))]),
    ]);
    const rates = { entries: [...reference.entries, ...(scenario ? scenarioRateEntries(scenario) : [])], machines };
    const result = buildQuote(graphRow.graph, ELECTRONICS_ENGINE_REGISTRY, batchSize, rates, scenario ? { scenario } : {});
    const costResultId = await this.repository.workerInsertCostResult(uploadId, organizationId, graphRow.id, upload.revision_id, result);
    return { costResultId };
  }
}
