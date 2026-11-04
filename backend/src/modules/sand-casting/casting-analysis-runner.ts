import { createHash } from "node:crypto";

import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import { AuditService } from "../../common/audit/audit.service";
import { DatabaseService } from "../../common/database/database.service";
import { OBJECT_STORE, type ObjectStore } from "../../common/storage/object-store";
import {
  CASTING_SCHEMA_VERSION,
  CASTING_SOURCE_BUCKET,
  CASTING_WORKER_VERSION,
  type CastingAnalysisConfig,
  type CastingAnalysisRow,
  parseCastingConfig,
} from "./casting-analysis.types";
import { drawDirectionMismatch, workerInputs } from "./casting-config";
import { parseCastingResult } from "./casting-result";
import { WorkerHostClient, WorkerRunError } from "./worker-host-client";

const POLL_MS = 30_000;
const STALE_SECONDS = 900;
const MAX_ATTEMPTS = 3;
const DEADLINE_MS = Number(process.env.CASTING_WORKER_DEADLINE_MS) || 600_000;
const MAX_OUTPUTS = 200;
const MAX_OUTPUT_BYTES = 512 * 1024 * 1024;

/** A failure a retry cannot fix. */
class PermanentFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// The background half of casting analysis. Rows are claimed with claim_next_casting_analysis (migration 955); one runner handles one
// analysis at a time, and more API replicas simply claim more rows, so concurrency is bounded by how many replicas run it.
// The runner holds credentials and never parses CAD: it sends the STEP bytes to the sandboxed worker host over a Unix socket
// (CASTING_WORKER_SOCKET) and stores what comes back. Without the socket setting it does nothing and rows stay queued.
@Injectable()
export class CastingAnalysisRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CastingAnalysisRunner.name);
  private readonly socket = process.env.CASTING_WORKER_SOCKET || "";
  private readonly host = this.socket
    ? new WorkerHostClient(this.socket, {
        deadlineMs: DEADLINE_MS,
        answerMarginMs: 60_000,
        maxOutputs: MAX_OUTPUTS,
        maxOutputBytes: MAX_OUTPUT_BYTES,
      })
    : null;
  private timer?: NodeJS.Timeout;
  private busy = false;
  private wakeRequested = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORE) private readonly objects: ObjectStore,
  ) {}

  private get enabled(): boolean {
    return this.host !== null && process.env.CASTING_ANALYSIS_RUNNER !== "off";
  }

  private get admin() {
    return this.database.getPrivilegedClient(
      "casting analysis runner: claim and finish its own queue, and read the part file it was asked to analyse",
    );
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log(
        "casting analysis runner is off (CASTING_WORKER_SOCKET is not set, or CASTING_ANALYSIS_RUNNER=off): requests stay queued",
      );
      return;
    }
    this.timer = setInterval(() => void this.tick(), POLL_MS);
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Start now instead of waiting for the next poll: called when an analysis has just been queued. */
  wake(): void {
    if (!this.enabled) return;
    this.wakeRequested = true;
    void this.tick();
  }

  /** Runs queued analyses until none is left. Single-flight: a tick that finds one running does nothing, but remembers it was asked. */
  async tick(): Promise<void> {
    if (!this.enabled) return;
    if (this.busy) {
      this.wakeRequested = true;
      return;
    }
    this.busy = true;
    try {
      do {
        this.wakeRequested = false;
        while (await this.runNext()) {
          /* until the queue is empty */
        }
      } while (this.wakeRequested);
    } catch (error) {
      this.logger.error(
        `casting analysis runner: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.busy = false;
    }
  }

  private async runNext(): Promise<boolean> {
    const { data, error } = await this.admin.rpc("claim_next_casting_analysis", {
      p_stale_seconds: STALE_SECONDS,
      p_max_attempts: MAX_ATTEMPTS,
    });
    if (error) throw new Error(`could not claim an analysis: ${error.message}`);
    const row = (data as CastingAnalysisRow[] | null)?.[0];
    if (!row) return false;
    const startedAt = Date.now();
    try {
      await this.process(row);
      this.logger.log(
        `casting analysis ${row.id} done in ${Date.now() - startedAt} ms (attempt ${row.attempts})`,
      );
    } catch (error) {
      // A retryable failure ends this drain: the retry waits for the next poll instead of hammering a crashing worker.
      if (await this.fail(row, error)) return false;
    }
    return true;
  }

  private async process(row: CastingAnalysisRow): Promise<void> {
    const { data: item, error } = await this.admin
      .from("bom_items")
      .select("file_3d_path")
      .eq("id", row.bom_item_id)
      .maybeSingle();
    if (error) throw new Error(`could not read the BOM item: ${error.message}`);
    const path = (item as { file_3d_path: string | null } | null)?.file_3d_path;
    if (!path)
      throw new PermanentFailure("no_cad_file", "The BOM item no longer has a 3D file.");
    const bytes = await this.objects.get(CASTING_SOURCE_BUCKET, path);
    if (!bytes)
      throw new PermanentFailure(
        "cad_file_missing",
        "The stored 3D file could not be read.",
      );
    // The item's file may have been replaced since the request: this row is about the file it asked for. A new request makes a new row.
    if (createHash("sha256").update(bytes).digest("hex") !== row.input_sha256) {
      throw new PermanentFailure(
        "input_changed",
        "The BOM item's 3D file changed after the analysis was requested.",
      );
    }

    // The configuration is the row's own: a row whose configuration this backend does not know is not run with a guess.
    const config = parseCastingConfig(row.config);
    if (!config)
      throw new PermanentFailure("invalid_config", "The analysis has a configuration this backend does not know.");
    const output = await this.runWorker(bytes, config);
    if (!output.result)
      throw new WorkerRunError(
        "no_result",
        "the worker finished without a result.json",
        false,
      );
    let json: unknown;
    try {
      json = JSON.parse(output.result.toString("utf8"));
    } catch {
      throw new WorkerRunError(
        "invalid_result",
        "the worker's result.json is not JSON",
        false,
      );
    }
    let result;
    try {
      result = parseCastingResult(json);
    } catch (e) {
      throw new WorkerRunError(
        "invalid_result",
        e instanceof Error ? e.message : String(e),
        false,
      );
    }
    if (
      result.diagnostics.worker_version !== CASTING_WORKER_VERSION ||
      result.schema_version !== CASTING_SCHEMA_VERSION
    ) {
      // Deployment skew: the worker is not the one this backend was built for. Failing makes it visible instead of storing
      // a result under the wrong version key.
      throw new PermanentFailure(
        "worker_version_mismatch",
        `expected worker ${CASTING_WORKER_VERSION} (schema ${CASTING_SCHEMA_VERSION}), got ${result.diagnostics.worker_version} (schema ${result.schema_version})`,
      );
    }

    // The worker must have done what was asked: a result along another axis would be stored as an answer to a question it did not answer.
    const mismatch = drawDirectionMismatch(result, config);
    if (mismatch) throw new PermanentFailure("draw_direction_mismatch", mismatch);

    const prefix = `casting-analyses/${row.organization_id}/${row.id}`;
    for (const [name, content] of output.parts)
      await this.objects.put(CASTING_SOURCE_BUCKET, `${prefix}/${name}`, content, {
        upsert: true,
      });

    // Only a row this runner still holds is finished: a row failed or reclaimed meanwhile is left as it is.
    const { error: saveError } = await this.admin
      .from("casting_analyses")
      .update({
        status: result.status === "complete" ? "succeeded" : "partial",
        result: json,
        output_prefix: prefix,
        error_code: null,
        error_detail: null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "running");
    if (saveError) throw new Error(`could not save the result: ${saveError.message}`);
  }

  /** Records the failure; true when the analysis was put back in the queue for another attempt. */
  /** The one call to the sandboxed worker host; a seam for tests. */
  protected runWorker(bytes: Buffer, config: CastingAnalysisConfig) {
    return (this.host as WorkerHostClient).run(workerInputs(bytes, config));
  }

  private async fail(row: CastingAnalysisRow, error: unknown): Promise<boolean> {
    const permanent =
      error instanceof PermanentFailure ||
      (error instanceof WorkerRunError && error.permanent);
    const code =
      error instanceof PermanentFailure || error instanceof WorkerRunError
        ? error.code
        : "analysis_failed";
    const detail = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    // A retryable failure goes back to the queue until the attempts are used up (claim_next_casting_analysis counts them).
    const retry = !permanent && row.attempts < MAX_ATTEMPTS;
    this.logger.warn(
      `casting analysis ${row.id} ${retry ? "will be retried" : "failed"} (${code}): ${detail}`,
    );
    const { error: saveError } = await this.admin
      .from("casting_analyses")
      .update(
        retry
          ? { status: "queued", error_code: code, error_detail: detail }
          : {
              status: "failed",
              error_code: code,
              error_detail: detail,
              finished_at: new Date().toISOString(),
            },
      )
      .eq("id", row.id)
      .eq("status", "running");
    if (saveError) throw new Error(`could not record the failure: ${saveError.message}`);
    if (!retry) {
      await this.audit.recordBestEffort({
        action: "casting_analysis.failed",
        targetType: "casting_analysis",
        targetId: row.id,
        organizationId: row.organization_id,
        actor: { kind: "system" },
        meta: { errorCode: code },
      });
    }
    return retry;
  }
}
