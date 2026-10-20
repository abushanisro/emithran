import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { inferDesign, type DesignKind, type InputTier } from '../domain/uploads/infer-design';
import { validateUpload } from '../domain/uploads/validate-upload';
import { ELECTRONICS_JOB_QUEUE, ELECTRONICS_QUEUES, type JobQueue } from '../infrastructure/queue/job-queue.port';
import {
  ElectronicsRepository,
  type DesignRow,
  type RevisionRow,
  type StoredUploadFile,
  type UploadRow,
} from '../infrastructure/repositories/electronics.repository';
import { ElectronicsFileStore, sha256Hex, storagePathFor } from '../infrastructure/storage/electronics-file-store';

import type { SuppliedFacts } from '../domain/supplied-facts';

export interface StartUploadInput {
  files: { name: string; bytes: Buffer }[];
  /** Omitted: decided from the files (see inferDesign). Given: must agree with them. */
  kind?: DesignKind;
  tier?: InputTier;
  /** Add a revision to this design. Omitted: a new design is created. */
  designId?: string;
  /** Name for a new design; defaults to the first file name. */
  designName?: string;
  /** Project a new design belongs to (ignored when adding to an existing design). */
  projectId?: string;
  /** Container (assembly or sub-assembly) a new design is placed under; its project is used. */
  parentDesignId?: string;
  /** Revision label; defaults to the next number for the design. */
  revision?: string;
  /** Facts a person or document supplied (validated). Part of what a revision is. */
  supplied?: SuppliedFacts;
  organizationId: string;
  userId: string;
  token: string;
}

type ResolvedInput = StartUploadInput & { kind: DesignKind; tier: InputTier };

export interface StartUploadResult {
  uploadId: string;
  jobId: string;
  designId: string;
  revisionId: string;
  revision: string;
  /** True when these exact inputs were already uploaded for this design: nothing new was created. */
  reused: boolean;
}

export interface ParseJobPayload {
  uploadId: string;
  organizationId: string;
}

/** One value for the revision inputs: file names and contents, in a fixed order. */
export function inputHash(files: { name: string; sha256: string }[], supplied: SuppliedFacts = {}): string {
  const lines = files.map((f) => `${f.name}:${f.sha256}`).sort();
  // Supplied facts change the graph, so they are part of the revision identity (none: the hash is the files alone).
  const facts = Object.keys(supplied).sort().map((k) => `supplied:${k}=${supplied[k].value}:${supplied[k].note}`);
  lines.push(...facts);
  return sha256Hex(Buffer.from(lines.join('\n')));
}

