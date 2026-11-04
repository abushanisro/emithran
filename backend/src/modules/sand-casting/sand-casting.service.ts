import { createHash } from "node:crypto";

import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";

import { AuditService } from "../../common/audit/audit.service";
import { DatabaseService } from "../../common/database/database.service";
import { OBJECT_STORE, type ObjectStore } from "../../common/storage/object-store";
import { CastingAnalysisRunner } from "./casting-analysis-runner";
import { meshKey, meshNames } from './casting-meshes';
import {
  CASTING_SCHEMA_VERSION,
  CASTING_SOURCE_BUCKET,
  CASTING_WORKER_VERSION,
  DEFAULT_CASTING_CONFIG,
  configHash,
  type CastingAnalysisRow,
} from "./casting-analysis.types";

type AdminClient = ReturnType<DatabaseService["getPrivilegedClient"]>;

export interface CastingRequest {
  bomItemId: string;
  userId: string;
  organizationId: string;
  token: string;
}

// The API half of casting analysis. Analysis is lazy: nothing runs for a part until someone asks. A request reads the BOM item as
// the user (row-level security decides whether it is theirs), identifies its STEP file by hash, and either returns the analysis that
// already exists, copies a finished one made for the same file by the same organization, or queues one. It never parses CAD:
// the runner hands the file to the sandboxed worker.
/** How long a mesh URL works: long enough to load a model, short enough that a copied link is useless. */
const MESH_URL_SECONDS = 300;

