import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import FormData from 'form-data';

import { expandArchive, type ArchiveLimits } from '../../common/archive/expand-archive';
import { AuditService } from '../../common/audit/audit.service';
import { cadEngineHttp } from '../../common/resilience/engine-http';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { MAX_ARCHIVE_EXPANDED_BYTES, MAX_CAD_FILE_BYTES } from '../../common/upload-limits';
import { type CreateBOMItemDto } from '../bom-items/dto/bom-items.dto';
import { BOMItemsService } from '../bom-items/bom-items.service';
import { FileStorageService } from '../bom-items/services/file-storage.service';
import { parseAssemblyReport, type AssemblyNode, type AssemblyReport } from './assembly-report';
import { CAD_BUCKET, type CadUploadRow } from './cad-upload.types';
import { planItems, type PlannedItem } from './plan-items';
import { DEFAULT_CAD_ENGINE_URL } from '../../common/engine-urls';

// The runner starts the moment an upload is queued (wake()); this slow poll only recovers from a restart or another replica's
// rows, so an idle runner costs a few requests an hour, not one every two seconds.
const POLL_MS = 30_000;
// A failed upload keeps its original this long (a re-upload retries without sending the bytes again), then it is removed.
const FAILED_SOURCE_DAYS = 7;
const MAINTENANCE_EVERY_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
// Longer than the slowest legitimate run (engine call up to 10 min, plus item creation), so a live job is never re-claimed.
const STALE_SECONDS = 1800;
const ENGINE_TIMEOUT_MS = 600_000;
// A zip is unpacked in memory, so what it may expand to follows the upload limit (8x) instead of a fixed gigabyte.
const CAD_ARCHIVE_LIMITS: ArchiveLimits = { maxEntries: 10_000, maxEntryBytes: MAX_CAD_FILE_BYTES, maxTotalBytes: MAX_ARCHIVE_EXPANDED_BYTES };

/** The entry name the engine gives a part in /assembly/parts (cad-engine shared/assembly_report.py part_file_name). */
const partFileName = (definition: string) => `${definition.replace(/:/g, '_')}.step`;

