import { BadRequestException, Injectable, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';

import { PreviewArtifactService } from './preview-artifact.service';
import { ExtractionRejected, ExtractionUnavailable } from '../infrastructure/ecad/ecad-engine.client';
import { ElectronicsRepository } from '../infrastructure/repositories/electronics.repository';

import type { ServedPreview } from './preview-artifact';
import type { UploadRow } from '../infrastructure/repositories/electronics.repository';

// The layers of an uploaded board set, for the preview on the Electronics page. The caller must be able to see the upload (RLS)
// before anything is read. The drawing is stored when the set is parsed, so the engine is only needed when none is stored yet.
@Injectable()
export class GetBoardPreviewUseCase {
  constructor(
    private readonly repository: ElectronicsRepository,
    private readonly artifacts: PreviewArtifactService,
  ) {}

  async execute(uploadId: string, organizationId: string, token: string): Promise<ServedPreview> {
    return this.guarded(uploadId, organizationId, token, (upload) => this.artifacts.get(upload, organizationId));
  }

  /** The list-card picture of the board (SVG text, or null when none can be shown). */
  async thumbnail(uploadId: string, organizationId: string, token: string): Promise<{ svg: string | null }> {
    return { svg: await this.guarded(uploadId, organizationId, token, (upload) => this.artifacts.getThumbnail(upload, organizationId)) };
  }

  private async guarded<T>(uploadId: string, organizationId: string, token: string, read: (upload: UploadRow) => Promise<T>): Promise<T> {
    const upload = await this.repository.getUpload(uploadId, token);
    if (upload.kind !== 'board') throw new BadRequestException('Only a board upload has a layer preview.');
    if (!upload.files.some((f) => f.role)) throw new BadRequestException('This upload has no Gerber or drill files to draw.');
    try {
      return await read(upload);
    } catch (error) {
      if (error instanceof ExtractionRejected) throw new UnprocessableEntityException({ code: error.code, message: error.message });
      if (error instanceof ExtractionUnavailable) throw new ServiceUnavailableException(error.message);
      throw error;
    }
  }
}
