import { Injectable, NotFoundException } from '@nestjs/common';

import { SupabaseService } from '../../../../common/supabase/supabase.service';

import type { ElectronicsFeatureGraph } from '../../domain/feature-graph/contract';
import type { ElectronicsQuoteResult } from '../../domain/quote/build-quote';
import type { RateEntry } from '../../domain/rates/rate-book';

export interface StoredUploadFile {
  name: string;
  sizeBytes: number;
  sha256: string;
  storagePath: string;
  format: string;
  /** Board-file role (copper_top, drill_data, ...) when the file has one. */
  role?: string;
}

export type UploadStatus = 'uploaded' | 'parsing' | 'needs_review' | 'confirmed' | 'failed';

export interface UploadRow {
  id: string;
  organization_id: string;
  created_by: string;
  kind: 'board' | 'harness';
  input_tier: 'A' | 'B' | 'C' | 'D';
  files: StoredUploadFile[];
  revision_id: string | null;
  /** Facts supplied with the upload: { supplied: { key: { value, note } } }. */
  params: { supplied?: Record<string, { value: number; note: string }> } | null;
  /** What the extraction engine returned besides the graph: file report and attached documents. */
  extraction: { documents: Record<string, unknown>; filesReport: unknown[] } | null;
  status: UploadStatus;
  failure: { code: string; message: string } | null;
  created_at: string;
}

export interface JobRow {
  id: string;
  organization_id: string;
  upload_id: string;
  job_type: 'parse' | 'quote';
  queue_job_id: string;
  batch_size: number | null;
}

export interface DesignRow {
  id: string;
  organization_id: string;
  name: string;
  /** 'assembly' for a container (assembly or sub-assembly); a child part is a board or a harness. */
  kind: 'board' | 'harness' | 'assembly';
  /** The project this design belongs to, when it was created from one. */
  project_id: string | null;
  /** The container this design sits in; null at the top level. */
  parent_design_id: string | null;
  item_type: 'assembly' | 'sub_assembly' | 'child_part';
  created_at: string;
}

export interface RevisionRow {
  id: string;
  design_id: string;
  organization_id: string;
  revision: string;
  input_sha256: string;
  created_at: string;
}

export interface FeatureGraphRow {
  id: string;
  organization_id: string;
  upload_id: string;
  review_status: 'needs_review' | 'confirmed';
  graph: ElectronicsFeatureGraph;
}

export interface CostResultRow {
  id: string;
  upload_id: string;
  feature_graph_id: string;
  revision_id: string | null;
  rate_version: string | null;
  rates_used: RateEntry[] | null;
  result_version: string;
  batch_size: number;
  assembly_cost_per_unit: number | null;
  complete: boolean;
  result: ElectronicsQuoteResult;
  created_at: string;
}

