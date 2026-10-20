import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { ELECTRONICS_JOB_QUEUE, ELECTRONICS_QUEUES, type JobQueue } from '../infrastructure/queue/job-queue.port';
import { ElectronicsRepository } from '../infrastructure/repositories/electronics.repository';

import type { ParseJobPayload } from './start-upload.use-case';

// Reads the stored files of a revision again (for example after the engine was fixed or restarted). The files do not change, so the
// revision stays the same; a new feature graph is stored beside the old one and the newest is shown.
@Injectable()
export class ReparseUploadUseCase {
  constructor(
    private readonly repository: ElectronicsRepository,
    @Inject(ELECTRONICS_JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  async execute(input: { uploadId: string; organizationId: string; userId: string; token: string }): Promise<{ jobId: string }> {
    const upload = await this.repository.getUpload(input.uploadId, input.token);
    if (upload.status === 'uploaded' || upload.status === 'parsing') {
      throw new BadRequestException('These files are already being read.');
    }
    await this.repository.workerSetUploadStatus(upload.id, input.organizationId, 'uploaded');
    const payload: ParseJobPayload = { uploadId: upload.id, organizationId: input.organizationId };
    const queueJobId = await this.queue.enqueue(ELECTRONICS_QUEUES.parse, payload);
    const job = await this.repository.insertJob(
      { organization_id: input.organizationId, upload_id: upload.id, job_type: 'parse', queue_job_id: queueJobId, batch_size: null, created_by: input.userId },
      input.token,
    );
    return { jobId: job.id };
  }
}
