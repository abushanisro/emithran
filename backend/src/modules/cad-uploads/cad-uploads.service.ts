import { createHash } from 'node:crypto';

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { OBJECT_STORE, type ObjectStore } from '../../common/storage/object-store';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { BOMItemsService } from '../bom-items/bom-items.service';
import { CadUploadRunner } from './cad-upload-runner';
import { CAD_BUCKET, type CadUploadRow } from './cad-upload.types';
import { checkUpload } from './check-upload';


export interface NewUpload {
  fileName: string;
  bytes: Buffer;
  bomId: string;
  userId: string;
  organizationId: string;
  token: string;
}

// The API half of ZIP / STEP assembly upload: store the bytes, queue one row, never parse CAD. The runner does the rest.
@Injectable()
export class CadUploadsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly bomItems: BOMItemsService,
    private readonly runner: CadUploadRunner,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORE) private readonly objects: ObjectStore,
  ) {}

  /** `duplicate` is true when these exact bytes were already uploaded to this BOM (the existing upload is returned). */
  async create(input: NewUpload): Promise<{ upload: CadUploadRow; duplicate: boolean }> {
    const result = await this.storeAndQueue(input);
    // A repeat of an upload already on record adds nothing to the trail; a new or retried one does.
    if (!result.duplicate) {
      await this.audit.recordBestEffort({
        action: 'upload.created',
        targetType: 'cad_upload',
        targetId: result.upload.id,
        organizationId: input.organizationId,
        meta: { fileName: input.fileName, sizeBytes: input.bytes.length },
      });
    }
    return result;
  }

  private async storeAndQueue(input: NewUpload): Promise<{ upload: CadUploadRow; duplicate: boolean }> {
    const check = checkUpload(input.fileName, input.bytes);
    if (!check.ok) throw new BadRequestException({ code: check.code, message: check.message });

    // Row-level security decides whether this user can see the BOM; everything after runs as the service.
    const projectId = await this.bomItems.getProjectIdForBOM(input.bomId, input.userId, input.token);

    const admin = this.supabase.getPrivilegedClient('cad-upload: store the uploaded file and queue its job after an RLS check of the BOM');
    const sha256 = createHash('sha256').update(input.bytes).digest('hex');
    const storagePath = `cad-uploads/${input.organizationId}/${sha256}.${check.kind === 'zip' ? 'zip' : 'step'}`;

    // The same bytes again must cost nothing: check for them BEFORE touching storage (a repeat used to re-upload the whole file).
    const existing = await this.find(admin, input.bomId, sha256);
    if (existing && existing.status !== 'failed') return { upload: existing, duplicate: true };

    // New, or failed earlier. Only a failed upload whose original is still stored can be retried without sending the bytes again.
    if (!existing || existing.source_deleted_at) await this.objects.put(CAD_BUCKET, storagePath, input.bytes, { upsert: true });

    if (existing) return { upload: await this.requeue(admin, existing.id), duplicate: false };

    const inserted = await admin
      .from('cad_uploads')
      .insert({
        organization_id: input.organizationId,
        created_by: input.userId,
        bom_id: input.bomId,
        project_id: projectId,
        file_name: input.fileName,
        sha256,
        size_bytes: input.bytes.length,
        storage_path: storagePath,
      })
      .select('*')
      .single();
    if (!inserted.error) {
      this.runner.wake(); // the runner sleeps between slow fallback polls; this starts the job now
      return { upload: inserted.data as CadUploadRow, duplicate: false };
    }
    if (inserted.error.code !== '23505') throw new Error(`Could not queue the upload: ${inserted.error.message}`);

    // Lost a race with the same upload arriving at the same moment: it is the existing row now.
    const raced = await this.find(admin, input.bomId, sha256);
    if (!raced) throw new Error('Could not read the existing upload');
    return raced.status === 'failed' ? { upload: await this.requeue(admin, raced.id), duplicate: false } : { upload: raced, duplicate: true };
  }

  /** Read as the user, so row-level security keeps other organizations' uploads invisible. */
  async get(id: string, token: string): Promise<CadUploadRow> {
    const { data, error } = await this.supabase.getUserClient(token).from('cad_uploads').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`Could not read the upload: ${error.message}`);
    if (!data) throw new NotFoundException(`Upload ${id} not found`);
    return data as CadUploadRow;
  }

  private async find(admin: ReturnType<SupabaseService['getPrivilegedClient']>, bomId: string, sha256: string): Promise<CadUploadRow | null> {
    const { data, error } = await admin.from('cad_uploads').select('*').eq('bom_id', bomId).eq('sha256', sha256).maybeSingle();
    if (error) throw new Error(`Could not look up the upload: ${error.message}`);
    return (data as CadUploadRow | null) ?? null;
  }

  /** Uploading the same file again after a failure is a request to retry it. */
  private async requeue(admin: ReturnType<SupabaseService['getPrivilegedClient']>, id: string): Promise<CadUploadRow> {
    const retried = await admin
      .from('cad_uploads')
      .update({ status: 'queued', attempts: 0, error_code: null, error_detail: null, finished_at: null, source_deleted_at: null })
      .eq('id', id)
      .select('*')
      .single();
    if (retried.error) throw new Error(`Could not requeue the upload: ${retried.error.message}`);
    this.runner.wake();
    return retried.data as CadUploadRow;
  }
}
