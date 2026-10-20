import { Injectable } from '@nestjs/common';

import { summarizeGraph, type GraphSummary } from '../domain/feature-graph/summary';
import {
  ElectronicsRepository,
  type DesignRow,
  type FeatureGraphRow,
  type RevisionRow,
  type UploadRow,
  type UploadStatus,
} from '../infrastructure/repositories/electronics.repository';

export interface RevisionView {
  id: string;
  revision: string;
  createdAt: string;
  uploadId: string | null;
  status: UploadStatus | null;
  /** Why the files could not be read, when the revision failed. */
  failure: { code: string; message: string } | null;
}

export interface DesignView {
  id: string;
  name: string;
  kind: 'board' | 'harness' | 'assembly';
  itemType: 'assembly' | 'sub_assembly' | 'child_part';
  /** The container this design sits in; null at the top level. */
  parentId: string | null;
  projectId: string | null;
  createdAt: string;
  /** Newest revision first. */
  revisions: RevisionView[];
  /** What the newest revision's feature graph measured; null until that revision has been read. */
  summary: GraphSummary | null;
}

/** Joins designs with their revisions and each revision's upload. Pure so the ordering rule is tested on its own. */
export function buildDesignViews(designs: DesignRow[], revisions: RevisionRow[], uploads: UploadRow[], graphs: FeatureGraphRow[] = []): DesignView[] {
  const graphByUpload = new Map(graphs.map((g) => [g.upload_id, g]));
  const uploadByRevision = new Map(uploads.flatMap((u) => (u.revision_id ? [[u.revision_id, u] as const] : [])));
  return designs.map((design) => {
    const views = revisions
      .filter((r) => r.design_id === design.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((r) => {
        const upload = uploadByRevision.get(r.id) ?? null;
        return { id: r.id, revision: r.revision, createdAt: r.created_at, uploadId: upload?.id ?? null, status: upload?.status ?? null, failure: upload?.failure ?? null };
      });
    const newestGraph = views[0]?.uploadId ? graphByUpload.get(views[0].uploadId) : undefined;
    return {
      id: design.id,
      name: design.name,
      kind: design.kind,
      itemType: design.item_type,
      parentId: design.parent_design_id,
      projectId: design.project_id,
      createdAt: design.created_at,
      revisions: views,
    summary: newestGraph ? summarizeGraph(newestGraph.graph) : null,
    };
  });
}

@Injectable()
export class ListDesignsUseCase {
  constructor(private readonly repository: ElectronicsRepository) {}

  async list(filter: { projectId?: string }, token: string): Promise<DesignView[]> {
    const designs = await this.repository.listDesigns(filter, token);
    return this.withRevisions(designs, token);
  }

  async get(designId: string, token: string): Promise<DesignView> {
    const design = await this.repository.getDesign(designId, token);
    return (await this.withRevisions([design], token))[0];
  }

  private async withRevisions(designs: DesignRow[], token: string): Promise<DesignView[]> {
    const revisions = await this.repository.listRevisionsForDesigns(designs.map((d) => d.id), token);
    const uploads = await this.repository.listUploadsByRevisions(revisions.map((r) => r.id), token);
    const graphs = await this.repository.listLatestFeatureGraphs(uploads.map((u) => u.id), token);
    return buildDesignViews(designs, revisions, uploads, graphs);
  }
}
