import { Inject, Injectable } from '@nestjs/common';

import { PreviewArtifactService } from './preview-artifact.service';
import { FEATURE_GRAPH_PARSERS, ParseFailure, type FeatureGraphParser } from './parsers/feature-graph-parser';
import { validateFeatureGraph } from '../domain/feature-graph/validate';
import { ElectronicsRepository } from '../infrastructure/repositories/electronics.repository';
import { ElectronicsFileStore } from '../infrastructure/storage/electronics-file-store';

import type { ParseJobPayload } from './start-upload.use-case';

// Worker side: upload bytes -> candidate graph -> contract validation -> stored, versioned feature graph. A failure is
// recorded on the upload (code + message, never file content) and rethrown so the queue marks the attempt failed.
@Injectable()
export class ProcessParseJob {
  constructor(
    private readonly repository: ElectronicsRepository,
    private readonly store: ElectronicsFileStore,
    private readonly previews: PreviewArtifactService,
    @Inject(FEATURE_GRAPH_PARSERS) private readonly parsers: readonly FeatureGraphParser[],
  ) {}

  async run({ uploadId, organizationId }: ParseJobPayload): Promise<Record<string, unknown>> {
    const upload = await this.repository.workerGetUpload(uploadId, organizationId);
    await this.repository.workerSetUploadStatus(uploadId, organizationId, 'parsing');
    try {
      const files = await Promise.all(
        upload.files.map(async (f) => ({
          name: f.name,
          bytes: await this.store.get(f.storagePath, organizationId),
          role: f.role ?? null,
        })),
      );
      const parser = this.parsers.find((p) => p.accepts(upload, files));
      if (!parser) {
        throw new ParseFailure('no_parser', `No parser is available yet for tier ${upload.input_tier} ${upload.kind} uploads of this shape.`);
      }

      const parsed = await parser.parse(upload, files);
      const validation = validateFeatureGraph(parsed.graph);
      if (!validation.valid) {
        const detail = validation.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
        throw new ParseFailure('invalid_feature_graph', `Feature graph rejected by the contract. ${detail}`);
      }
      if (validation.graph.kind !== upload.kind) {
        throw new ParseFailure('kind_mismatch', `Upload is a ${upload.kind} but the graph is a ${validation.graph.kind}.`);
      }

      const featureGraphId = await this.repository.workerInsertFeatureGraph(uploadId, organizationId, validation.graph);
      if (parsed.extraction) await this.repository.workerSetUploadExtraction(uploadId, organizationId, parsed.extraction);
      await this.repository.workerSetUploadStatus(uploadId, organizationId, validation.graph.reviewStatus);
      // Keep the first drawing so the viewer does not need the engine afterwards. Best effort: it never fails the parse.
      await this.previews.keep(upload, organizationId);
      return { featureGraphId };
    } catch (error) {
      const code = error instanceof ParseFailure ? error.code : 'parse_error';
      const message = error instanceof Error ? error.message : String(error);
      await this.repository.workerSetUploadStatus(uploadId, organizationId, 'failed', { code, message });
      throw error;
    }
  }
}