/** The engine's `detail` from an error body, whether it arrived as JSON or as raw bytes (binary responses). */
function engineDetail(data: unknown): string | undefined {
  try {
    const body = Buffer.isBuffer(data) || data instanceof ArrayBuffer ? JSON.parse(Buffer.from(data as ArrayBuffer).toString('utf8')) : data;
    return typeof (body as { detail?: unknown })?.detail === 'string' ? (body as { detail: string }).detail : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The engine's multipart layer drops folders from file names, so two files called plate.step in different folders would
 * collide. Every file goes out under a unique name (its position, then its base name) and comes back mapped to its path.
 */
const wireName = (index: number, path: string): string => `${String(index).padStart(4, '0')}_${path.split('/').pop() ?? path}`;

function restoreFileNames(report: AssemblyReport, files: StepFile[]): AssemblyReport {
  const original = new Map(files.map((f, i) => [wireName(i, f.name), f.name]));
  const back = (name: string): string => original.get(name) ?? name;
  const node = (n: AssemblyNode): AssemblyNode => ({ ...n, file: back(n.file), children: n.children.map(node) });
  return {
    ...report,
    inputs: report.inputs.map((i) => ({ ...i, file: back(i.file), inside: i.inside ? back(i.inside) : null })),
    assembly: report.assembly.map(node),
    parts: report.parts.map((p) => ({ ...p, file: back(p.file) })),
  };
}

/** The engine's answers that say the uploaded files are unusable (bad request, too large, wrong type, unprocessable). */
const FILE_PROBLEM_STATUSES = new Set([400, 413, 415, 422]);

/** A short, printable piece of an error body, so a refusal without a `detail` is still diagnosable. */
function bodyExcerpt(data: unknown): string {
  const text = Buffer.isBuffer(data) || data instanceof ArrayBuffer ? Buffer.from(data as ArrayBuffer).toString('utf8') : typeof data === 'string' ? data : JSON.stringify(data ?? '');
  return text ? `: ${text.replace(/\s+/g, ' ').slice(0, 200)}` : '';
}

/** The upload itself is at fault (or the engine says so): retrying cannot help. */
class PermanentFailure extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

interface StepFile {
  name: string;
  bytes: Buffer;
}

// The background half of ZIP / STEP assembly upload. Rows are claimed with claim_next_cad_upload (migration 917);
// one runner handles one upload at a time, and more API replicas simply claim more rows.
@Injectable()
export class CadUploadRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CadUploadRunner.name);
  private readonly engineUrl = process.env.CAD_ENGINE_URL || DEFAULT_CAD_ENGINE_URL;
  private readonly engineKey = process.env.CAD_ENGINE_API_KEY || '';
  private timer?: NodeJS.Timeout;
  private busy = false;
  private wakeRequested = false;
  private lastMaintenance = 0;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly bomItems: BOMItemsService,
    private readonly files: FileStorageService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    if (process.env.CAD_UPLOAD_RUNNER === 'off') return;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Start now instead of waiting for the next poll: called when an upload has just been queued. */
  wake(): void {
    if (process.env.CAD_UPLOAD_RUNNER === 'off') return;
    this.wakeRequested = true;
    void this.tick();
  }

  /** Runs queued uploads until none is left. Single-flight: a tick that finds one running does nothing, but remembers it was asked. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      do {
        this.wakeRequested = false;
        while (await this.runNext()) {
          /* keep going while there is work */
        }
      } while (this.wakeRequested); // an upload queued while the last claim came back empty
      await this.maintain();
    } catch (error) {
      this.logger.error(`CAD upload runner: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.busy = false;
    }
  }

  /** Once an hour: remove the originals of uploads that failed and were never retried. Best effort, never throws. */
  private async maintain(): Promise<void> {
    if (Date.now() - this.lastMaintenance < MAINTENANCE_EVERY_MS) return;
    this.lastMaintenance = Date.now();
    const cutoff = new Date(Date.now() - FAILED_SOURCE_DAYS * 86_400_000).toISOString();
    const { data, error } = await this.admin
      .from('cad_uploads')
      .select('id, storage_path')
      .eq('status', 'failed')
      .is('source_deleted_at', null)
      .lt('finished_at', cutoff)
      .limit(50);
    if (error) {
      this.logger.warn(`could not list expired upload originals: ${error.message}`);
      return;
    }
    for (const row of (data ?? []) as Pick<CadUploadRow, 'id' | 'storage_path'>[]) await this.dropSource(row);
  }

  /** Removes the stored original (the parts are stored on their own) and records that it is gone. A failure is logged, not fatal. */
  private async dropSource(row: Pick<CadUploadRow, 'id' | 'storage_path'>): Promise<void> {
    try {
      const removed = await this.admin.storage.from(CAD_BUCKET).remove([row.storage_path]);
      if (removed.error) throw new Error(removed.error.message);
      const { error } = await this.admin.from('cad_uploads').update({ source_deleted_at: new Date().toISOString() }).eq('id', row.id);
      if (error) throw new Error(error.message);
    } catch (error) {
      this.logger.warn(`could not remove the original of upload ${row.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private get admin() {
    return this.supabase.getPrivilegedClient('cad-upload runner: claim and update queued CAD uploads');
  }

  private async runNext(): Promise<boolean> {
    const { data, error } = await this.admin.rpc('claim_next_cad_upload', { p_stale_seconds: STALE_SECONDS, p_max_attempts: MAX_ATTEMPTS });
    if (error) throw new Error(`could not claim an upload: ${error.message}`);
    const row = (data as CadUploadRow[] | null)?.[0];
    if (!row) return false;
    try {
      await this.process(row);
    } catch (error) {
      await this.fail(row, error);
    }
    return true;
  }

  private async process(row: CadUploadRow): Promise<void> {
    const startedAt = Date.now();
    // A retry starts clean: whatever an earlier attempt created is removed first.
    if (row.created_item_ids.length > 0) {
      await this.removeItems(row.created_item_ids);
      await this.saveCreated(row.id, []);
    }

    if (row.source_deleted_at) throw new PermanentFailure('source_expired', 'The original upload was removed to save space. Upload the file again.');
    const downloaded = await this.admin.storage.from(CAD_BUCKET).download(row.storage_path);
    if (downloaded.error || !downloaded.data) throw new Error(`could not read the stored upload: ${downloaded.error?.message ?? 'no data'}`);
    const { files, skipped } = this.stepFiles(row, Buffer.from(await downloaded.data.arrayBuffer()));

    const report = await this.analyse(files);
    if (report.assembly.length === 0) throw new PermanentFailure('no_solids', 'None of the STEP files could be read as a part or assembly.');

    const items = planItems(report, row.id.slice(0, 6));
    const needsFile = items.filter((i) => i.definition && !i.ownFile).map((i) => i.definition as string);
    const exported = await this.exportParts(files, [...new Set(needsFile)]);
    await this.createItems(row, items, files, exported);
    const { error } = await this.admin
      .from('cad_uploads')
      .update({ status: 'done', result: { report, skipped }, finished_at: new Date().toISOString() })
      .eq('id', row.id);
    if (error) throw new Error(`could not save the result: ${error.message}`);
    await this.dropSource(row);
    await this.audit.recordBestEffort({
      action: 'upload.completed',
      targetType: 'cad_upload',
      targetId: row.id,
      organizationId: row.organization_id,
      actor: { kind: 'system' },
      meta: { fileName: row.file_name, parts: report.parts.length, items: items.length, durationMs: Date.now() - startedAt },
    });
    this.logger.log(`CAD upload ${row.id} done in ${Date.now() - startedAt} ms: ${row.file_name}, ${files.length} STEP file(s), ${report.parts.length} distinct parts (attempt ${row.attempts})`);
  }

  private stepFiles(row: CadUploadRow, bytes: Buffer): { files: StepFile[]; skipped: { path: string; reason: string }[] } {
    if (!/\.zip$/i.test(row.file_name)) return { files: [{ name: row.file_name, bytes }], skipped: [] };

    const archive = expandArchive(row.file_name, bytes, CAD_ARCHIVE_LIMITS);
    if (!archive.ok) throw new PermanentFailure(archive.code, archive.message);
    const skipped = [...archive.skipped];
    const files: StepFile[] = [];
    for (const entry of archive.entries) {
      const inner = entry.path.slice(archive.root.length + 1);
      if (/\.(step|stp)$/i.test(entry.name)) files.push({ name: inner, bytes: entry.bytes });
      else skipped.push({ path: inner, reason: 'not a STEP file' });
    }
    if (files.length === 0) throw new PermanentFailure('no_step_files', 'The archive holds no STEP files.');
    return { files, skipped };
  }

  /** One call to the engine with the same files, in the same order every time (part ids start with the file's position). */
  private async callEngine(path: string, files: StepFile[], fields: Record<string, string> = {}, binary = false): Promise<unknown> {
    const form = new FormData();
    files.forEach((f, i) => form.append('files', f.bytes, { filename: wireName(i, f.name), contentType: 'application/step' }));
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    try {
      const response = await cadEngineHttp.post(`${this.engineUrl}${path}`, form, {
        timeout: ENGINE_TIMEOUT_MS,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        ...(binary && { responseType: 'arraybuffer' as const }),
        headers: { ...form.getHeaders(), ...(this.engineKey && { 'X-API-Key': this.engineKey }) },
      });
      return response.data;
    } catch (error: any) {
      const status: number | undefined = error?.response?.status;
      // Only a verdict on the files themselves is final. Anything else (busy, down, timeout, and 401/403/404, which mean
      // this runner is misconfigured rather than the upload bad) may pass, so another attempt or runner can succeed.
      if (status && FILE_PROBLEM_STATUSES.has(status)) {
        throw new PermanentFailure('engine_rejected', engineDetail(error.response.data) ?? `cad-engine answered ${status}${bodyExcerpt(error.response.data)}`);
      }
      throw error;
    }
  }

  private async analyse(files: StepFile[]): Promise<AssemblyReport> {
    try {
      return restoreFileNames(parseAssemblyReport(await this.callEngine('/analyze/assembly', files)), files);
    } catch (error) {
      if (error instanceof PermanentFailure || !(error instanceof Error) || !/outside its assembly contract/.test(error.message)) throw error;
      throw new PermanentFailure('invalid_engine_result', error.message);
    }
  }

  /** A STEP file of its own for every part that exists only inside an assembly file: definition id -> bytes. */
  private async exportParts(files: StepFile[], definitions: string[]): Promise<Map<string, Buffer>> {
    const out = new Map<string, Buffer>();
    if (definitions.length === 0) return out;
    const zipBytes = Buffer.from((await this.callEngine('/assembly/parts', files, { parts: JSON.stringify(definitions) }, true)) as ArrayBuffer);
    const archive = expandArchive('parts.zip', zipBytes, CAD_ARCHIVE_LIMITS);
    if (!archive.ok) throw new Error(`cad-engine returned an unreadable parts archive: ${archive.message}`);
    const byName = new Map(archive.entries.map((e) => [e.name, e.bytes]));
    for (const definition of definitions) {
      const bytes = byName.get(partFileName(definition));
      if (!bytes) throw new Error(`cad-engine did not return part ${definition}`);
      out.set(definition, bytes);
    }
    return out;
  }

  /** All or nothing: every item is recorded as it is created, and a failure removes all of them again. */
  private async createItems(row: CadUploadRow, items: PlannedItem[], files: StepFile[], exported: Map<string, Buffer>): Promise<void> {
    const bytesOf = new Map(files.map((f) => [f.name, f.bytes]));
    const idByKey = new Map<string, string>();
    const storedPaths = new Map<string, string>(); // one stored object per distinct part: every node of it points at the same file
    const created: string[] = [];
    try {
      for (const item of items) {
        const dto = {
          bomId: row.bom_id,
          name: item.name,
          partNumber: item.partNumber,
          description: `Imported from ${row.file_name}`,
          itemType: item.itemType,
          parentItemId: item.parentKey ? idByKey.get(item.parentKey) : undefined,
          quantity: item.quantity,
          unitCost: 0,
          unit: 'pcs',
          ...item.measured,
        } as CreateBOMItemDto;
        const made = await this.bomItems.createForUpload(dto, row.created_by, row.organization_id);
        idByKey.set(item.key, made.id);
        created.push(made.id);
        await this.saveCreated(row.id, created); // survives a crash: the retry removes exactly these

        const own = item.ownFile ? bytesOf.get(item.ownFile) : undefined;
        const bytes = own ?? (item.definition ? exported.get(item.definition) : undefined);
        if (item.ownFile && !bytes) throw new Error(`no bytes for ${item.ownFile}, which the engine reported as a part of its own`);
        if (bytes) {
          const partKey = item.ownFile ?? item.definition ?? item.key;
          let path = storedPaths.get(partKey);
          if (!path) {
            const fileName = item.ownFile ? (item.ownFile.split('/').pop() ?? item.ownFile) : `${item.name.replace(/[^\w.-]+/g, '_')}.step`;
            const uploaded = await this.files.uploadFile(
              { fieldname: 'file3d', originalname: fileName, encoding: '7bit', mimetype: 'application/octet-stream', size: bytes.length, buffer: bytes },
              '3d',
              row.created_by,
              row.project_id ?? '',
              made.id,
            );
            path = uploaded.storagePath;
            storedPaths.set(partKey, path);
          }
          await this.bomItems.setFile3dPathForUpload(made.id, path);
        }
      }
    } catch (error) {
      await this.removeItems(created);
      await this.saveCreated(row.id, []);
      throw error;
    }
  }

  /** Removes items, then the 3D files nothing references any more; a file that will not delete is logged, never allowed to block the cleanup. */
  private async removeItems(ids: string[]): Promise<void> {
    const paths = await this.bomItems.deleteItemsForUpload(ids);
    await this.files.removeUnreferencedFiles(paths).catch((error: unknown) => {
      this.logger.warn(`could not remove stored files: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private async saveCreated(id: string, ids: string[]): Promise<void> {
    const { error } = await this.admin.from('cad_uploads').update({ created_item_ids: ids }).eq('id', id);
    if (error) throw new Error(`could not record the created items: ${error.message}`);
  }

  private async fail(row: CadUploadRow, error: unknown): Promise<void> {
    const permanent = error instanceof PermanentFailure;
    const detail = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    const retry = !permanent && row.attempts < MAX_ATTEMPTS;
    this.logger.warn(`CAD upload ${row.id} ${retry ? 'will be retried' : 'failed'}: ${detail}`);
    const { error: writeError } = await this.admin
      .from('cad_uploads')
      .update(
        retry
          ? { status: 'queued', error_detail: detail }
          : { status: 'failed', error_code: permanent ? error.code : 'processing_failed', error_detail: detail, finished_at: new Date().toISOString() },
      )
      .eq('id', row.id);
    if (writeError) this.logger.error(`could not record the failure of CAD upload ${row.id}: ${writeError.message}`);
    if (!retry) {
      await this.audit.recordBestEffort({
        action: 'upload.failed',
        targetType: 'cad_upload',
        targetId: row.id,
        organizationId: row.organization_id,
        outcome: 'error',
        actor: { kind: 'system' },
        meta: { fileName: row.file_name, errorCode: permanent ? error.code : 'processing_failed' },
      });
    }
  }
}
