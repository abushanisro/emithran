import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import { AuditService } from "../../common/audit/audit.service";
import { DatabaseService } from "../../common/database/database.service";
import { OBJECT_STORE, type ObjectStore } from "../../common/storage/object-store";
import { CASTING_SOURCE_BUCKET, CASTING_WORKER_VERSION } from "./casting-analysis.types";

// Retention of old casting analyses. Off unless CASTING_RETENTION_DAYS is set to a positive number of days (nothing is deleted on an assumed schedule).
// Past that age, an analysis is removed when it is no longer what anyone is working from:
//   - it failed (no result, no files);
//   - its BOM item's 3D file has been replaced (the analysis describes a file the part no longer has);
//   - it was made by an earlier worker than the running one (a newer worker analyses the part again when it is opened).
// Nothing else refers to an analysis: a frozen cost keeps its own copy of the summary, and an engineer's draw direction keeps a copy of the geometry it was
// chosen on. The files of a removed analysis are removed only when no remaining row points at the same output prefix (a reused row points at the original's).

const POLL_MS = 6 * 60 * 60 * 1000;
const BATCH = 200;

export interface RetentionRow {
  id: string;
  status: string;
  finished_at: string | null;
  worker_version: string;
  source_path: string | null;
  output_prefix: string | null;
  bom_item_id: string;
  organization_id: string;
}

/** The ids of the rows to remove: older than the cutoff and failed, or for a file the item no longer has, or from an earlier worker than `currentWorker`. */
export function prunable(
  rows: readonly RetentionRow[],
  currentFileOf: ReadonlyMap<string, string | null>,
  cutoff: Date,
  currentWorker: string,
): string[] {
  return rows
    .filter((r) => {
      if (r.status === "queued" || r.status === "running") return false;
      if (!r.finished_at || new Date(r.finished_at).getTime() >= cutoff.getTime()) return false;
      if (r.status === "failed") return true;
      if (r.worker_version !== currentWorker) return true;
      return currentFileOf.has(r.bom_item_id) && currentFileOf.get(r.bom_item_id) !== r.source_path;
    })
    .map((r) => r.id);
}

/** The retention days from the environment: a positive whole number, else null (retention is off). */
export function retentionDays(value: string | undefined): number | null {
  const n = Number(value);
  return value != null && value.trim() !== "" && Number.isInteger(n) && n > 0 ? n : null;
}

@Injectable()
export class CastingRetention implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CastingRetention.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORE) private readonly objects: ObjectStore,
  ) {}

  private get admin() {
    return this.database.getPrivilegedClient(
      "casting retention: remove old, superseded or failed casting analyses and the files nothing else points at",
    );
  }

  onModuleInit(): void {
    const days = retentionDays(process.env.CASTING_RETENTION_DAYS);
    if (days == null) {
      this.logger.log("casting retention is off (CASTING_RETENTION_DAYS is not set): analyses and their files are kept");
      return;
    }
    this.timer = setInterval(() => void this.run(days).catch((e: unknown) => this.logger.error(`casting retention failed: ${String(e)}`)), POLL_MS);
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** One pass: up to BATCH finished analyses older than `days`. Returns what was removed. */
  async run(days: number, now: Date = new Date()): Promise<{ rows: number; files: number }> {
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const admin = this.admin;
    const { data, error } = await admin
      .from("casting_analyses")
      .select("id, status, finished_at, worker_version, source_path, output_prefix, bom_item_id, organization_id")
      .in("status", ["succeeded", "partial", "failed"])
      .lt("finished_at", cutoff.toISOString())
      .order("finished_at", { ascending: true })
      .limit(BATCH);
    if (error) throw new Error(`could not read the casting analyses: ${error.message}`);
    const rows = (data ?? []) as RetentionRow[];
    if (rows.length === 0) return { rows: 0, files: 0 };

    const itemIds = [...new Set(rows.map((r) => r.bom_item_id))];
    const items = await admin.from("bom_items").select("id, file_3d_path").in("id", itemIds);
    if (items.error) throw new Error(`could not read the BOM items: ${items.error.message}`);
    const currentFile = new Map(((items.data ?? []) as Array<{ id: string; file_3d_path: string | null }>).map((i) => [i.id, i.file_3d_path]));

    const ids = prunable(rows, currentFile, cutoff, CASTING_WORKER_VERSION);
    if (ids.length === 0) return { rows: 0, files: 0 };
    const gone = await admin.from("casting_analyses").delete().in("id", ids);
    if (gone.error) throw new Error(`could not remove the casting analyses: ${gone.error.message}`);

    // Files: only of a prefix no remaining row points at.
    const removed = rows.filter((r) => ids.includes(r.id));
    const filesOf = new Map<string, number>(); // by organization
    const prefixes = new Map<string, string>(); // prefix -> organization
    for (const r of removed) if (r.output_prefix) prefixes.set(r.output_prefix, r.organization_id);
    for (const [prefix, organization] of prefixes) {
      const still = await admin.from("casting_analyses").select("id", { count: "exact", head: true }).eq("output_prefix", prefix);
      if (still.error || (still.count ?? 1) > 0) continue; // unknown or still used: keep the files
      filesOf.set(organization, (filesOf.get(organization) ?? 0) + (await this.removeTree(prefix)));
    }
    const files = [...filesOf.values()].reduce((a, b) => a + b, 0);
    this.logger.log(`casting retention: removed ${ids.length} analyses and ${files} files older than ${days} days`);
    for (const organization of new Set(removed.map((r) => r.organization_id))) {
      await this.audit.recordBestEffort({
        action: "casting_retention.pruned",
        targetType: "casting_analysis",
        targetId: removed.find((r) => r.organization_id === organization)!.id,
        organizationId: organization,
        actor: { kind: "system" },
        meta: { rows: removed.filter((r) => r.organization_id === organization).length, files: filesOf.get(organization) ?? 0, days },
      });
    }
    return { rows: ids.length, files };
  }

  /** Removes every file under `prefix` (the worker's outputs are at most one folder deep: parts/). Returns how many. */
  private async removeTree(prefix: string): Promise<number> {
    const keys: string[] = [];
    for (const name of await this.objects.list(CASTING_SOURCE_BUCKET, prefix)) {
      if (name.includes(".")) keys.push(`${prefix}/${name}`);
      else for (const inner of await this.objects.list(CASTING_SOURCE_BUCKET, `${prefix}/${name}`)) keys.push(`${prefix}/${name}/${inner}`);
    }
    if (keys.length > 0) await this.objects.remove(CASTING_SOURCE_BUCKET, keys);
    return keys.length;
  }
}
