import { Inject, Injectable } from '@nestjs/common';

import {
  ELECTRONICS_JOB_QUEUE,
  ELECTRONICS_QUEUES,
  type JobQueue,
  type JobState,
} from '../infrastructure/queue/job-queue.port';
import { ElectronicsRepository } from '../infrastructure/repositories/electronics.repository';

export interface JobStatusView {
  jobId: string;
  jobType: 'parse' | 'quote';
  uploadId: string;
  // 'expired': the queue no longer holds the job (retention); its output ids are gone.
  state: JobState | 'expired';
  attempts: number;
  error?: string;
  featureGraphId?: string;
  costResultId?: string;
}

@Injectable()
export class GetJobStatusUseCase {
  constructor(
    private readonly repository: ElectronicsRepository,
    @Inject(ELECTRONICS_JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  async execute(jobId: string, token: string): Promise<JobStatusView> {
    const job = await this.repository.getJob(jobId, token);
    const queueName = job.job_type === 'parse' ? ELECTRONICS_QUEUES.parse : ELECTRONICS_QUEUES.quote;
    const status = await this.queue.status(queueName, job.queue_job_id);
    const view: JobStatusView = {
      jobId: job.id,
      jobType: job.job_type,
      uploadId: job.upload_id,
      state: status?.state ?? 'expired',
      attempts: status?.attempts ?? 0,
    };
    if (status?.error) view.error = status.error;
    if (typeof status?.output?.featureGraphId === 'string') view.featureGraphId = status.output.featureGraphId;
    if (typeof status?.output?.costResultId === 'string') view.costResultId = status.output.costResultId;
    return view;
  }
}