// A revision is one fixed set of input files for a design. The same files sent again resolve to the
// existing revision (a retry cannot create a duplicate), and a revision label can never be reused for
// different files: changed inputs are a new revision.
@Injectable()
export class StartUploadUseCase {
  constructor(
    private readonly repository: ElectronicsRepository,
    private readonly store: ElectronicsFileStore,
    @Inject(ELECTRONICS_JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  async execute(raw: StartUploadInput): Promise<StartUploadResult> {
    if (raw.files.length === 0) throw new BadRequestException('At least one file is required');

    const uploadId = randomUUID();
    const stored: StoredUploadFile[] = [];
    const verdicts = raw.files.map((file) => validateUpload(file.name, file.bytes));
    const input = this.resolveKind(raw, verdicts);
    for (const [index, file] of input.files.entries()) {
      const verdict = verdicts[index];
      if (!verdict.ok) throw new BadRequestException({ code: verdict.code, message: `${file.name}: ${verdict.message}` });
      const sha256 = sha256Hex(file.bytes);
      stored.push({
        name: file.name,
        sizeBytes: file.bytes.length,
        sha256,
        storagePath: storagePathFor(input.organizationId, uploadId, index, sha256),
        format: verdict.format,
        ...(verdict.role ? { role: verdict.role } : {}),
      });
    }
    const hash = inputHash(stored, input.supplied);

    const design = await this.resolveDesign(input);
    const revisions = await this.repository.listRevisions(design.id, input.token);

    let revision = revisions.find((r) => r.input_sha256 === hash) ?? null;
    if (revision) {
      const existing = await this.repository.getUploadByRevision(revision.id, input.token);
      if (existing) return this.reuse(design, revision, existing, input);
    } else {
      revision = await this.createRevision(design, revisions, hash, input);
      if (!revision) return this.afterLostRace(design, hash, input);
    }
    return this.createUpload(design, revision, uploadId, stored, input);
  }

  // One upload field serves every kind of design: the kind and tier come from the files. A caller that states them must
  // agree with what the files are.
  private resolveKind(input: StartUploadInput, verdicts: ReturnType<typeof validateUpload>[]): ResolvedInput {
    const inferred = inferDesign(
      input.files.map((file, i) => {
        const verdict = verdicts[i];
        return { name: file.name, role: verdict.ok ? verdict.role : undefined, json: input.files.length === 1 ? this.readJson(file) : undefined };
      }),
    );
    if (!inferred.ok) {
      // The files do not say (for example an archive): a caller that states both kind and tier is taken at its word.
      if (input.kind && input.tier) return { ...input, kind: input.kind, tier: input.tier };
      throw new BadRequestException({ code: 'unknown_design_kind', message: inferred.message });
    }
    if (input.kind && input.kind !== inferred.kind) {
      throw new BadRequestException({ code: 'kind_mismatch', message: `These files are a ${inferred.kind}, not a ${input.kind}.` });
    }
    return { ...input, kind: inferred.kind, tier: input.tier ?? inferred.tier };
  }

  private readJson(file: { name: string; bytes: Buffer }): unknown {
    if (!file.name.toLowerCase().endsWith('.json')) return undefined;
    try {
      return JSON.parse(file.bytes.toString('utf8'));
    } catch {
      return undefined;
    }
  }

  private async resolveDesign(input: ResolvedInput): Promise<DesignRow> {
    if (input.designId) {
      const design = await this.repository.getDesign(input.designId, input.token);
      if (design.kind !== input.kind) {
        throw new BadRequestException(`Design ${design.id} is a ${design.kind}; this upload is a ${input.kind}.`);
      }
      return design;
    }
    let projectId = input.projectId ?? null;
    if (input.parentDesignId) {
      const parent = await this.repository.getDesign(input.parentDesignId, input.token);
      if (parent.item_type === 'child_part') throw new BadRequestException('A child part cannot contain other parts; choose an assembly or sub-assembly.');
      projectId = parent.project_id;
    }
    if (projectId && !(await this.repository.projectVisible(projectId, input.organizationId, input.token))) {
      throw new NotFoundException('Project not found');
    }
    return this.repository.insertDesign(
      {
        organization_id: input.organizationId,
        project_id: projectId,
        parent_design_id: input.parentDesignId ?? null,
        item_type: 'child_part',
        name: (input.designName ?? input.files[0].name).trim(),
        kind: input.kind,
        created_by: input.userId,
      },
      input.token,
    );
  }

  private async createRevision(
    design: DesignRow,
    revisions: RevisionRow[],
    hash: string,
    input: ResolvedInput,
  ): Promise<RevisionRow | null> {
    const label = (input.revision ?? String(revisions.length + 1)).trim();
    if (revisions.some((r) => r.revision === label)) {
      throw new ConflictException(`Revision ${label} already exists with different input files; use a new revision label.`);
    }
    return this.repository.insertRevision(
      { design_id: design.id, organization_id: input.organizationId, revision: label, input_sha256: hash, created_by: input.userId },
      input.token,
    );
  }

  // The insert lost a race on (design, revision) or (design, input hash). If the same inputs won, this is a
  // reuse; if a different set took the label, it is a conflict.
  private async afterLostRace(design: DesignRow, hash: string, input: ResolvedInput): Promise<StartUploadResult> {
    const revision = (await this.repository.listRevisions(design.id, input.token)).find((r) => r.input_sha256 === hash);
    if (!revision) throw new ConflictException('That revision label was taken by a concurrent upload with different files; retry with a new label.');
    const existing = await this.repository.getUploadByRevision(revision.id, input.token);
    if (!existing) throw new ConflictException('A concurrent upload is still creating this revision; retry shortly.');
    return this.reuse(design, revision, existing, input);
  }

  private async reuse(design: DesignRow, revision: RevisionRow, upload: UploadRow, input: ResolvedInput): Promise<StartUploadResult> {
    const job = await this.repository.latestParseJob(upload.id, input.token);
    const jobId = job?.id ?? (await this.enqueueParse(upload.id, input)).jobId;
    return { uploadId: upload.id, jobId, designId: design.id, revisionId: revision.id, revision: revision.revision, reused: true };
  }

  private async createUpload(
    design: DesignRow,
    revision: RevisionRow,
    uploadId: string,
    stored: StoredUploadFile[],
    input: ResolvedInput,
  ): Promise<StartUploadResult> {
    await this.storeAll(input, stored);
    try {
      await this.repository.insertUpload(
        {
          id: uploadId,
          organization_id: input.organizationId,
          created_by: input.userId,
          kind: input.kind,
          input_tier: input.tier,
          files: stored,
          revision_id: revision.id,
          // Written only when there is something to store, so an upload without supplied facts does not touch the column.
          ...(input.supplied && Object.keys(input.supplied).length > 0 ? { params: { supplied: input.supplied } } : {}),
        },
        input.token,
      );
    } catch (error) {
      await this.store.remove(stored.map((f) => f.storagePath)).catch(() => undefined);
      throw error;
    }
    const { jobId } = await this.enqueueParse(uploadId, input);
    return { uploadId, jobId, designId: design.id, revisionId: revision.id, revision: revision.revision, reused: false };
  }

  private async enqueueParse(uploadId: string, input: StartUploadInput): Promise<{ jobId: string }> {
    const payload: ParseJobPayload = { uploadId, organizationId: input.organizationId };
    const queueJobId = await this.queue.enqueue(ELECTRONICS_QUEUES.parse, payload);
    const job = await this.repository.insertJob(
      {
        organization_id: input.organizationId,
        upload_id: uploadId,
        job_type: 'parse',
        queue_job_id: queueJobId,
        batch_size: null,
        created_by: input.userId,
      },
      input.token,
    );
    return { jobId: job.id };
  }

  private async storeAll(input: StartUploadInput, stored: StoredUploadFile[]): Promise<void> {
    const written: string[] = [];
    try {
      for (const [index, file] of input.files.entries()) {
        await this.store.put(stored[index].storagePath, file.bytes);
        written.push(stored[index].storagePath);
      }
    } catch (error) {
      await this.store.remove(written).catch(() => undefined);
      throw error;
    }
  }
}