@Injectable()
export class SandCastingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly runner: CastingAnalysisRunner,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORE) private readonly objects: ObjectStore,
  ) {}

  /** `reused` is true when no worker run was needed: the same analysis already existed or was copied from an identical file. */
  async request(
    input: CastingRequest,
  ): Promise<{ analysis: CastingAnalysisRow; reused: boolean }> {
    const item = await this.readItem(input.bomItemId, input.token);
    if (!item.file_3d_path)
      throw new UnprocessableEntityException({
        code: "no_cad_file",
        message: "This BOM item has no 3D file to analyse.",
      });
    const bytes = await this.objects.get(CASTING_SOURCE_BUCKET, item.file_3d_path);
    if (!bytes)
      throw new ConflictException({
        code: "cad_file_missing",
        message: "The stored 3D file of this BOM item could not be read.",
      });

    const key = {
      input_sha256: createHash("sha256").update(bytes).digest("hex"),
      worker_version: CASTING_WORKER_VERSION,
      schema_version: CASTING_SCHEMA_VERSION,
      config_hash: configHash(DEFAULT_CASTING_CONFIG),
    };
    const admin = this.database.getPrivilegedClient(
      "casting analysis: queue and read analyses after an RLS check of the BOM item",
    );

    const result = await this.queueOrReuse(admin, input, key);
    if (!result.reused || result.created) {
      await this.audit.recordBestEffort({
        action: "casting_analysis.requested",
        targetType: "casting_analysis",
        targetId: result.analysis.id,
        organizationId: input.organizationId,
        meta: { bomItemId: input.bomItemId, reused: result.reused },
      });
    }
    return { analysis: result.analysis, reused: result.reused };
  }

  private async queueOrReuse(
    admin: AdminClient,
    input: CastingRequest,
    key: Pick<
      CastingAnalysisRow,
      "input_sha256" | "worker_version" | "schema_version" | "config_hash"
    >,
  ): Promise<{ analysis: CastingAnalysisRow; reused: boolean; created: boolean }> {
    const existing = await this.find(admin, input.bomItemId, key);
    if (existing && existing.status !== "failed")
      return { analysis: existing, reused: true, created: false };
    // A failed analysis asked for again is a request to retry it.
    if (existing)
      return {
        analysis: await this.requeue(admin, existing.id),
        reused: false,
        created: false,
      };

    const done = await this.findFinished(admin, input.organizationId, key);
    const base = {
      organization_id: input.organizationId,
      bom_item_id: input.bomItemId,
      requested_by: input.userId,
      ...key,
    };
    const row = done
      ? {
          ...base,
          status: done.status,
          result: done.result,
          output_prefix: done.output_prefix,
          finished_at: new Date().toISOString(),
        }
      : base;
    const inserted = await admin
      .from("casting_analyses")
      .insert(row)
      .select("*")
      .single();
    if (!inserted.error) {
      if (!done) this.runner.wake(); // the runner sleeps between slow polls; this starts the job now
      return {
        analysis: inserted.data as CastingAnalysisRow,
        reused: Boolean(done),
        created: true,
      };
    }
    if (inserted.error.code !== "23505")
      throw new Error(`Could not queue the casting analysis: ${inserted.error.message}`);

    // Lost a race with the same request arriving at the same moment: it is the existing row now.
    const raced = await this.find(admin, input.bomItemId, key);
    if (!raced) throw new Error("Could not read the existing casting analysis");
    return { analysis: raced, reused: true, created: false };
  }

  /** Read as the user, so row-level security keeps other organizations' analyses invisible. */
  async get(id: string, token: string): Promise<CastingAnalysisRow> {
    const { data, error } = await this.database
      .getUserClient(token)
      .from("casting_analyses")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Could not read the casting analysis: ${error.message}`);
    if (!data) throw new NotFoundException(`Casting analysis ${id} not found`);
    return data as CastingAnalysisRow;
  }

  /**
   * A short-lived signed URL for one 3D file of an analysis (its part mesh or its cores). The analysis is read as the user, so another organization's is
   * not found; the name must be one the result lists; the file is fetched from the store by the browser, not through this process.
   */
  async meshUrl(id: string, name: string, token: string): Promise<{ name: string; url: string; expiresInSeconds: number }> {
    const analysis = await this.get(id, token);
    const notFound = () => new NotFoundException({ code: 'mesh_not_found', message: 'This analysis has no such 3D file.' });
    if (!analysis.output_prefix || !meshNames(analysis.result).includes(name)) throw notFound();
    const key = meshKey(analysis.output_prefix, name);
    if (!(await this.objects.exists(CASTING_SOURCE_BUCKET, key))) throw notFound();
    return { name, url: await this.objects.signedGetUrl(CASTING_SOURCE_BUCKET, key, MESH_URL_SECONDS), expiresInSeconds: MESH_URL_SECONDS };
  }

  /** The analyses of one BOM item, newest first. An empty list means "not requested", never "passed". */
  async listForItem(bomItemId: string, token: string): Promise<CastingAnalysisRow[]> {
    const { data, error } = await this.database
      .getUserClient(token)
      .from("casting_analyses")
      .select("*")
      .eq("bom_item_id", bomItemId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Could not list the casting analyses: ${error.message}`);
    return (data ?? []) as CastingAnalysisRow[];
  }

  private async readItem(
    bomItemId: string,
    token: string,
  ): Promise<{ id: string; file_3d_path: string | null }> {
    const { data, error } = await this.database
      .getUserClient(token)
      .from("bom_items")
      .select("id, file_3d_path")
      .eq("id", bomItemId)
      .maybeSingle();
    if (error) throw new Error(`Could not read the BOM item: ${error.message}`);
    if (!data) throw new NotFoundException(`BOM item ${bomItemId} not found`);
    return data as { id: string; file_3d_path: string | null };
  }

  private async find(
    admin: AdminClient,
    bomItemId: string,
    key: Pick<
      CastingAnalysisRow,
      "input_sha256" | "worker_version" | "schema_version" | "config_hash"
    >,
  ): Promise<CastingAnalysisRow | null> {
    const { data, error } = await admin
      .from("casting_analyses")
      .select("*")
      .eq("bom_item_id", bomItemId)
      .eq("input_sha256", key.input_sha256)
      .eq("worker_version", key.worker_version)
      .eq("schema_version", key.schema_version)
      .eq("config_hash", key.config_hash)
      .maybeSingle();
    if (error)
      throw new Error(`Could not look up the casting analysis: ${error.message}`);
    return (data as CastingAnalysisRow | null) ?? null;
  }

  /** A finished analysis of the same file, version and configuration made for any BOM item of this organization. */
  private async findFinished(
    admin: AdminClient,
    organizationId: string,
    key: Pick<
      CastingAnalysisRow,
      "input_sha256" | "worker_version" | "schema_version" | "config_hash"
    >,
  ): Promise<CastingAnalysisRow | null> {
    const { data, error } = await admin
      .from("casting_analyses")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("input_sha256", key.input_sha256)
      .eq("worker_version", key.worker_version)
      .eq("schema_version", key.schema_version)
      .eq("config_hash", key.config_hash)
      .in("status", ["succeeded", "partial"])
      .limit(1);
    if (error)
      throw new Error(`Could not look up a finished casting analysis: ${error.message}`);
    return ((data as CastingAnalysisRow[] | null) ?? [])[0] ?? null;
  }

  private async requeue(admin: AdminClient, id: string): Promise<CastingAnalysisRow> {
    const retried = await admin
      .from("casting_analyses")
      .update({
        status: "queued",
        attempts: 0,
        error_code: null,
        error_detail: null,
        finished_at: null,
      })
      .eq("id", id)
      .select("*")
      .single();
    if (retried.error)
      throw new Error(`Could not requeue the casting analysis: ${retried.error.message}`);
    this.runner.wake();
    return retried.data as CastingAnalysisRow;
  }
}
