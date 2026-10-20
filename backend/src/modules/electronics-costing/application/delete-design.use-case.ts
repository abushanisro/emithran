import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { subtreeIds } from '../domain/uploads/subtree';
import { ElectronicsRepository, type UploadRow } from '../infrastructure/repositories/electronics.repository';
import { ElectronicsFileStore, previewArtifactPathFor, thumbnailArtifactPathFor } from '../infrastructure/storage/electronics-file-store';

export interface DeleteResult {
  /** What was removed. A revision delete that removed the last revision removes the part too (designs >= 1). */
  designs: number;
  revisions: number;
  files: number;
  /** True when the rows are gone but some stored files could not be removed (they are unreachable, and the failure is logged). */
  fileRemovalFailed: boolean;
}

// Deleting is permanent. The caller must be able to see the design (RLS); the rows are then removed with the service role, filtered
// by organization. Uploads go first (the revision foreign key has no cascade; their graphs, jobs and results cascade), then the
// design rows (revisions and children cascade), then the stored files.
@Injectable()
export class DeleteDesignUseCase {
  private readonly logger = new Logger(DeleteDesignUseCase.name);

  constructor(
    private readonly repository: ElectronicsRepository,
    private readonly store: ElectronicsFileStore,
  ) {}

  async deleteDesign(designId: string, organizationId: string, token: string): Promise<DeleteResult> {
    const design = await this.repository.getDesign(designId, token);
    const ids = design.project_id ? subtreeIds(await this.repository.listDesigns({ projectId: design.project_id }, token), design.id) : [design.id];
    const revisions = await this.repository.listRevisionsForDesigns(ids, token);
    const uploads = await this.repository.listUploadsByRevisions(revisions.map((r) => r.id), token);
    return this.erase({ uploads, designIds: ids, revisionCount: revisions.length }, organizationId);
  }

  async deleteRevision(designId: string, revisionId: string, organizationId: string, token: string): Promise<DeleteResult> {
    await this.repository.getDesign(designId, token);
    const revisions = await this.repository.listRevisions(designId, token);
    if (!revisions.some((r) => r.id === revisionId)) throw new NotFoundException('Revision not found');
    // The last revision is the part itself: nothing would be left to show.
    if (revisions.length === 1) return this.deleteDesign(designId, organizationId, token);
    const uploads = await this.repository.listUploadsByRevisions([revisionId], token);
    return this.erase({ uploads, designIds: [], revisionCount: 1, revisionId }, organizationId);
  }

  private async erase(
    plan: { uploads: UploadRow[]; designIds: string[]; revisionCount: number; revisionId?: string },
    organizationId: string,
  ): Promise<DeleteResult> {
    await this.repository.eraseUploads(plan.uploads.map((u) => u.id), organizationId);
    if (plan.revisionId) await this.repository.eraseRevision(plan.revisionId, organizationId);
    if (plan.designIds.length > 0) await this.repository.eraseDesigns(plan.designIds, organizationId);

    // The stored preview of a board upload goes with its files.
    const paths = plan.uploads.flatMap((u) => [...u.files.map((f) => f.storagePath), previewArtifactPathFor(organizationId, u.id), thumbnailArtifactPathFor(organizationId, u.id)]);
    let fileRemovalFailed = false;
    try {
      await this.store.remove(paths);
    } catch (error) {
      fileRemovalFailed = true;
      this.logger.warn(`could not remove ${paths.length} stored file(s) after a delete: ${error instanceof Error ? error.message : 'error'}`);
    }
    return { designs: plan.designIds.length, revisions: plan.revisionCount, files: paths.length, fileRemovalFailed };
  }
}