// The only place in the module that touches Supabase. Request-side methods run as the
// caller (RLS decides what is visible). Worker-side methods have no user in scope, so
// they run as the service role and filter by the organization id carried in the job
// payload on every statement.
@Injectable()
export class ElectronicsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  // ---- request side (RLS) -------------------------------------------------

  async insertUpload(row: Omit<UploadRow, 'status' | 'failure' | 'created_at' | 'params' | 'extraction'> & Partial<Pick<UploadRow, 'params'>>, token: string): Promise<UploadRow> {
    const { data, error } = await this.supabase.getUserClient(token).from('ecad_uploads').insert(row).select().single();
    if (error) throw new Error(`ecad_uploads insert failed: ${error.message}`);
    return data as UploadRow;
  }

  async getUpload(id: string, token: string): Promise<UploadRow> {
    const { data, error } = await this.supabase.getUserClient(token).from('ecad_uploads').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`ecad_uploads read failed: ${error.message}`);
    if (!data) throw new NotFoundException('Upload not found');
    return data as UploadRow;
  }

  async insertJob(row: Omit<JobRow, 'id'> & { created_by: string }, token: string): Promise<JobRow> {
    const { data, error } = await this.supabase.getUserClient(token).from('electronics_jobs').insert(row).select().single();
    if (error) throw new Error(`electronics_jobs insert failed: ${error.message}`);
    return data as JobRow;
  }

  async insertDesign(row: Omit<DesignRow, 'id' | 'created_at'> & { created_by: string }, token: string): Promise<DesignRow> {
    const { data, error } = await this.supabase.getUserClient(token).from('electronics_designs').insert(row).select().single();
    if (error) throw new Error(`electronics_designs insert failed: ${error.message}`);
    return data as DesignRow;
  }

  async getDesign(id: string, token: string): Promise<DesignRow> {
    const { data, error } = await this.supabase.getUserClient(token).from('electronics_designs').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`electronics_designs read failed: ${error.message}`);
    if (!data) throw new NotFoundException('Design not found');
    return data as DesignRow;
  }

  /** The design with this name directly under a parent (null: at the top level) of a project, for re-uploading the same folder. */
  async findDesignByName(
    filter: { projectId: string; parentId: string | null; name: string; container: boolean },
    token: string,
  ): Promise<DesignRow | null> {
    let query = this.supabase
      .getUserClient(token)
      .from('electronics_designs')
      .select('*')
      .eq('project_id', filter.projectId)
      .eq('name', filter.name);
    query = filter.parentId ? query.eq('parent_design_id', filter.parentId) : query.is('parent_design_id', null);
    query = filter.container ? query.neq('item_type', 'child_part') : query.eq('item_type', 'child_part');
    const { data, error } = await query.order('created_at', { ascending: true }).limit(1);
    if (error) throw new Error(`electronics_designs lookup failed: ${error.message}`);
    return ((data ?? [])[0] as DesignRow | undefined) ?? null;
  }

  /** Designs of the caller's organization (RLS), newest first, optionally only those of one project. */
  async listDesigns(filter: { projectId?: string }, token: string): Promise<DesignRow[]> {
    let query = this.supabase.getUserClient(token).from('electronics_designs').select('*').order('created_at', { ascending: false });
    if (filter.projectId) query = query.eq('project_id', filter.projectId);
    const { data, error } = await query;
    if (error) throw new Error(`electronics_designs list failed: ${error.message}`);
    return (data ?? []) as DesignRow[];
  }

  /** The uploads of the given revisions (one per revision), RLS-scoped. */
  async listUploadsByRevisions(revisionIds: string[], token: string): Promise<UploadRow[]> {
    if (revisionIds.length === 0) return [];
    const { data, error } = await this.supabase.getUserClient(token).from('ecad_uploads').select('*').in('revision_id', revisionIds);
    if (error) throw new Error(`ecad_uploads list failed: ${error.message}`);
    return (data ?? []) as UploadRow[];
  }

  /** Every revision of the given designs, RLS-scoped. */
  async listRevisionsForDesigns(designIds: string[], token: string): Promise<RevisionRow[]> {
    if (designIds.length === 0) return [];
    const { data, error } = await this.supabase.getUserClient(token).from('electronics_design_revisions').select('*').in('design_id', designIds);
    if (error) throw new Error(`electronics_design_revisions list failed: ${error.message}`);
    return (data ?? []) as RevisionRow[];
  }

  /** True when the project is visible to the caller (RLS) and belongs to the organization. */
  async projectVisible(projectId: string, organizationId: string, token: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .getUserClient(token)
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (error) throw new Error(`projects read failed: ${error.message}`);
    return !!data;
  }

  async listRevisions(designId: string, token: string): Promise<RevisionRow[]> {
    const { data, error } = await this.supabase.getUserClient(token).from('electronics_design_revisions').select('*').eq('design_id', designId);
    if (error) throw new Error(`electronics_design_revisions read failed: ${error.message}`);
    return (data ?? []) as RevisionRow[];
  }

  /** Returns null when the insert lost a race on (design, revision) or (design, input hash). */
  async insertRevision(row: Omit<RevisionRow, 'id' | 'created_at'> & { created_by: string }, token: string): Promise<RevisionRow | null> {
    const { data, error } = await this.supabase.getUserClient(token).from('electronics_design_revisions').insert(row).select().single();
    if (error?.code === '23505') return null;
    if (error) throw new Error(`electronics_design_revisions insert failed: ${error.message}`);
    return data as RevisionRow;
  }

  async getUploadByRevision(revisionId: string, token: string): Promise<UploadRow | null> {
    const { data, error } = await this.supabase.getUserClient(token).from('ecad_uploads').select('*').eq('revision_id', revisionId).maybeSingle();
    if (error) throw new Error(`ecad_uploads read failed: ${error.message}`);
    return (data as UploadRow | null) ?? null;
  }

  async latestParseJob(uploadId: string, token: string): Promise<JobRow | null> {
    const { data, error } = await this.supabase
      .getUserClient(token)
      .from('electronics_jobs')
      .select('*')
      .eq('upload_id', uploadId)
      .eq('job_type', 'parse')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`electronics_jobs read failed: ${error.message}`);
    return (data as JobRow | null) ?? null;
  }

  async getJob(id: string, token: string): Promise<JobRow> {
    const { data, error } = await this.supabase.getUserClient(token).from('electronics_jobs').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`electronics_jobs read failed: ${error.message}`);
    if (!data) throw new NotFoundException('Job not found');
    return data as JobRow;
  }

  async getCostResult(id: string, token: string): Promise<CostResultRow> {
    const { data, error } = await this.supabase.getUserClient(token).from('electronics_cost_results').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`electronics_cost_results read failed: ${error.message}`);
    if (!data) throw new NotFoundException('Result not found');
    return data as CostResultRow;
  }

  // ---- deletes (service role, organization-filtered) ---------------------
  // Users have no DELETE policy on these tables. The use case proves the caller can see the design (user client, RLS) before any
  // of these run, and every statement filters by the organization id.

  private eraser() {
    return this.supabase.getPrivilegedClient(
      'user-delete: electronics designs and uploads have no end-user DELETE policy; the caller is proven to see the design first and every statement filters by organization id',
    );
  }

  async eraseUploads(uploadIds: string[], organizationId: string): Promise<void> {
    if (uploadIds.length === 0) return;
    const { error } = await this.eraser().from('ecad_uploads').delete().in('id', uploadIds).eq('organization_id', organizationId);
    if (error) throw new Error(`ecad_uploads delete failed: ${error.message}`);
  }

  async eraseRevision(revisionId: string, organizationId: string): Promise<void> {
    const { error } = await this.eraser().from('electronics_design_revisions').delete().eq('id', revisionId).eq('organization_id', organizationId);
    if (error) throw new Error(`electronics_design_revisions delete failed: ${error.message}`);
  }

  async eraseDesigns(designIds: string[], organizationId: string): Promise<void> {
    const { error } = await this.eraser().from('electronics_designs').delete().in('id', designIds).eq('organization_id', organizationId);
    if (error) throw new Error(`electronics_designs delete failed: ${error.message}`);
  }

  // ---- worker side (service role, organization-filtered) -----------------

  private worker() {
    return this.supabase.getPrivilegedClient(
      'system-job: electronics pipeline worker has no user context and filters every statement by the organization id in the job payload',
    );
  }

  async workerGetUpload(id: string, organizationId: string): Promise<UploadRow> {
    const { data, error } = await this.worker().from('ecad_uploads').select('*').eq('id', id).eq('organization_id', organizationId).maybeSingle();
    if (error) throw new Error(`ecad_uploads read failed: ${error.message}`);
    if (!data) throw new Error(`Upload ${id} not found for organization`);
    return data as UploadRow;
  }

  async workerSetUploadStatus(
    id: string,
    organizationId: string,
    status: UploadStatus,
    failure: { code: string; message: string } | null = null,
  ): Promise<void> {
    const { error } = await this.worker()
      .from('ecad_uploads')
      .update({ status, failure, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('organization_id', organizationId);
    if (error) throw new Error(`ecad_uploads status update failed: ${error.message}`);
  }

  async workerSetUploadExtraction(id: string, organizationId: string, extraction: { documents: Record<string, unknown>; filesReport: unknown[] }): Promise<void> {
    const { error } = await this.worker().from('ecad_uploads').update({ extraction }).eq('id', id).eq('organization_id', organizationId);
    if (error) throw new Error(`ecad_uploads extraction update failed: ${error.message}`);
  }

  /** The newest feature graph of an upload, as the caller sees it (RLS). Null when none has been parsed yet. */
  /** The newest feature graph of each given upload (uploads without one are absent), RLS-scoped. */
  async listLatestFeatureGraphs(uploadIds: string[], token: string): Promise<FeatureGraphRow[]> {
    if (uploadIds.length === 0) return [];
    const { data, error } = await this.supabase
      .getUserClient(token)
      .from('electronics_feature_graphs')
      .select('*')
      .in('upload_id', uploadIds)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`electronics_feature_graphs list failed: ${error.message}`);
    const newest = new Map<string, FeatureGraphRow>();
    for (const row of (data ?? []) as FeatureGraphRow[]) if (!newest.has(row.upload_id)) newest.set(row.upload_id, row);
    return [...newest.values()];
  }

  async getLatestFeatureGraph(uploadId: string, token: string): Promise<FeatureGraphRow | null> {
    const { data, error } = await this.supabase
      .getUserClient(token)
      .from('electronics_feature_graphs')
      .select('*')
      .eq('upload_id', uploadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`electronics_feature_graphs read failed: ${error.message}`);
    return (data as FeatureGraphRow | null) ?? null;
  }

  async workerInsertFeatureGraph(uploadId: string, organizationId: string, graph: ElectronicsFeatureGraph): Promise<string> {
    const { data, error } = await this.worker()
      .from('electronics_feature_graphs')
      .insert({
        organization_id: organizationId,
        upload_id: uploadId,
        kind: graph.kind,
        contract_version: graph.contractVersion,
        review_status: graph.reviewStatus,
        graph,
      })
      .select('id')
      .single();
    if (error) throw new Error(`electronics_feature_graphs insert failed: ${error.message}`);
    return (data).id;
  }

  async workerGetLatestFeatureGraph(uploadId: string, organizationId: string): Promise<FeatureGraphRow> {
    const { data, error } = await this.worker()
      .from('electronics_feature_graphs')
      .select('*')
      .eq('upload_id', uploadId)
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`electronics_feature_graphs read failed: ${error.message}`);
    if (!data) throw new Error(`Upload ${uploadId} has no feature graph yet`);
    return data as FeatureGraphRow;
  }

  async workerInsertCostResult(
    uploadId: string,
    organizationId: string,
    featureGraphId: string,
    revisionId: string | null,
    result: ElectronicsQuoteResult,
  ): Promise<string> {
    const { data, error } = await this.worker()
      .from('electronics_cost_results')
      .insert({
        organization_id: organizationId,
        upload_id: uploadId,
        feature_graph_id: featureGraphId,
        revision_id: revisionId,
        rate_version: result.rateVersion,
        rates_used: result.ratesUsed,
        result_version: result.resultVersion,
        batch_size: result.batchSize,
        assembly_cost_per_unit: result.assemblyCostPerUnit,
        complete: result.complete,
        result,
      })
      .select('id')
      .single();
    if (error) throw new Error(`electronics_cost_results insert failed: ${error.message}`);
    return (data).id;
  }
}
