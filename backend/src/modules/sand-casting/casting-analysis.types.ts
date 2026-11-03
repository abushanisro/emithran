import { createHash } from "node:crypto";

// Shared by the service and the runner. The three constants below are part of an analysis's identity (migration 955): a new
// worker, a new result contract or a new configuration is a new analysis, never a rewrite of an old one.

/** The `worker_version` the deployed casting worker reports (casting-worker/src/main.cpp). Raise it together with the worker. */
export const CASTING_WORKER_VERSION = "0.12.0";
/** The `schema_version` of casting-worker/result.schema.json that this backend reads. */
export const CASTING_SCHEMA_VERSION = 1;
/** Where a BOM item's STEP file is kept (the same bucket cad-uploads writes to). */
export const CASTING_SOURCE_BUCKET = "bom-files";

export type CastingAnalysisStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "partial"
  | "failed";

/** What the analysis is told to do besides reading the file. Only automatic draw direction exists until the override (design S5). */
export interface CastingAnalysisConfig {
  drawDirection: "auto";
}
export const DEFAULT_CASTING_CONFIG: CastingAnalysisConfig = { drawDirection: "auto" };

/** Stable digest of a configuration (keys sorted), so equal configurations always give the same cache key. */
export function configHash(config: CastingAnalysisConfig): string {
  const sorted = Object.fromEntries(
    Object.entries(config).sort(([a], [b]) => a.localeCompare(b)),
  );
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0, 16);
}

export interface CastingAnalysisRow {
  id: string;
  organization_id: string;
  bom_item_id: string;
  requested_by: string;
  input_sha256: string;
  worker_version: string;
  schema_version: number;
  config_hash: string;
  status: CastingAnalysisStatus;
  attempts: number;
  error_code: string | null;
  error_detail: string | null;
  result: unknown;
  output_prefix: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}
